// File manager, mods/plugins (+ Modrinth), worlds and backups.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const store = require('../store');
const auth = require('../auth');
const manager = require('../manager');
const detect = require('../detect');
const properties = require('../properties');
const backups = require('../backups');
const zipmeta = require('../zipmeta');
const { safeResolve, httpError, run } = require('../util');

const r = express.Router();
r.use(auth.requireAuth);
const g = auth.serverGuard;
const actor = req => req.user.username;
const TMP = path.join(store.DATA_DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const upload = multer({ dest: TMP, limits: { fileSize: 8 * 1024 * 1024 * 1024 } });
const cleanup = files => { for (const f of [].concat(files || [])) if (f?.path) fs.rm(f.path, { force: true }, () => {}); };

// Stream a zip of `entries` (relative to cwd) to the response using the native zip tool.
function streamZip(res, cwd, entries, name) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
  const z = spawn('zip', ['-r', '-q', '-y', '-', ...entries, '-x', '*/session.lock', '*.DS_Store'], { cwd });
  z.stdout.pipe(res);
  z.on('error', () => res.destroy());
  res.on('close', () => { if (z.exitCode === null) z.kill(); });
}

// ================= Files =================
const isText = buf => !buf.includes(0);

r.get('/servers/:id/files', g('files.manage'), (req, res) => {
  const dir = safeResolve(req.server.dir, req.query.path);
  let st;
  try { st = fs.statSync(dir); } catch { throw httpError(404, 'Folder not found'); }
  if (!st.isDirectory()) throw httpError(400, 'Not a folder');
  const items = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store') continue;
    try {
      const p = path.join(dir, ent.name);
      const s = fs.lstatSync(p);
      items.push({ name: ent.name, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, modified: s.mtimeMs, link: s.isSymbolicLink() });
    } catch {}
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  res.json({ path: path.relative(fs.realpathSync(req.server.dir), dir), items });
});

r.get('/servers/:id/files/content', g('files.manage'), (req, res) => {
  const p = safeResolve(req.server.dir, req.query.path);
  let st;
  try { st = fs.statSync(p); } catch { throw httpError(404, 'File not found'); }
  if (st.isDirectory()) throw httpError(400, 'That is a folder');
  if (st.size > 3 * 1024 * 1024) throw httpError(413, 'File is too large to edit in the browser (over 3 MB) — download it instead');
  const buf = fs.readFileSync(p);
  if (!isText(buf)) throw httpError(415, 'This looks like a binary file — download it instead');
  res.json({ content: buf.toString('utf8'), size: st.size, modified: st.mtimeMs });
});

r.put('/servers/:id/files/content', g('files.manage'), (req, res) => {
  const { path: rel, content } = req.body || {};
  if (typeof content !== 'string') throw httpError(400, 'Missing content');
  const p = safeResolve(req.server.dir, rel);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) throw httpError(400, 'That is a folder');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  store.logActivity(actor(req), 'file.edit', req.server.id, rel);
  res.json({ ok: true });
});

r.post('/servers/:id/files/upload', g('files.manage'), upload.array('files', 200), (req, res) => {
  try {
    const dir = safeResolve(req.server.dir, req.query.path);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw httpError(404, 'Folder not found');
    const saved = [];
    for (const f of req.files || []) {
      const name = path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8'));
      if (!name || name === '.' || name === '..') continue;
      fs.copyFileSync(f.path, path.join(dir, name));
      saved.push(name);
    }
    store.logActivity(actor(req), 'file.upload', req.server.id, `${req.query.path || '/'}: ${saved.join(', ')}`.slice(0, 300));
    res.json({ ok: true, saved });
  } finally { cleanup(req.files); }
});

r.post('/servers/:id/files/mkdir', g('files.manage'), (req, res) => {
  const p = safeResolve(req.server.dir, req.body?.path);
  if (fs.existsSync(p)) throw httpError(409, 'Something with that name already exists');
  fs.mkdirSync(p, { recursive: true });
  res.json({ ok: true });
});

r.post('/servers/:id/files/rename', g('files.manage'), (req, res) => {
  const from = safeResolve(req.server.dir, req.body?.from);
  const to = safeResolve(req.server.dir, req.body?.to);
  if (from === fs.realpathSync(req.server.dir)) throw httpError(400, 'Cannot rename the server folder');
  if (!fs.existsSync(from)) throw httpError(404, 'Not found');
  if (fs.existsSync(to)) throw httpError(409, 'Something with that name already exists');
  fs.renameSync(from, to);
  store.logActivity(actor(req), 'file.rename', req.server.id, `${req.body.from} → ${req.body.to}`);
  res.json({ ok: true });
});

r.delete('/servers/:id/files', g('files.manage'), (req, res) => {
  const p = safeResolve(req.server.dir, req.query.path);
  if (p === fs.realpathSync(req.server.dir)) throw httpError(400, 'Cannot delete the server folder');
  if (!fs.existsSync(p)) throw httpError(404, 'Not found');
  fs.rmSync(p, { recursive: true, force: true });
  store.logActivity(actor(req), 'file.delete', req.server.id, req.query.path);
  res.json({ ok: true });
});

r.get('/servers/:id/files/download', g('files.manage'), (req, res) => {
  const p = safeResolve(req.server.dir, req.query.path);
  let st;
  try { st = fs.statSync(p); } catch { throw httpError(404, 'Not found'); }
  if (st.isDirectory()) return streamZip(res, path.dirname(p), [path.basename(p)], path.basename(p) + '.zip');
  res.download(p, path.basename(p));
});

// ================= Mods & plugins =================
function addonDir(s) {
  const info = detect.inspect(s.dir);
  return { info, sub: info.addonsDir || 'mods' };
}

r.get('/servers/:id/addons', g('addons.manage'), (req, res) => {
  const { info, sub } = addonDir(req.server);
  const dir = path.join(req.server.dir, sub);
  const items = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch {}
  for (const f of files) {
    if (!/\.jar(\.disabled)?$/i.test(f)) continue;
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      items.push({ file: f, enabled: !f.endsWith('.disabled'), size: st.size, modified: st.mtimeMs, ...(zipmeta.meta(p) || {}) });
    } catch {}
  }
  items.sort((a, b) => (a.name || a.file).localeCompare(b.name || b.file, undefined, { sensitivity: 'base' }));
  res.json({ kind: sub === 'plugins' ? 'plugin' : 'mod', dir: sub, software: info.software, mcVersion: info.mcVersion, items, restartNeeded: !!manager.get(req.server.id).pid });
});

r.post('/servers/:id/addons/upload', g('addons.manage'), upload.array('files', 300), (req, res) => {
  try {
    const { sub } = addonDir(req.server);
    const dir = path.join(req.server.dir, sub);
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (const f of req.files || []) {
      const name = path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8'));
      if (!/\.jar$/i.test(name)) continue;
      fs.copyFileSync(f.path, path.join(dir, name));
      saved.push(name);
    }
    if (!saved.length) throw httpError(400, 'Only .jar files can be uploaded here');
    store.logActivity(actor(req), 'addon.upload', req.server.id, saved.join(', ').slice(0, 300));
    res.json({ ok: true, saved });
  } finally { cleanup(req.files); }
});

r.post('/servers/:id/addons/toggle', g('addons.manage'), (req, res) => {
  const { sub } = addonDir(req.server);
  const file = path.basename(String(req.body?.file || ''));
  const p = path.join(req.server.dir, sub, file);
  if (!/\.jar(\.disabled)?$/.test(file) || !fs.existsSync(p)) throw httpError(404, 'Not found');
  const next = file.endsWith('.disabled') ? file.slice(0, -9) : file + '.disabled';
  fs.renameSync(p, path.join(req.server.dir, sub, next));
  store.logActivity(actor(req), next.endsWith('.disabled') ? 'addon.disable' : 'addon.enable', req.server.id, file.replace(/\.disabled$/, ''));
  res.json({ ok: true, file: next });
});

r.delete('/servers/:id/addons', g('addons.manage'), (req, res) => {
  const { sub } = addonDir(req.server);
  const file = path.basename(String(req.query.file || ''));
  const p = path.join(req.server.dir, sub, file);
  if (!/\.jar(\.disabled)?$/.test(file) || !fs.existsSync(p)) throw httpError(404, 'Not found');
  fs.rmSync(p);
  store.logActivity(actor(req), 'addon.delete', req.server.id, file);
  res.json({ ok: true });
});

const MODRINTH = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'SquidPanel/2.0 (self-hosted Minecraft panel)' };
async function mr(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw httpError(502, `Modrinth returned ${res.status}`);
  return res.json();
}
function loaderFor(info) {
  const s = info.software;
  if (s === 'NeoForge') return { type: 'mod', loaders: ['neoforge'] };
  if (s === 'Forge') return { type: 'mod', loaders: ['forge'] };
  if (s === 'Fabric') return { type: 'mod', loaders: ['fabric'] };
  if (info.addonsDir === 'plugins' || ['Paper', 'Purpur', 'Spigot', 'Bukkit'].includes(s)) return { type: 'plugin', loaders: ['paper', 'spigot', 'bukkit', 'purpur'] };
  return { type: 'mod', loaders: [] };
}

r.get('/servers/:id/addons/modrinth', g('addons.manage'), async (req, res) => {
  const { info } = addonDir(req.server);
  const lf = loaderFor(info);
  const facets = [[`project_type:${lf.type}`]];
  if (lf.loaders.length) facets.push(lf.loaders.map(l => `categories:${l}`));
  if (info.mcVersion && req.query.anyVersion !== '1') facets.push([`versions:${info.mcVersion}`]);
  if (lf.type === 'mod') facets.push(['server_side:required', 'server_side:optional']);
  const q = new URLSearchParams({ query: String(req.query.q || ''), limit: '24', index: req.query.q ? 'relevance' : 'downloads', facets: JSON.stringify(facets) });
  const data = await mr(`${MODRINTH}/search?${q}`);
  res.json({ ...data, loaders: lf.loaders, mcVersion: info.mcVersion });
});

async function installProject(s, sub, info, projectId, seen, installed) {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const lf = loaderFor(info);
  const q = new URLSearchParams();
  if (lf.loaders.length) q.set('loaders', JSON.stringify(lf.loaders));
  if (info.mcVersion) q.set('game_versions', JSON.stringify([info.mcVersion]));
  const versions = await mr(`${MODRINTH}/project/${encodeURIComponent(projectId)}/version?${q}`);
  const v = versions.find(x => x.version_type === 'release') || versions[0];
  if (!v) throw httpError(404, `No version of this project supports ${info.software} ${info.mcVersion}`);
  const file = v.files.find(f => f.primary) || v.files[0];
  const dest = path.join(s.dir, sub, path.basename(file.filename));
  if (!fs.existsSync(dest)) {
    const resp = await fetch(file.url, { headers: UA });
    if (!resp.ok) throw httpError(502, `Download failed (${resp.status})`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.part', Buffer.from(await resp.arrayBuffer()));
    fs.renameSync(dest + '.part', dest);
    installed.push(file.filename);
  }
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      await installProject(s, sub, info, dep.project_id, seen, installed).catch(() => {});
    }
  }
}

r.post('/servers/:id/addons/modrinth/install', g('addons.manage'), async (req, res) => {
  const { info, sub } = addonDir(req.server);
  const projectId = String(req.body?.projectId || '');
  if (!/^[\w-]{2,64}$/.test(projectId)) throw httpError(400, 'Invalid project');
  const installed = [];
  await installProject(req.server, sub, info, projectId, new Set(), installed);
  store.logActivity(actor(req), 'addon.install', req.server.id, installed.join(', ') || `${projectId} (already installed)`);
  res.json({ ok: true, installed });
});

// ================= Worlds =================
const sizeCache = new Map();
async function dirSize(p) {
  const hit = sizeCache.get(p);
  if (hit && Date.now() - hit.at < 60000) return hit.size;
  const r2 = await run('du', ['-sk', p], { timeout: 30000 });
  const size = (parseInt(r2.stdout, 10) || 0) * 1024;
  sizeCache.set(p, { at: Date.now(), size });
  return size;
}

function worldGroups(dir) {
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'level.dat'))).map(e => e.name);
  const groups = [];
  for (const n of names) {
    const base = n.replace(/_(nether|the_end)$/, '');
    if (base !== n && names.includes(base)) continue; // dimension folder of another world
    groups.push({ name: n, folders: [n, ...['_nether', '_the_end'].map(x => n + x).filter(x => names.includes(x))] });
  }
  return groups;
}

r.get('/servers/:id/worlds', g('worlds.manage'), async (req, res) => {
  const s = req.server;
  const active = properties.read(s.dir)['level-name'] || 'world';
  const groups = worldGroups(s.dir);
  const worlds = await Promise.all(groups.map(async w => {
    const sizes = await Promise.all(w.folders.map(f => dirSize(path.join(s.dir, f))));
    let modified = 0;
    try { modified = fs.statSync(path.join(s.dir, w.name, 'level.dat')).mtimeMs; } catch {}
    return { name: w.name, folders: w.folders, size: sizes.reduce((a, b) => a + b, 0), modified, active: w.name === active };
  }));
  res.json({ active, worlds, running: !!manager.get(s.id).pid });
});

r.post('/servers/:id/worlds/activate', g('worlds.manage'), (req, res) => {
  const name = path.basename(String(req.body?.name || ''));
  if (!fs.existsSync(path.join(req.server.dir, name, 'level.dat'))) throw httpError(404, 'World not found');
  properties.write(req.server.dir, { 'level-name': name });
  store.logActivity(actor(req), 'world.activate', req.server.id, name);
  res.json({ ok: true, restartRequired: !!manager.get(req.server.id).pid });
});

r.post('/servers/:id/worlds/upload', g('worlds.manage'), upload.single('world'), async (req, res) => {
  const tmp = path.join(TMP, `world-${Date.now()}`);
  try {
    if (!req.file) throw httpError(400, 'No file uploaded');
    const name = String(req.body?.name || '').trim().replace(/[^\w.-]+/g, '_').slice(0, 48);
    if (!name) throw httpError(400, 'Give the world a folder name');
    const dest = path.join(req.server.dir, name);
    if (fs.existsSync(dest)) throw httpError(409, 'A folder with that name already exists');
    fs.mkdirSync(tmp, { recursive: true });
    const r2 = await run('unzip', ['-q', req.file.path, '-d', tmp]);
    if (r2.code > 1) throw httpError(400, 'Could not read that zip file');
    // Find the folder that holds level.dat (zip root or one level down).
    let src = null;
    if (fs.existsSync(path.join(tmp, 'level.dat'))) src = tmp;
    else for (const e of fs.readdirSync(tmp, { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(tmp, e.name, 'level.dat'))) { src = path.join(tmp, e.name); break; }
    if (!src) throw httpError(400, 'No level.dat found — is this a Minecraft world?');
    fs.renameSync(src, dest);
    store.logActivity(actor(req), 'world.upload', req.server.id, name);
    res.json({ ok: true, name });
  } finally {
    cleanup(req.file);
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
});

r.get('/servers/:id/worlds/:name/download', g('worlds.manage'), (req, res) => {
  const name = path.basename(req.params.name);
  const group = worldGroups(req.server.dir).find(w => w.name === name);
  if (!group) throw httpError(404, 'World not found');
  streamZip(res, req.server.dir, group.folders, `${req.server.id}-${name}.zip`);
});

r.delete('/servers/:id/worlds/:name', g('worlds.manage'), (req, res) => {
  const name = path.basename(req.params.name);
  const active = properties.read(req.server.dir)['level-name'] || 'world';
  if (name === active) throw httpError(409, 'This is the active world — switch to another world first');
  const group = worldGroups(req.server.dir).find(w => w.name === name);
  if (!group) throw httpError(404, 'World not found');
  for (const f of group.folders) fs.rmSync(path.join(req.server.dir, f), { recursive: true, force: true });
  store.logActivity(actor(req), 'world.delete', req.server.id, name);
  res.json({ ok: true });
});

// ================= Backups =================
r.get('/servers/:id/backups', g('backups.manage'), (req, res) => {
  let free = null;
  try { const st = fs.statfsSync(store.DATA_DIR); free = st.bavail * st.bsize; } catch {}
  res.json({ backups: backups.list(req.server), job: backups.jobs(req.server.id), schedule: req.server.backup, diskFree: free });
});
r.post('/servers/:id/backups', g('backups.manage'), async (req, res) => res.json(await backups.create(req.server, actor(req), { note: String(req.body?.note || '').slice(0, 120) })));
r.post('/servers/:id/backups/restore', g('backups.manage'), async (req, res) => res.json(await backups.restore(req.server, actor(req), req.body?.source, req.body?.file)));
r.delete('/servers/:id/backups', g('backups.manage'), (req, res) => {
  backups.remove(req.server, req.query.source, req.query.file);
  store.logActivity(actor(req), 'backup.delete', req.server.id, req.query.file);
  res.json({ ok: true });
});
r.get('/servers/:id/backups/download', g('backups.manage'), (req, res) => {
  const p = backups.resolve(req.server, req.query.source, req.query.file);
  res.download(p, `${req.server.id}-${path.basename(p)}`);
});

module.exports = r;
