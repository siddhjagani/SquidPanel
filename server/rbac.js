// Roles, per-server grants, console levels and command restrictions.
//
// Roles
//   owner  – everything, including managing admins. Exactly one owner.
//   admin  – full control of every server; can create/manage member accounts.
//   member – only what has been granted per server.
//
// A member grant looks like { console: 0..3, perms: ['power.start', ...] }.
// Having any grant for a server means the member can see that server.

const PERMISSIONS = [
  { key: 'power.start', label: 'Start server', group: 'Power' },
  { key: 'power.stop', label: 'Stop / restart / kill', group: 'Power' },
  { key: 'players.view', label: 'View players & history', group: 'Players' },
  { key: 'players.manage', label: 'Kick, ban & whitelist', group: 'Players' },
  { key: 'files.manage', label: 'File manager', group: 'Content' },
  { key: 'addons.manage', label: 'Mods & plugins', group: 'Content' },
  { key: 'worlds.manage', label: 'Worlds', group: 'Content' },
  { key: 'backups.manage', label: 'Backups', group: 'Content' },
  { key: 'settings.edit', label: 'Server settings', group: 'Admin' },
  { key: 'access.manage', label: 'Share access with others', group: 'Admin' },
];
const PERM_KEYS = PERMISSIONS.map(p => p.key);

const CONSOLE_LEVELS = [
  { level: 0, key: 'none', label: 'No access', description: 'Console is hidden.' },
  { level: 1, key: 'read', label: 'Read only', description: 'Can watch the live console, cannot type.' },
  { level: 2, key: 'command', label: 'Commands', description: 'Can run commands, except restricted ones (op, stop, ban…).' },
  { level: 3, key: 'operator', label: 'Operator', description: 'Can run any command, including op/deop and stop.' },
];

const DEFAULT_RESTRICTED = [
  'op', 'deop', 'stop', 'restart', 'reload', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist',
  'save-off', 'kill', 'sudo', 'lp', 'luckperms', 'perm', 'perms', 'pex', 'plugman', 'execute', 'function', 'debug', 'jfr', 'spark',
];

const PRESETS = {
  viewer: { label: 'Viewer', console: 1, perms: ['players.view'] },
  player: { label: 'Player', console: 0, perms: ['power.start', 'players.view'] },
  moderator: { label: 'Moderator', console: 2, perms: ['power.start', 'power.stop', 'players.view', 'players.manage', 'backups.manage'] },
  coadmin: { label: 'Co-admin', console: 3, perms: [...PERM_KEYS] },
};

function isAdmin(user) {
  return !!user && (user.role === 'owner' || user.role === 'admin');
}

function normalizeGrant(g) {
  if (!g) return null;
  const consoleLevel = Math.max(0, Math.min(3, parseInt(g.console, 10) || 0));
  const perms = [...new Set((g.perms || []).filter(p => PERM_KEYS.includes(p)))];
  return { console: consoleLevel, perms };
}

// Effective access of a user to a server.
function access(user, serverId) {
  if (!user || user.disabled) return { view: false, console: 0, perms: [], role: null };
  if (isAdmin(user)) return { view: true, console: 3, perms: [...PERM_KEYS], role: user.role };
  const g = normalizeGrant(user.grants && user.grants[serverId]);
  if (!g) return { view: false, console: 0, perms: [], role: 'member' };
  return { view: true, console: g.console, perms: g.perms, role: 'member' };
}

function can(user, serverId, perm) {
  return access(user, serverId).perms.includes(perm);
}

function consoleLevel(user, serverId) {
  return access(user, serverId).console;
}

// Who may edit which account.
function canManageUser(actor, target) {
  if (!actor || !target || actor.disabled) return false;
  if (actor.id === target.id) return false; // self-service goes through /api/auth/me
  if (actor.role === 'owner') return true;
  if (actor.role === 'admin') return target.role === 'member';
  return false;
}

function canAssignRole(actor, role) {
  if (role === 'owner') return false;
  if (actor.role === 'owner') return role === 'admin' || role === 'member';
  if (actor.role === 'admin') return role === 'member';
  return false;
}

// Can `actor` set `grant` for `target` on `serverId`? Members with access.manage can share
// at most what they themselves have, and only with other members.
function canGrant(actor, target, serverId, grant) {
  if (!actor || !target) return false;
  if (target.role !== 'member') return false;
  if (isAdmin(actor)) return canManageUser(actor, target) || actor.role === 'owner';
  if (actor.id === target.id) return false;
  const mine = access(actor, serverId);
  if (!mine.perms.includes('access.manage')) return false;
  if (!grant) return true; // revoking
  const g = normalizeGrant(grant);
  if (g.console > mine.console) return false;
  return g.perms.every(p => mine.perms.includes(p));
}

// Returns null if allowed, otherwise the reason it is blocked.
function commandBlockReason(level, command, restricted) {
  if (level >= 3) return null;
  if (level < 2) return 'Your console access is read-only';
  const list = (restricted && restricted.length ? restricted : DEFAULT_RESTRICTED).map(s => s.toLowerCase());
  const tokens = String(command).trim().replace(/^\/+/, '').split(/\s+/).map(t => t.toLowerCase().replace(/^[a-z0-9_.-]+:/, ''));
  if (!tokens.length || !tokens[0]) return 'Empty command';
  if (list.includes(tokens[0])) return `"${tokens[0]}" is restricted to operators`;
  // Catch nested invocations such as `execute ... run op Steve`.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'run' && list.includes(tokens[i + 1])) return `"${tokens[i + 1]}" is restricted to operators`;
  }
  return null;
}

module.exports = {
  PERMISSIONS, PERM_KEYS, CONSOLE_LEVELS, DEFAULT_RESTRICTED, PRESETS,
  isAdmin, access, can, consoleLevel, normalizeGrant, canManageUser, canAssignRole, canGrant, commandBlockReason,
};
