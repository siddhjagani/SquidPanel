// Host information, Java runtimes, activity log and panel-wide settings.
const express = require('express');
const fs = require('fs');
const os = require('os');
const store = require('../store');
const rbac = require('../rbac');
const auth = require('../auth');
const java = require('../java');
const playit = require('../playit');
const { version } = require('../../package.json');
const { run } = require('../util');

const r = express.Router();
r.use(auth.requireAuth);

// Host CPU usage from os.cpus() deltas.
let prev = os.cpus();
let hostCpu = 0;
setInterval(() => {
  const cur = os.cpus();
  let idle = 0, total = 0;
  cur.forEach((c, i) => {
    const p = prev[i] || c;
    const t = Object.values(c.times).reduce((a, b) => a + b, 0) - Object.values(p.times).reduce((a, b) => a + b, 0);
    total += t;
    idle += c.times.idle - p.times.idle;
  });
  hostCpu = total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
  prev = cur;
}, 3000).unref();

// macOS reports most RAM as "used" because of file cache; vm_stat gives the
// memory that is actually available (free + inactive + speculative + purgeable).
let memAvailable = null;
async function sampleMemory() {
  if (process.platform !== 'darwin') return;
  const r = await run('vm_stat', [], { timeout: 3000 });
  const page = parseInt((r.stdout.match(/page size of (\d+)/) || [])[1], 10) || 16384;
  const get = k => parseInt((r.stdout.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1], 10) || 0;
  const avail = (get('Pages free') + get('Pages inactive') + get('Pages speculative') + get('Pages purgeable')) * page;
  if (avail > 0) memAvailable = avail;
}
sampleMemory();
setInterval(sampleMemory, 5000).unref();

function host() {
  let disk = null;
  try {
    const dir = (store.get().settings.scanDirs || [])[0] || os.homedir();
    const st = fs.statfsSync(fs.existsSync(dir) ? dir : os.homedir());
    disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
  } catch {}
  return {
    hostname: process.env.SQUIDPANEL_HOST_LABEL || os.hostname().replace(/\.local$/, ''), platform: `${os.type()} ${os.release()}`, arch: os.arch(),
    cpuModel: os.cpus()[0]?.model || '', cores: os.cpus().length, cpu: hostCpu,
    memTotal: os.totalmem(), memFree: memAvailable ?? os.freemem(), uptime: os.uptime(), load: os.loadavg(), disk,
    panel: { version, node: process.version, uptime: process.uptime(), dataDir: store.DATA_DIR },
  };
}

r.get('/system', (req, res) => res.json({ host: host() }));

r.get('/system/java', auth.requireAdmin, async (req, res) => res.json({ runtimes: await java.runtimes(req.query.refresh === '1') }));

r.get('/system/playit', auth.requireAdmin, async (req, res) => {
  if (req.query.refresh === '1') await playit.refreshTunnels().catch(() => {});
  res.json(playit.status());
});

r.get('/system/settings', auth.requireAdmin, (req, res) => res.json({ settings: store.get().settings }));
r.patch('/system/settings', auth.requireAdmin, (req, res) => {
  const s = store.get().settings;
  const { scanDirs, preventSleep, publicUrl, playit: pl } = req.body || {};
  if (pl && pl.enabled !== undefined) { playit.settings().enabled = !!pl.enabled; if (!pl.enabled) playit.stopAgent('disabled in settings'); }
  if (Array.isArray(scanDirs)) s.scanDirs = scanDirs.map(d => String(d).trim().replace(/^~(?=\/)/, os.homedir())).filter(Boolean).slice(0, 10);
  if (preventSleep !== undefined) s.preventSleep = !!preventSleep;
  if (publicUrl !== undefined) s.publicUrl = String(publicUrl).trim().slice(0, 200);
  store.save();
  store.logActivity(req.user.username, 'panel.settings', null, Object.keys(req.body || {}).join(', '));
  res.json({ ok: true, settings: s });
});

r.get('/activity', (req, res) => {
  const d = store.get();
  const admin = rbac.isAdmin(req.user);
  const visible = new Set(d.servers.filter(s => rbac.access(req.user, s.id).view).map(s => s.id));
  const { server, user, q } = req.query;
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
  const out = [];
  for (const a of d.activity) {
    if (!admin && !(a.serverId && visible.has(a.serverId)) && a.actor !== req.user.username) continue;
    if (!admin && a.action.startsWith('account.login_failed')) continue;
    if (server && a.serverId !== server) continue;
    if (user && a.actor !== user) continue;
    if (q && !`${a.action} ${a.detail} ${a.actor}`.toLowerCase().includes(String(q).toLowerCase())) continue;
    out.push(a);
    if (out.length >= limit) break;
  }
  res.json({ activity: out });
});

module.exports = { router: r, host };
