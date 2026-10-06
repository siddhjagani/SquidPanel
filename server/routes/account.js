// First-run setup, sign in/out, and self-service account management.
const express = require('express');
const store = require('../store');
const rbac = require('../rbac');
const auth = require('../auth');
const { id } = require('../util');

const r = express.Router();

r.get('/setup', (req, res) => {
  const needed = store.get().users.length === 0;
  res.json({ needed, allowed: needed && auth.isLocalRequest(req) });
});

r.post('/setup', (req, res) => {
  const d = store.get();
  if (d.users.length) return res.status(400).json({ error: 'Setup has already been completed' });
  if (!auth.isLocalRequest(req)) return res.status(403).json({ error: 'For safety, the owner account can only be created from a browser on this Mac (http://localhost).' });
  const { username, password, displayName } = req.body || {};
  auth.validateUsername(username);
  auth.validatePassword(password);
  const user = { id: id('u'), username, displayName: displayName || username, passwordHash: auth.hashPassword(password), role: 'owner', disabled: false, grants: {}, createdAt: Date.now(), createdBy: null };
  d.users.push(user);
  store.save();
  store.logActivity(username, 'account.setup', null, 'Owner account created');
  auth.createSession(req, res, user);
  res.json({ ok: true, user: auth.publicUser(user) });
});

r.post('/auth/login', (req, res) => {
  const ip = auth.clientIp(req);
  auth.checkThrottle(ip);
  const { username, password } = req.body || {};
  const user = store.get().users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !auth.checkPassword(password, user.passwordHash)) {
    auth.noteFailure(ip);
    store.logActivity(String(username || '?').slice(0, 30), 'account.login_failed', null, ip);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been suspended' });
  auth.createSession(req, res, user);
  store.logActivity(user.username, 'account.login', null, ip);
  res.json({ ok: true, user: auth.publicUser(user) });
});

r.post('/auth/logout', (req, res) => {
  if (req.session) {
    const d = store.get();
    d.sessions = d.sessions.filter(s => s.id !== req.session.id);
    store.save();
  }
  res.clearCookie(auth.COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/auth/me', auth.requireAuth, (req, res) => {
  res.json({
    user: auth.publicUser(req.user),
    meta: { permissions: rbac.PERMISSIONS, consoleLevels: rbac.CONSOLE_LEVELS, presets: rbac.PRESETS, defaultRestricted: rbac.DEFAULT_RESTRICTED },
  });
});

r.patch('/auth/me', auth.requireAuth, (req, res) => {
  const { displayName, currentPassword, newPassword } = req.body || {};
  const u = req.user;
  if (displayName !== undefined) u.displayName = String(displayName).trim().slice(0, 40) || u.username;
  if (newPassword) {
    if (!auth.checkPassword(currentPassword, u.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect' });
    auth.validatePassword(newPassword);
    u.passwordHash = auth.hashPassword(newPassword);
    auth.revokeUserSessions(u.id, req.session.id);
    store.logActivity(u.username, 'account.password', null, 'Changed own password');
  }
  store.save();
  res.json({ ok: true, user: auth.publicUser(u) });
});

r.get('/auth/sessions', auth.requireAuth, (req, res) => {
  res.json({
    sessions: store.get().sessions.filter(s => s.userId === req.user.id && s.expiresAt > Date.now())
      .map(s => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, agent: s.agent, current: s.id === req.session.id }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
  });
});

r.delete('/auth/sessions/:sid', auth.requireAuth, (req, res) => {
  const d = store.get();
  d.sessions = d.sessions.filter(s => !(s.userId === req.user.id && s.id === req.params.sid));
  store.save();
  res.json({ ok: true });
});

module.exports = r;
