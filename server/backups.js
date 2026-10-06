// Backups: zipped with the native `zip`/`unzip` tools so huge worlds never block the
// event loop. Panel backups live in data/backups/<serverId>; the SquidServers app's
// own "<folder>-backups" directory is listed alongside them.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const store = require('./store');
const manager = require('./manager');
const { run, httpError, sleep } = require('./util');

const ROOT = path.join(store.DATA_DIR, 'backups');
const TRASH = path.join(store.DATA_DIR, 'trash');
const events = new EventEmitter();
const jobs = new Map(); // serverId -> job

const EXCLUDE = ['libraries/*', 'versions/*', 'cache/*', 'logs/*', 'crash-reports/*', 'debug/*', '.mixin.out/*', 'dynamic-data-pack-cache/*', '*/session.lock', '.DS_Store', '*/.DS_Store'];

function sources(s) {
  return [
    { source: 'panel', label: 'SquidPanel', dir: path.join(ROOT, s.id) },
    { source: 'squidservers', label: 'SquidServers app', dir: `${s.dir.replace(/\/+$/, '')}-backups` },
  ];
}

function resolve(s, source, file) {
  const src = sources(s).find(x => x.source === source);
  if (!src) throw httpError(400, 'Unknown backup source');
  const name = path.basename(String(file || ''));
  if (!name.endsWith('.zip')) throw httpError(400, 'Invalid backup name');
  const p = path.join(src.dir, name);
  if (!fs.existsSync(p)) throw httpError(404, 'Backup not found');
  return p;
}

function list(s) {
  const out = [];
  for (const src of sources(s)) {
    let files = [];
    try { files = fs.readdirSync(src.dir).filter(f => f.endsWith('.zip')); } catch { continue; }
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(src.dir, f));
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(src.dir, f + '.json'), 'utf8')); } catch {}
        out.push({ source: src.source, sourceLabel: src.label, file: f, size: st.size, created: meta.created || st.mtimeMs, kind: meta.kind || (/automatic|auto/.test(f) ? 'auto' : 'manual'), note: meta.note || '', actor: meta.actor || '' });
      } catch {}
    }
  }
  return out.sort((a, b) => b.created - a.created);
}

function setJob(id, patch) {
  const job = { ...(jobs.get(id) || {}), ...patch, serverId: id };
  if (patch === null) { jobs.delete(id); events.emit('job', { serverId: id, done: true }); return null; }
  jobs.set(id, job);
  events.emit('job', job);
  return job;
}

async function waitForSave(rt, ms) {
  const mark = rt.logs.length ? rt.logs[rt.logs.length - 1] : null;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const idx = mark ? rt.logs.lastIndexOf(mark) : -1;
    if (rt.logs.slice(idx + 1).some(e => /Saved the game|All dimensions are saved|Saved the world/i.test(e.l))) return true;
    await sleep(300);
  }
  return false;
}

async function create(s, actor, { kind = 'manual', note = '' } = {}) {
  if (jobs.has(s.id)) throw httpError(409, 'A backup job is already running for this server');
  const rt = manager.get(s.id);
  const dir = path.join(ROOT, s.id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
  const file = `${stamp}_${kind}.zip`;
  const out = path.join(dir, file);
  const partial = out + '.partial';
  setJob(s.id, { type: 'backup', status: 'running', step: 'Preparing', startedAt: Date.now(), bytes: 0, file });

  (async () => {
    const live = !!manager.consoleChannel(s.id);
    try {
      if (live) {
        setJob(s.id, { step: 'Saving world' });
        await manager.command(s.id, 'save-off', 'system', { silent: true }).catch(() => {});
        await manager.command(s.id, 'save-all flush', 'system', { silent: true }).catch(() => {});
        await waitForSave(rt, 15000);
      }
      setJob(s.id, { step: 'Compressing' });
      const poll = setInterval(() => { try { setJob(s.id, { bytes: fs.statSync(partial).size }); } catch {} }, 1000);
      const r = await run('zip', ['-r', '-q', '-y', partial, '.', '-x', ...EXCLUDE], { cwd: s.dir });
      clearInterval(poll);
      // zip exits 18 when some files could not be read (e.g. vanished mid-backup) — still usable.
      if (r.code !== 0 && r.code !== 18) throw new Error(r.stderr.trim() || `zip exited with ${r.code}`);
      fs.renameSync(partial, out);
      fs.writeFileSync(out + '.json', JSON.stringify({ kind, note, actor, created: Date.now() }));
      const size = fs.statSync(out).size;
      store.logActivity(actor, kind === 'auto' ? 'backup.auto' : 'backup.create', s.id, `${file} (${Math.round(size / 1048576)} MB)`);
      if (kind === 'auto') prune(s);
      setJob(s.id, { status: 'done', step: 'Done', bytes: size });
    } catch (e) {
      fs.rmSync(partial, { force: true });
      store.logActivity(actor, 'backup.failed', s.id, e.message);
      setJob(s.id, { status: 'error', step: 'Failed', error: e.message });
    } finally {
      if (live) await manager.command(s.id, 'save-on', 'system', { silent: true }).catch(() => {});
      setTimeout(() => { if (jobs.get(s.id)?.status !== 'running') setJob(s.id, null); }, 4000);
    }
  })();
  return { ok: true, file };
}

function prune(s) {
  const keep = Math.max(1, parseInt(s.backup?.keep, 10) || 7);
  const autos = list(s).filter(b => b.source === 'panel' && b.kind === 'auto');
  for (const b of autos.slice(keep)) remove(s, 'panel', b.file);
}

function remove(s, source, file) {
  const p = resolve(s, source, file);
  fs.rmSync(p, { force: true });
  fs.rmSync(p + '.json', { force: true });
}

async function restore(s, actor, source, file) {
  const zip = resolve(s, source, file);
  const rt = manager.get(s.id);
  if (rt.pid) throw httpError(409, 'Stop the server before restoring a backup');
  if (jobs.has(s.id)) throw httpError(409, 'Another backup job is running');
  rt.busy = 'Restoring backup';
  setJob(s.id, { type: 'restore', status: 'running', step: 'Reading backup', startedAt: Date.now(), file });
  (async () => {
    try {
      const listing = await run('unzip', ['-Z1', zip]);
      if (listing.code !== 0) throw new Error('Backup archive is unreadable');
      const tops = new Set(listing.stdout.split('\n').filter(Boolean).map(n => n.split('/')[0]).filter(n => n && n !== '..'));
      // Worlds are replaced wholesale (so stale chunks do not survive); existing copies go to the panel trash.
      const trash = path.join(TRASH, s.id, `restore-${Date.now()}`);
      for (const top of tops) {
        const target = path.join(s.dir, top);
        if (fs.existsSync(path.join(target, 'level.dat'))) {
          fs.mkdirSync(trash, { recursive: true });
          fs.renameSync(target, path.join(trash, top));
        }
      }
      setJob(s.id, { step: 'Extracting' });
      const r = await run('unzip', ['-o', '-q', zip, '-d', s.dir]);
      if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || `unzip exited with ${r.code}`);
      store.logActivity(actor, 'backup.restore', s.id, file);
      setJob(s.id, { status: 'done', step: 'Restored' });
    } catch (e) {
      store.logActivity(actor, 'backup.failed', s.id, 'restore: ' + e.message);
      setJob(s.id, { status: 'error', step: 'Failed', error: e.message });
    } finally {
      rt.busy = null;
      setTimeout(() => { if (jobs.get(s.id)?.status !== 'running') setJob(s.id, null); }, 4000);
    }
  })();
  return { ok: true };
}

// Hourly-resolution scheduler for automatic backups.
function schedule() {
  setInterval(() => {
    for (const s of store.get().servers) {
      const b = s.backup || {};
      if (!b.enabled || jobs.has(s.id) || manager.get(s.id).busy) continue;
      const every = Math.max(1, parseFloat(b.everyHours) || 24) * 3600000;
      if (Date.now() - (b.lastAuto || 0) < every) continue;
      // Skip if nothing could have changed: server offline for the whole window.
      const rt = manager.get(s.id);
      if (b.onlyWhenUsed !== false && !rt.pid && b.lastAuto && (s.lastStoppedAt || 0) < b.lastAuto) continue;
      s.backup = { ...b, lastAuto: Date.now() };
      store.save();
      create(s, 'system', { kind: 'auto' }).catch(() => {});
    }
  }, 60000);
}

manager.events.on('status', (id, status) => {
  if (status !== 'offline') return;
  const s = store.get().servers.find(x => x.id === id);
  if (s) { s.lastStoppedAt = Date.now(); store.save(); }
});

module.exports = { list, create, restore, remove, resolve, schedule, events, jobs: id => jobs.get(id) || null };
