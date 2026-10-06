// Sessions (hashed tokens in an httpOnly cookie), auth middleware and guards.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('./store');
const rbac = require('./rbac');
const { httpError } = require('./util');

const COOKIE = 'sp_session';
const SESSION_DAYS = 30;
const hash = t => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

// True only for a browser on this Mac — not for traffic arriving through a tunnel.
function isLocalRequest(req) {
  const addr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const proxied = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'x-forwarded-host'].some(h => req.headers[h]);
  return !proxied && (addr === '127.0.0.1' || addr === '::1');
}

function isSecure(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').startsWith('https');
}

function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const d = store.get();
  const now = Date.now();
  d.sessions.push({ id: crypto.randomBytes(8).toString('hex'), tokenHash: hash(token), userId: user.id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_DAYS * 86400000, ip: clientIp(req), agent: String(req.headers['user-agent'] || '').slice(0, 200) });
  d.sessions = d.sessions.filter(s => s.expiresAt > now);
  user.lastLoginAt = now;
  store.save();
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: SESSION_DAYS * 86400000, path: '/' });
}

function sessionFromToken(token) {
  if (!token) return null;
  const d = store.get();
  const h = hash(token);
  const s = d.sessions.find(x => x.tokenHash === h);
  if (!s || s.expiresAt < Date.now()) return null;
  const user = d.users.find(u => u.id === s.userId);
  if (!user || user.disabled) return null;
  return { session: s, user };
}

function sessionFromRequest(req) {
  return sessionFromToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function authenticate(req, res, next) {
  const found = sessionFromRequest(req);
  if (found) {
    req.user = found.user;
    req.session = found.session;
    if (Date.now() - found.session.lastSeenAt > 5 * 60000) {
      found.session.lastSeenAt = Date.now();
      found.session.expiresAt = Date.now() + SESSION_DAYS * 86400000;
      found.session.ip = clientIp(req);
      store.save();
    }
  }
  next();
}

// CSRF guard: state-changing API calls must carry a custom header, which browsers
// never attach to cross-site form posts.
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-squidpanel'] !== '1') return res.status(403).json({ error: 'Missing request header' });
  next();
}

function revokeUserSessions(userId, exceptSessionId) {
  const d = store.get();
  d.sessions = d.sessions.filter(s => s.userId !== userId || s.id === exceptSessionId);
  store.save();
}

const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Not signed in' }));
const requireAdmin = (req, res, next) => (rbac.isAdmin(req.user) ? next() : res.status(403).json({ error: 'Admins only' }));

// Loads :id into req.server and checks view access plus an optional permission.
function serverGuard(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    const s = store.get().servers.find(x => x.id === req.params.id);
    const a = s ? rbac.access(req.user, s.id) : null;
    if (!s || !a.view) return res.status(404).json({ error: 'Server not found' });
    if (perm && !a.perms.includes(perm)) return res.status(403).json({ error: `You don't have the "${perm}" permission on this server` });
    req.server = s;
    req.access = a;
    next();
  };
}

function consoleGuard(minLevel) {
  return (req, res, next) => (req.access.console >= minLevel ? next() : res.status(403).json({ error: 'You do not have console access on this server' }));
}

// Login throttling per IP.
const attempts = new Map();
function checkThrottle(ip) {
  const a = attempts.get(ip);
  if (a && a.count >= 8 && Date.now() - a.first < 15 * 60000) throw httpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.');
}
function noteFailure(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60000) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw httpError(400, 'Password must be at least 8 characters');
  if (pw.length > 200) throw httpError(400, 'Password is too long');
}
function validateUsername(name) {
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(String(name || ''))) throw httpError(400, 'Username must be 3–24 characters: letters, numbers, dot, dash or underscore');
}

const hashPassword = pw => bcrypt.hashSync(pw, 11);
const checkPassword = (pw, h) => bcrypt.compareSync(String(pw || ''), h || '');

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt, createdBy: u.createdBy || null, lastLoginAt: u.lastLoginAt || null, grants: u.grants || {} };
}

module.exports = {
  COOKIE, authenticate, csrf, requireAuth, requireAdmin, serverGuard, consoleGuard, createSession, sessionFromRequest, sessionFromToken,
  parseCookies, revokeUserSessions, isLocalRequest, clientIp, checkThrottle, noteFailure, validatePassword, validateUsername,
  hashPassword, checkPassword, publicUser,
};
