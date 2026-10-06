#!/usr/bin/env node
// Recovery CLI. Use it through scripts/account.sh (npm run reset-password -- <user> <pw>),
// which stops the service first — a running panel would overwrite the change on exit.
const store = require('./store');
const auth = require('./auth');
const { id } = require('./util');

const [cmd, username, password] = process.argv.slice(2);
store.load();
const d = store.get();

function usage() {
  console.log('Usage:\n  node server/cli.js list-users\n  node server/cli.js reset-password <username> <new-password>\n  node server/cli.js create-owner <username> <password>   (only when no owner exists)');
  process.exit(1);
}

if (cmd === 'list-users') {
  for (const u of d.users) console.log(`${u.username.padEnd(20)} ${u.role.padEnd(8)} ${u.disabled ? 'suspended' : ''}`);
} else if (cmd === 'reset-password') {
  if (!username || !password) usage();
  const u = d.users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u) { console.error('No such user'); process.exit(1); }
  auth.validatePassword(password);
  u.passwordHash = auth.hashPassword(password);
  u.disabled = false;
  d.sessions = d.sessions.filter(s => s.userId !== u.id);
  store.saveNow();
  console.log(`Password reset for ${u.username}.`);
} else if (cmd === 'create-owner') {
  if (!username || !password) usage();
  if (d.users.some(u => u.role === 'owner')) { console.error('An owner already exists; use reset-password instead.'); process.exit(1); }
  auth.validateUsername(username);
  auth.validatePassword(password);
  d.users.push({ id: id('u'), username, displayName: username, passwordHash: auth.hashPassword(password), role: 'owner', disabled: false, grants: {}, createdAt: Date.now() });
  store.saveNow();
  console.log(`Owner ${username} created.`);
} else usage();
