// Account management and per-server grants.
const express = require('express');
const store = require('../store');
const rbac = require('../rbac');
const auth = require('../auth');
const manager = require('../manager');
const { id, httpError } = require('../util');

const r = express.Router();
r.use(auth.requireAuth);

const findUser = uid => {
  const u = store.get().users.find(x => x.id === uid);
  if (!u) throw httpError(404, 'Account not found');
  return u;
};
const sharesAnything = user => store.get().servers.some(s => rbac.can(user, s.id, 'access.manage'));

r.get('/users', (req, res) => {
  const d = store.get();
  if (rbac.isAdmin(req.user)) return res.json({ users: d.users.map(auth.publicUser) });
  // Members who can share access get a minimal directory of other members.
  if (!sharesAnything(req.user)) return res.status(403).json({ error: 'Admins only' });
  res.json({ users: d.users.filter(u => u.role === 'member' && !u.disabled).map(u => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role, grants: {} })) });
});

r.post('/users', auth.requireAdmin, (req, res) => {
  const { username, password, displayName, role = 'member', grants = {} } = req.body || {};
  auth.validateUsername(username);
  auth.validatePassword(password);
  if (!rbac.canAssignRole(req.user, role)) throw httpError(403, `You cannot create ${role} accounts`);
  const d = store.get();
  if (d.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw httpError(409, 'That username is already taken');
  const clean = {};
  if (role === 'member') for (const [sid, g] of Object.entries(grants || {})) if (d.servers.some(s => s.id === sid)) clean[sid] = rbac.normalizeGrant(g);
  const user = { id: id('u'), username, displayName: String(displayName || username).slice(0, 40), passwordHash: auth.hashPassword(password), role, disabled: false, grants: clean, createdAt: Date.now(), createdBy: req.user.username };
  d.users.push(user);
  store.save();
  store.logActivity(req.user.username, 'user.create', null, `${username} (${role})`);
  res.json({ ok: true, user: auth.publicUser(user) });
});

r.patch('/users/:uid', auth.requireAdmin, (req, res) => {
  const target = findUser(req.params.uid);
  if (!rbac.canManageUser(req.user, target)) throw httpError(403, 'You cannot edit this account');
  const { displayName, role, disabled, password } = req.body || {};
  const changes = [];
  if (displayName !== undefined) { target.displayName = String(displayName).trim().slice(0, 40) || target.username; changes.push('name'); }
  if (role !== undefined && role !== target.role) {
    if (!rbac.canAssignRole(req.user, role)) throw httpError(403, `You cannot make someone ${role}`);
    target.role = role;
    changes.push(`role → ${role}`);
  }
  if (disabled !== undefined && !!disabled !== !!target.disabled) {
    target.disabled = !!disabled;
    if (target.disabled) auth.revokeUserSessions(target.id);
    changes.push(target.disabled ? 'suspended' : 'reactivated');
  }
  if (password) {
    auth.validatePassword(password);
    target.passwordHash = auth.hashPassword(password);
    auth.revokeUserSessions(target.id);
    changes.push('password reset');
  }
  store.save();
  store.logActivity(req.user.username, 'user.update', null, `${target.username}: ${changes.join(', ') || 'no changes'}`);
  res.json({ ok: true, user: auth.publicUser(target) });
});

r.delete('/users/:uid', auth.requireAdmin, (req, res) => {
  const target = findUser(req.params.uid);
  if (!rbac.canManageUser(req.user, target)) throw httpError(403, 'You cannot delete this account');
  const d = store.get();
  d.users = d.users.filter(u => u.id !== target.id);
  auth.revokeUserSessions(target.id);
  store.save();
  store.logActivity(req.user.username, 'user.delete', null, target.username);
  res.json({ ok: true });
});

// Grants: admins for any member; members with access.manage within their own ceiling.
r.put('/users/:uid/grants/:sid', (req, res) => {
  const target = findUser(req.params.uid);
  const s = store.get().servers.find(x => x.id === req.params.sid);
  if (!s) throw httpError(404, 'Server not found');
  const grant = rbac.normalizeGrant(req.body || {});
  if (!rbac.canGrant(req.user, target, s.id, grant)) throw httpError(403, 'You cannot grant these permissions (you can only share what you have, and only with members)');
  target.grants = { ...(target.grants || {}), [s.id]: grant };
  store.save();
  const levels = ['no console', 'console: read', 'console: commands', 'console: operator'];
  store.logActivity(req.user.username, 'access.grant', s.id, `${target.username}: ${levels[grant.console]}${grant.perms.length ? ', ' + grant.perms.join(', ') : ''}`);
  manager.events.emit('access', target.id);
  res.json({ ok: true, user: auth.publicUser(target) });
});

r.delete('/users/:uid/grants/:sid', (req, res) => {
  const target = findUser(req.params.uid);
  if (!rbac.canGrant(req.user, target, req.params.sid, null)) throw httpError(403, 'You cannot revoke access for this account');
  if (target.grants) delete target.grants[req.params.sid];
  store.save();
  store.logActivity(req.user.username, 'access.revoke', req.params.sid, target.username);
  manager.events.emit('access', target.id);
  res.json({ ok: true });
});

module.exports = r;
