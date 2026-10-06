// Persistent panel state in a single JSON file with debounced atomic writes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const DATA_DIR = process.env.SQUIDPANEL_DATA || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'panel.json');
const events = new EventEmitter();
events.setMaxListeners(200);

const defaults = () => ({
  version: 2,
  createdAt: Date.now(),
  users: [],      // {id, username, displayName, passwordHash, role: owner|admin|member, disabled, grants: {serverId: {console, perms[]}}, createdAt, createdBy, lastLoginAt}
  sessions: [],   // {id, tokenHash, userId, createdAt, lastSeenAt, expiresAt, ip, agent}
  servers: [],    // see servers.js for shape
  players: {},    // {serverId: {name: {...history}}}
  activity: [],   // {id, ts, actor, action, serverId, detail}
  settings: {
    scanDirs: [path.join(os.homedir(), 'SquidServers')],
    preventSleep: true,
    publicUrl: '',
  },
});

let db = null;
let timer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const d = defaults();
      db = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
    } catch (e) {
      const broken = DB_FILE + '.broken-' + Date.now();
      fs.copyFileSync(DB_FILE, broken);
      console.error(`[store] panel.json unreadable (${e.message}); copied to ${broken} and starting fresh`);
      db = defaults();
    }
  } else {
    // The pre-rewrite demo database is kept aside, never imported (it shipped demo passwords).
    const legacy = path.join(DATA_DIR, 'db.json');
    if (fs.existsSync(legacy)) fs.renameSync(legacy, path.join(DATA_DIR, 'db.legacy-demo.json'));
    db = defaults();
    saveNow();
  }
  return db;
}

function saveNow() {
  if (!db) return;
  clearTimeout(timer);
  timer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function save() {
  if (timer) return;
  timer = setTimeout(saveNow, 300);
}

function get() {
  if (!db) load();
  return db;
}

function logActivity(actor, action, serverId, detail) {
  const d = get();
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), actor: actor || 'system', action, serverId: serverId || null, detail: detail || '' };
  d.activity.unshift(entry);
  if (d.activity.length > 3000) d.activity.length = 3000;
  save();
  events.emit('activity', entry);
  return entry;
}

module.exports = { get, load, save, saveNow, logActivity, events, DATA_DIR };
