// Servers: registry, power, console, players, properties and access lists.
const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const rbac = require('../rbac');
const auth = require('../auth');
const manager = require('../manager');
const detect = require('../detect');
const properties = require('../properties');
const { slugify, httpError } = require('../util');

const r = express.Router();
r.use(auth.requireAuth);
const g = auth.serverGuard;
const actor = req => req.user.username;

const COLORS = ['emerald', 'sky', 'violet', 'amber', 'rose', 'teal', 'indigo', 'lime'];

function newServer(dir, name, address) {
  const info = detect.inspect(dir);
  if (!info.valid) throw httpError(400, 'That folder does not look like a Minecraft server (no server jar or run script found)');
  const d = store.get();
  let real;
  try { real = fs.realpathSync(dir); } catch { throw httpError(400, 'Folder not found'); }
  if (d.servers.some(s => { try { return fs.realpathSync(s.dir) === real; } catch { return false; } })) throw httpError(409, 'This server folder is already added');
  let sid = slugify(name || path.basename(dir));
  while (d.servers.some(s => s.id === sid)) sid += '-2';
  const s = {
    id: sid, name: String(name || path.basename(dir).replace(/_\d+$/, '')).slice(0, 48), dir: real, address: address || '',
    color: COLORS[d.servers.length % COLORS.length], createdAt: Date.now(),
    launch: { type: 'auto', java: 'auto', jar: '', script: '', minRam: '1G', maxRam: '4G', jvmArgs: '', custom: '' },
    settings: { autoStop: true, idleMinutes: 10, autoStart: false, restartOnCrash: true, stopTimeout: 90, restrictedCommands: rbac.DEFAULT_RESTRICTED },
    backup: { enabled: false, everyHours: 24, keep: 7, lastAuto: null, onlyWhenUsed: true },
  };
  d.servers.push(s);
  store.save();
  return s;
}

// Import any server folders found in the scan directories (first run convenience).
function autoImport() {
  const d = store.get();
  if (d.servers.length || d.settings.autoImported) return [];
  const found = detect.scan(d.settings.scanDirs || []);
  const added = found.map(f => { try { return newServer(f.dir, f.name, ''); } catch { return null; } }).filter(Boolean);
  d.settings.autoImported = true;
  store.save();
  return added;
}

function view(s, user) {
  const a = rbac.access(user, s.id);
  const info = detect.inspect(s.dir);
  const out = {
    id: s.id, name: s.name, address: s.address, color: s.color, software: info.software, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion || null,
    hasIcon: info.hasIcon, addonsDir: info.addonsDir, eula: info.eula, motd: info.motd, launchType: (s.launch?.type && s.launch.type !== 'auto') ? s.launch.type : info.launch,
    settings: s.settings, backup: s.backup, access: a, runtime: manager.summary(s.id), missing: !fs.existsSync(s.dir),
  };
  if (a.perms.includes('settings.edit')) out.dir = s.dir;
  if (rbac.isAdmin(user)) out.launch = s.launch;
  return out;
}

r.get('/servers', (req, res) => {
  const list = store.get().servers.filter(s => rbac.access(req.user, s.id).view).map(s => view(s, req.user));
  res.json({ servers: list });
});

r.get('/servers/:id', g(), (req, res) => res.json({ server: view(req.server, req.user) }));

r.get('/discover', auth.requireAdmin, (req, res) => {
  const d = store.get();
  const known = new Set(d.servers.map(s => { try { return fs.realpathSync(s.dir); } catch { return s.dir; } }));
  res.json({ scanDirs: d.settings.scanDirs, found: detect.scan(d.settings.scanDirs || []).filter(f => !known.has(f.dir)) });
});

r.post('/servers', auth.requireAdmin, (req, res) => {
  const { dir, name, address } = req.body || {};
  if (!dir) throw httpError(400, 'Server folder is required');
  const s = newServer(String(dir).replace(/^~(?=\/)/, require('os').homedir()), name, address);
  store.logActivity(actor(req), 'server.add', s.id, s.dir);
  res.json({ ok: true, server: view(s, req.user) });
});

r.patch('/servers/:id', g('settings.edit'), (req, res) => {
  const s = req.server;
  const { name, address, color, settings, backup, launch } = req.body || {};
  if (name !== undefined) s.name = String(name).trim().slice(0, 48) || s.name;
  if (address !== undefined) s.address = String(address).trim().slice(0, 120);
  if (color !== undefined && COLORS.includes(color)) s.color = color;
  if (settings) {
    const st = { ...s.settings };
    if (settings.autoStop !== undefined) st.autoStop = !!settings.autoStop;
    if (settings.idleMinutes !== undefined) st.idleMinutes = Math.max(1, Math.min(1440, parseInt(settings.idleMinutes, 10) || 10));
    if (settings.autoStart !== undefined) st.autoStart = !!settings.autoStart;
    if (settings.restartOnCrash !== undefined) st.restartOnCrash = !!settings.restartOnCrash;
    if (settings.stopTimeout !== undefined) st.stopTimeout = Math.max(15, Math.min(600, parseInt(settings.stopTimeout, 10) || 90));
    if (Array.isArray(settings.restrictedCommands) && rbac.isAdmin(req.user)) st.restrictedCommands = settings.restrictedCommands.map(x => String(x).trim().toLowerCase().replace(/^\//, '')).filter(Boolean).slice(0, 100);
    s.settings = st;
  }
  if (backup) {
    const b = { ...s.backup };
    if (backup.enabled !== undefined) b.enabled = !!backup.enabled;
    if (backup.everyHours !== undefined) b.everyHours = Math.max(1, Math.min(720, parseFloat(backup.everyHours) || 24));
    if (backup.keep !== undefined) b.keep = Math.max(1, Math.min(100, parseInt(backup.keep, 10) || 7));
    if (backup.onlyWhenUsed !== undefined) b.onlyWhenUsed = !!backup.onlyWhenUsed;
    s.backup = b;
  }
  // Launch settings run arbitrary programs, so only admins may touch them.
  if (launch) {
    if (!rbac.isAdmin(req.user)) throw httpError(403, 'Only admins can change how the server is launched');
    const l = { ...s.launch };
    for (const k of ['type', 'java', 'jar', 'script', 'minRam', 'maxRam', 'jvmArgs', 'custom']) if (launch[k] !== undefined) l[k] = String(launch[k]).trim();
    if (!['auto', 'jar', 'script', 'custom'].includes(l.type)) l.type = 'auto';
    for (const k of ['minRam', 'maxRam']) if (l[k] && !/^\d+[MG]$/i.test(l[k])) throw httpError(400, 'Memory must look like 2G or 2048M');
    s.launch = l;
    // run.sh servers (NeoForge/Forge) read their heap size from user_jvm_args.txt.
    const jvmFile = path.join(s.dir, 'user_jvm_args.txt');
    if ((launch.maxRam || launch.minRam) && fs.existsSync(jvmFile)) {
      let txt = fs.readFileSync(jvmFile, 'utf8');
      const set = (flag, val) => { txt = new RegExp(`^${flag}\\S*`, 'm').test(txt) ? txt.replace(new RegExp(`^${flag}\\S*`, 'm'), flag + val) : `${txt.replace(/\n?$/, '\n')}${flag}${val}\n`; };
      if (l.maxRam) set('-Xmx', l.maxRam);
      if (l.minRam) set('-Xms', l.minRam);
      fs.writeFileSync(jvmFile, txt);
    }
  }
  store.save();
  store.logActivity(actor(req), 'server.settings', s.id, Object.keys(req.body || {}).join(', '));
  res.json({ ok: true, server: view(s, req.user) });
});

r.delete('/servers/:id', auth.requireAdmin, g(), (req, res) => {
  manager.forget(req.server.id);
  const d = store.get();
  d.servers = d.servers.filter(s => s.id !== req.server.id);
  for (const u of d.users) if (u.grants) delete u.grants[req.server.id];
  store.save();
  store.logActivity(actor(req), 'server.remove', req.server.id, `${req.server.name} (files kept at ${req.server.dir})`);
  res.json({ ok: true });
});

r.get('/servers/:id/icon', g(), (req, res) => {
  const p = path.join(req.server.dir, 'server-icon.png');
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set('Cache-Control', 'max-age=300').sendFile(p);
});

// ---------- power ----------
r.post('/servers/:id/start', g('power.start'), async (req, res) => res.json(await manager.start(req.server.id, actor(req))));
r.post('/servers/:id/stop', g('power.stop'), async (req, res) => res.json(await manager.stop(req.server.id, actor(req))));
r.post('/servers/:id/kill', g('power.stop'), (req, res) => res.json(manager.kill(req.server.id, actor(req))));
r.post('/servers/:id/restart', g('power.stop'), (req, res) => {
  if (!req.access.perms.includes('power.start')) throw httpError(403, 'Restart needs both start and stop permissions');
  manager.restart(req.server.id, actor(req)).catch(e => manager.panelLog(req.server.id, `Restart failed: ${e.message}`));
  res.json({ ok: true });
});
r.post('/servers/:id/eula', g('settings.edit'), (req, res) => {
  fs.writeFileSync(path.join(req.server.dir, 'eula.txt'), `#Accepted via SquidPanel by ${actor(req)} on ${new Date().toISOString()}\n#https://aka.ms/MinecraftEULA\neula=true\n`);
  store.logActivity(actor(req), 'server.eula', req.server.id, '');
  res.json({ ok: true });
});

// ---------- console ----------
r.get('/servers/:id/console', g(), auth.consoleGuard(1), (req, res) => {
  res.json({ lines: manager.logs(req.server.id, Math.min(1500, parseInt(req.query.lines, 10) || 600)), channel: manager.consoleChannel(req.server.id) });
});

r.post('/servers/:id/console', g(), auth.consoleGuard(1), async (req, res) => {
  const cmd = String(req.body?.command || '');
  const reason = rbac.commandBlockReason(req.access.console, cmd, req.server.settings?.restrictedCommands);
  if (reason) throw httpError(403, reason);
  res.json(await manager.command(req.server.id, cmd, actor(req)));
});

r.get('/servers/:id/stats', g(), (req, res) => res.json({ stats: manager.stats(req.server.id) }));

// ---------- players ----------
function readList(dir, file) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return []; }
}

r.get('/servers/:id/players', g('players.view'), (req, res) => {
  const s = req.server;
  const rt = manager.get(s.id);
  const history = Object.values(store.get().players[s.id] || {}).map(p => {
    const open = [...(p.sessions || [])].reverse().find(x => !x.out);
    const live = rt.players.has(p.name) && open ? Date.now() - open.in : 0;
    return { ...p, online: rt.players.has(p.name), playtimeMs: p.playtimeMs + live, sessions: (p.sessions || []).slice(-15).reverse() };
  }).sort((a, b) => (b.online - a.online) || ((b.lastLogin || 0) - (a.lastLogin || 0)));
  const props = properties.read(s.dir);
  res.json({
    // Prefer the recorded session start so "playing for" survives panel restarts.
    online: [...rt.players.entries()].map(([name, since]) => {
      const open = [...((store.get().players[s.id] || {})[name]?.sessions || [])].reverse().find(x => !x.out);
      return { name, since: open ? open.in : since };
    }),
    history,
    lists: {
      ops: readList(s.dir, 'ops.json'), whitelist: readList(s.dir, 'whitelist.json'),
      bans: readList(s.dir, 'banned-players.json'), ipBans: readList(s.dir, 'banned-ips.json'),
      whitelistEnabled: String(props['white-list'] || props['whitelist']).toLowerCase() === 'true',
    },
    canCommand: !!manager.consoleChannel(s.id),
  });
});

const PLAYER_ACTIONS = {
  kick: (n, why) => `kick ${n}${why ? ' ' + why : ''}`,
  ban: (n, why) => `ban ${n}${why ? ' ' + why : ''}`,
  pardon: n => `pardon ${n}`,
  'whitelist-add': n => `whitelist add ${n}`,
  'whitelist-remove': n => `whitelist remove ${n}`,
  'whitelist-on': () => 'whitelist on',
  'whitelist-off': () => 'whitelist off',
  op: n => `op ${n}`,
  deop: n => `deop ${n}`,
  list: () => 'list',
};

r.post('/servers/:id/players/action', g('players.view'), async (req, res) => {
  const { action, name, reason } = req.body || {};
  const fn = PLAYER_ACTIONS[action];
  if (!fn) throw httpError(400, 'Unknown action');
  if (action !== 'list' && !req.access.perms.includes('players.manage')) throw httpError(403, 'You need the "Kick, ban & whitelist" permission');
  if ((action === 'op' || action === 'deop') && req.access.console < 3) throw httpError(403, 'Only console operators can op or deop players');
  if (name !== undefined && !/^[.\w-]{1,24}$/.test(String(name))) throw httpError(400, 'Invalid player name');
  const cleanReason = String(reason || '').replace(/[\r\n]/g, ' ').slice(0, 120);
  await manager.command(req.server.id, fn(name, cleanReason), actor(req), { silent: action === 'list' });
  if (action !== 'list') store.logActivity(actor(req), `player.${action}`, req.server.id, name || '');
  res.json({ ok: true });
});

// ---------- server.properties ----------
r.get('/servers/:id/properties', g('settings.edit'), (req, res) => {
  res.json({ properties: properties.read(req.server.dir), running: !!manager.get(req.server.id).pid });
});

const PROTECTED_PROPS = ['enable-rcon', 'rcon.password', 'rcon.port', 'management-server-enabled', 'management-server-secret', 'management-server-host', 'management-server-port', 'enable-query', 'query.port'];
r.put('/servers/:id/properties', g('settings.edit'), (req, res) => {
  const values = req.body?.properties || {};
  const updates = {};
  for (const [k, v] of Object.entries(values)) {
    if (!/^[\w.-]{1,80}$/.test(k)) continue;
    if (PROTECTED_PROPS.includes(k) && !rbac.isAdmin(req.user)) continue;
    updates[k] = String(v).slice(0, 2000);
  }
  properties.write(req.server.dir, updates);
  store.logActivity(actor(req), 'server.properties', req.server.id, Object.keys(updates).join(', ').slice(0, 300));
  res.json({ ok: true, restartRequired: !!manager.get(req.server.id).pid });
});

// One-click RCON for servers that get started outside the panel.
r.post('/servers/:id/rcon', auth.requireAdmin, g(), (req, res) => {
  const p = properties.read(req.server.dir);
  const enable = !!req.body?.enable;
  const pw = p['rcon.password'] || require('crypto').randomBytes(18).toString('base64url');
  let port = parseInt(p['rcon.port'], 10) || 0;
  const used = new Set(store.get().servers.filter(s => s.id !== req.server.id).map(s => parseInt(properties.read(s.dir)['rcon.port'], 10)));
  if (!port || used.has(port)) { port = 25575; while (used.has(port)) port++; }
  properties.write(req.server.dir, enable ? { 'enable-rcon': 'true', 'rcon.password': pw, 'rcon.port': String(port), 'broadcast-rcon-to-ops': 'false' } : { 'enable-rcon': 'false' });
  store.logActivity(actor(req), enable ? 'server.rcon_on' : 'server.rcon_off', req.server.id, '');
  res.json({ ok: true, restartRequired: !!manager.get(req.server.id).pid });
});

// ---------- access list for this server ----------
r.get('/servers/:id/access', g('access.manage'), (req, res) => {
  const d = store.get();
  const users = d.users.map(u => ({
    id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role, disabled: !!u.disabled,
    access: rbac.access(u, req.server.id), grant: (u.grants || {})[req.server.id] || null,
    editable: rbac.canGrant(req.user, u, req.server.id, null),
  }));
  res.json({ users, mine: req.access });
});

module.exports = { router: r, autoImport };
