// Server runtime manager.
//
// Servers launched by the panel run detached in their own process group with
//   stdout/stderr -> data/servers/<id>/console.log
//   stdin         <- data/servers/<id>/stdin.fifo  (held open read/write by the shell
//                    wrapper, so the server never sees EOF and the panel can restart
//                    without losing the console)
// Servers started elsewhere (e.g. the SquidServers app) are detected by working
// directory and adopted: logs come from logs/latest.log, commands go over RCON.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const store = require('./store');
const proc = require('./proc');
const java = require('./java');
const detect = require('./detect');
const properties = require('./properties');
const { rcon } = require('./rcon');
const playit = require('./playit');
const { run, httpError, stripAnsi, sleep } = require('./util');

const events = new EventEmitter();
events.setMaxListeners(500);
const RUNTIME_DIR = path.join(store.DATA_DIR, 'servers');
const LOG_KEEP = 1500;
const runtimes = new Map();

const RE = {
  done: /Done \([\d.,]+m?s\)! For help/,
  starting: /Starting minecraft server version|Loading Minecraft \d|ModLauncher running/i,
  stopping: /Stopping (the )?server\b/i,
  join: /:\s([.\w-]{1,24}) joined the game\s*$/,
  leave: /:\s([.\w-]{1,24}) left the game\s*$/,
  list: /There are (\d+) (?:of a max(?: of)?|\/) (\d+) players online:?\s*(.*)$/i,
  uuid: /UUID of player ([.\w-]{1,24}) is ([0-9a-f-]{32,36})/i,
};

function cfg(id) {
  const s = store.get().servers.find(x => x.id === id);
  if (!s) throw httpError(404, 'Server not found');
  return s;
}
function dataDir(id) {
  const d = path.join(RUNTIME_DIR, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function get(id) {
  if (!runtimes.has(id)) {
    runtimes.set(id, {
      id, status: 'offline', mode: null, pid: null, startedAt: null, onlineAt: null,
      players: new Map(), idleSince: null, stats: [], lastSample: 0, logs: [], tail: null,
      stopRequested: false, stopTimers: [], crashes: [], lastCrash: null, lastExitCode: null,
      usage: { cpu: 0, memMb: 0 }, busy: null, fifo: null,
    });
  }
  return runtimes.get(id);
}

// ---------- logs & parsing ----------
let pendingLogs = new Map();
function flushLogs() {
  for (const [id, entries] of pendingLogs) events.emit('log', id, entries);
  pendingLogs = new Map();
}
setInterval(flushLogs, 120);

function pushEntry(rt, entry, emit = true) {
  rt.logs.push(entry);
  if (rt.logs.length > LOG_KEEP) rt.logs.splice(0, rt.logs.length - LOG_KEEP);
  if (emit) {
    if (!pendingLogs.has(rt.id)) pendingLogs.set(rt.id, []);
    pendingLogs.get(rt.id).push(entry);
  }
}

function panelLog(rt, text) {
  pushEntry(rt, { t: Date.now(), l: `[SquidPanel] ${text}`, k: 'panel' });
}

let playitDirty = true;
function setStatus(rt, status) {
  if (rt.status === status) return;
  rt.status = status;
  if (status === 'starting' || status === 'offline') playitDirty = true;
  if (status === 'online') { rt.onlineAt = Date.now(); rt.idleSince = rt.players.size ? null : Date.now(); }
  events.emit('status', rt.id, status);
}

function playerRecord(sid, name) {
  const d = store.get();
  if (!d.players[sid]) d.players[sid] = {};
  if (!d.players[sid][name]) d.players[sid][name] = { name, uuid: null, firstSeen: Date.now(), lastLogin: null, lastLogout: null, logins: 0, playtimeMs: 0, sessions: [] };
  return d.players[sid][name];
}

function recordJoin(sid, name) {
  const p = playerRecord(sid, name);
  p.lastLogin = Date.now();
  p.logins += 1;
  p.sessions.push({ in: Date.now(), out: null });
  if (p.sessions.length > 40) p.sessions = p.sessions.slice(-40);
  store.save();
}

function recordLeave(sid, name) {
  const p = playerRecord(sid, name);
  p.lastLogout = Date.now();
  const open = [...p.sessions].reverse().find(s => !s.out);
  if (open) { open.out = Date.now(); p.playtimeMs += open.out - open.in; }
  store.save();
}

function parse(rt, raw, replay) {
  const line = stripAnsi(raw);
  let m;
  if (RE.done.test(line)) { if (rt.status === 'starting' || replay) setStatus(rt, 'online'); return; }
  if (replay && RE.starting.test(line)) { rt.players.clear(); rt.status = 'starting'; return; }
  if (RE.stopping.test(line) && (rt.status === 'online' || replay)) { setStatus(rt, 'stopping'); return; }
  if ((m = line.match(RE.uuid))) {
    if (!replay) { playerRecord(rt.id, m[1]).uuid = m[2]; store.save(); }
    return;
  }
  if ((m = line.match(RE.join))) {
    rt.players.set(m[1], Date.now());
    rt.idleSince = null;
    if (!replay) { recordJoin(rt.id, m[1]); events.emit('players', rt.id); }
    return;
  }
  if ((m = line.match(RE.leave))) {
    rt.players.delete(m[1]);
    if (!rt.players.size && rt.status === 'online') rt.idleSince = Date.now();
    if (!replay) { recordLeave(rt.id, m[1]); events.emit('players', rt.id); }
    return;
  }
  if (!replay && (m = line.match(RE.list))) {
    // Authoritative list response: reconcile our tracked set.
    const names = m[3].split(',').map(s => s.trim().replace(/^\[[^\]]*\]\s*/, '')).filter(Boolean);
    if (parseInt(m[1], 10) === names.length) {
      for (const n of [...rt.players.keys()]) if (!names.includes(n)) { rt.players.delete(n); recordLeave(rt.id, n); }
      for (const n of names) if (!rt.players.has(n)) { rt.players.set(n, Date.now()); recordJoin(rt.id, n); }
      if (!rt.players.size && rt.status === 'online' && !rt.idleSince) rt.idleSince = Date.now();
      if (rt.players.size) rt.idleSince = null;
      events.emit('players', rt.id);
    }
  }
}

function ingest(rt, text, replay) {
  const lines = text.split(/\r?\n/);
  for (const l of lines) {
    if (!l) continue;
    parse(rt, l, replay);
    pushEntry(rt, { t: Date.now(), l }, !replay);
  }
}

function pollTail(rt) {
  const t = rt.tail;
  if (!t) return;
  let st;
  try { st = fs.statSync(t.file); } catch { return; }
  if (st.size < t.pos) { t.pos = 0; t.partial = ''; }
  if (st.size === t.pos) return;
  const len = Math.min(st.size - t.pos, 2 * 1024 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(t.file, 'r');
  try { fs.readSync(fd, buf, 0, len, t.pos); } finally { fs.closeSync(fd); }
  t.pos += len;
  const text = t.partial + buf.toString('utf8');
  const cut = text.lastIndexOf('\n');
  if (cut === -1) { t.partial = text; return; }
  t.partial = text.slice(cut + 1);
  ingest(rt, text.slice(0, cut), false);
}

// Read an existing log to rebuild state (online/players) without recording history.
function replay(rt, file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { rt.tail = { file, pos: 0, partial: '' }; return; }
  const start = Math.max(0, size - 16 * 1024 * 1024);
  const buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const text = buf.toString('utf8');
  const cut = text.lastIndexOf('\n');
  const body = cut === -1 ? '' : text.slice(0, cut);
  const all = body.split(/\r?\n/).filter(Boolean);
  for (const l of all) parse(rt, l, true);
  rt.logs = all.slice(-500).map(l => ({ t: Date.now(), l }));
  rt.tail = { file, pos: start + (cut === -1 ? 0 : Buffer.byteLength(body, 'utf8') + 1), partial: '' };
}

// ---------- launching ----------
async function buildCommand(s, info) {
  const launch = s.launch || {};
  const type = launch.type && launch.type !== 'auto' ? launch.type : info.launch;
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` };
  let javaBin = null;
  if (launch.java && launch.java !== 'auto') javaBin = launch.java;
  else javaBin = (await java.pick(info.mcVersion)).runtime?.path || 'java';
  if (javaBin !== 'java') {
    env.JAVA_HOME = path.dirname(path.dirname(javaBin));
    env.PATH = `${path.dirname(javaBin)}:${env.PATH}`;
  }
  if (type === 'custom') {
    if (!launch.custom) throw httpError(400, 'Custom start command is empty');
    return { cmd: ['/bin/sh', '-c', launch.custom], env, display: launch.custom, javaBin: null };
  }
  if (type === 'script') {
    const script = launch.script || info.script || 'run.sh';
    let body = '';
    try { body = fs.readFileSync(path.join(s.dir, script), 'utf8'); } catch { throw httpError(400, `Start script ${script} not found`); }
    const args = ['/bin/sh', `./${script}`];
    if (!/nogui/.test(body)) args.push('nogui');
    return { cmd: args, env, display: args.slice(1).join(' '), javaBin: (body.match(/"([^"]+\/bin\/java)"/) || [])[1] || javaBin };
  }
  const jar = launch.jar || info.jar;
  if (!jar) throw httpError(400, 'No server jar found in the server folder');
  const min = launch.minRam || '1G', max = launch.maxRam || '4G';
  const extra = String(launch.jvmArgs || '').split(/\s+/).filter(Boolean);
  const cmd = [javaBin, `-Xms${min}`, `-Xmx${max}`, '-Djava.awt.headless=true', ...extra, '-jar', jar, 'nogui'];
  // Name the JDK by its folder (jdk-25, temurin-21.jdk) rather than the generic "Home".
  const jdk = (javaBin.match(/\/((?:jdk|openjdk|temurin|zulu)[^/]*)\//i) || [])[1] || 'java';
  return { cmd, env, display: [jdk, ...cmd.slice(1)].join(' '), javaBin };
}

function writeRuntimeFile(id, data) {
  const f = path.join(dataDir(id), 'runtime.json');
  if (data) fs.writeFileSync(f, JSON.stringify(data)); else fs.rmSync(f, { force: true });
}

function isRunning(rt) { return !!rt.pid || ['starting', 'online', 'stopping'].includes(rt.status); }

async function start(id, actor = 'system') {
  const s = cfg(id);
  const rt = get(id);
  if (rt.busy) throw httpError(409, `Server is busy: ${rt.busy}`);
  if (isRunning(rt)) throw httpError(409, 'Server is already running');
  const info = detect.inspect(s.dir);
  if (!fs.existsSync(s.dir)) throw httpError(400, `Server folder is missing: ${s.dir}`);
  if (!info.eula) throw httpError(409, 'The Minecraft EULA has not been accepted for this server', { code: 'eula' });
  const listeners = await proc.listeners();
  if (listeners.has(info.port)) {
    throw httpError(409, `Port ${info.port} is already in use (pid ${listeners.get(info.port)}). Another server — or the SquidServers app — may be using it.`);
  }
  const { cmd, env, display } = await buildCommand(s, info);
  const dir = dataDir(id);
  const fifo = path.join(dir, 'stdin.fifo');
  fs.rmSync(fifo, { force: true });
  const mk = await run('mkfifo', [fifo]);
  if (mk.code !== 0) throw httpError(500, 'Could not create console pipe: ' + mk.stderr);
  const logFile = path.join(dir, 'console.log');
  if (fs.existsSync(logFile)) fs.renameSync(logFile, path.join(dir, 'console.prev.log'));
  fs.writeFileSync(logFile, `[SquidPanel] Starting ${s.name}: ${display}\n`);
  const fd = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawn('/bin/sh', ['-c', 'exec 3<>"$0"; exec "$@" <&3 3<&-', fifo, ...cmd], { cwd: s.dir, detached: true, stdio: ['ignore', fd, fd], env });
  } finally {
    fs.closeSync(fd);
  }
  child.unref();
  child.on('exit', code => { rt.lastExitCode = code; });
  child.on('error', err => { rt.lastExitCode = -1; panelLog(rt, `Failed to launch: ${err.message}`); });

  Object.assign(rt, {
    mode: 'managed', pid: child.pid, startedAt: Date.now(), onlineAt: null, stopRequested: false, fifo,
    players: new Map(), idleSince: null, logs: [], stats: [], lastExitCode: null, tail: { file: logFile, pos: 0, partial: '' },
  });
  rt.stopTimers.forEach(clearTimeout); rt.stopTimers = [];
  setStatus(rt, 'starting');
  writeRuntimeFile(id, { pid: child.pid, startedAt: rt.startedAt, fifo, logFile });
  store.logActivity(actor, 'server.start', id, '');
  ensureCaffeinate(rt);
  return { ok: true, pid: child.pid };
}

function writeStdin(rt, line) {
  if (rt.mode !== 'managed' || !rt.fifo) return false;
  try {
    const fd = fs.openSync(rt.fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    try { fs.writeSync(fd, line.replace(/\r?\n/g, ' ') + '\n'); } finally { fs.closeSync(fd); }
    return true;
  } catch {
    return false;
  }
}

function rconConfig(s) {
  const p = properties.read(s.dir);
  if (String(p['enable-rcon']).toLowerCase() !== 'true' || !p['rcon.password']) return null;
  return { host: '127.0.0.1', port: parseInt(p['rcon.port'], 10) || 25575, password: p['rcon.password'] };
}

function consoleChannel(id) {
  const rt = get(id);
  if (!rt.pid) return null;
  if (rt.mode === 'managed') return 'stdin';
  return rconConfig(cfg(id)) ? 'rcon' : null;
}

async function command(id, text, actor, { silent } = {}) {
  const rt = get(id);
  const s = cfg(id);
  const cmd = String(text || '').trim().replace(/^\/+/, '');
  if (!cmd) throw httpError(400, 'Empty command');
  if (!rt.pid) throw httpError(409, 'Server is offline');
  if (!silent) pushEntry(rt, { t: Date.now(), l: `> ${cmd}`, k: 'cmd', u: actor });
  if (rt.mode === 'managed') {
    if (!writeStdin(rt, cmd)) throw httpError(409, 'Console pipe is not ready yet — try again in a moment');
  } else {
    const rc = rconConfig(s);
    if (!rc) throw httpError(409, 'This server was started outside SquidPanel and RCON is off, so the console is read-only. Restart it from the panel (or enable RCON in Settings) to send commands.');
    try {
      const out = await rcon(rc, cmd);
      for (const l of stripAnsi(out).split('\n').filter(Boolean)) pushEntry(rt, { t: Date.now(), l, k: 'rcon' });
    } catch (e) {
      throw httpError(502, 'RCON: ' + e.message);
    }
  }
  if (!silent) store.logActivity(actor, 'console.command', id, cmd.slice(0, 300));
  return { ok: true };
}

async function stop(id, actor = 'system', { reason } = {}) {
  const s = cfg(id);
  const rt = get(id);
  if (!rt.pid) {
    if (rt.status !== 'offline') { setStatus(rt, 'offline'); return { ok: true }; }
    throw httpError(409, 'Server is not running');
  }
  rt.stopRequested = true;
  setStatus(rt, 'stopping');
  panelLog(rt, `Stop requested by ${actor}${reason ? ` (${reason})` : ''}`);
  let sent = false;
  if (rt.mode === 'managed') sent = writeStdin(rt, 'stop');
  else if (rconConfig(s)) { try { await rcon(rconConfig(s), 'stop'); sent = true; } catch {} }
  if (!sent) proc.signal(rt.pid, 'SIGTERM', rt.mode === 'managed');
  const timeout = Math.max(15, parseInt(s.settings?.stopTimeout, 10) || 90) * 1000;
  rt.stopTimers.forEach(clearTimeout);
  const pid = rt.pid;
  rt.stopTimers = [
    setTimeout(() => { if (rt.pid === pid && proc.alive(pid)) { panelLog(rt, 'Still running — sending SIGTERM'); proc.signal(pid, 'SIGTERM', rt.mode === 'managed'); } }, timeout),
    setTimeout(() => { if (rt.pid === pid && proc.alive(pid)) { panelLog(rt, 'Did not exit — force killing'); proc.signal(pid, 'SIGKILL', rt.mode === 'managed'); } }, timeout + 20000),
  ];
  store.logActivity(actor, reason === 'idle' ? 'server.autostop' : 'server.stop', id, reason || '');
  return { ok: true };
}

function kill(id, actor) {
  const rt = get(id);
  if (!rt.pid) throw httpError(409, 'Server is not running');
  rt.stopRequested = true;
  panelLog(rt, `Force killed by ${actor}`);
  proc.signal(rt.pid, 'SIGKILL', rt.mode === 'managed');
  store.logActivity(actor, 'server.kill', id, '');
  return { ok: true };
}

async function waitOffline(id, ms) {
  const rt = get(id);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!rt.pid && rt.status === 'offline') return true;
    await sleep(500);
  }
  return false;
}

async function restart(id, actor) {
  const rt = get(id);
  if (rt.pid) {
    await stop(id, actor, { reason: 'restart' });
    const s = cfg(id);
    const ok = await waitOffline(id, (Math.max(15, parseInt(s.settings?.stopTimeout, 10) || 90) + 30) * 1000);
    if (!ok) throw httpError(500, 'Server did not stop in time');
  }
  await sleep(1000);
  return start(id, actor);
}

function onExit(rt) {
  pollTail(rt);
  const wasRequested = rt.stopRequested;
  const prev = rt.status;
  for (const name of rt.players.keys()) recordLeave(rt.id, name);
  rt.players.clear();
  rt.stopTimers.forEach(clearTimeout); rt.stopTimers = [];
  const code = rt.lastExitCode;
  Object.assign(rt, { pid: null, mode: null, fifo: null, startedAt: null, onlineAt: null, idleSince: null, usage: { cpu: 0, memMb: 0 } });
  writeRuntimeFile(rt.id, null);
  panelLog(rt, `Server process exited${code != null ? ` (code ${code})` : ''}`);
  setStatus(rt, 'offline');
  events.emit('players', rt.id);
  if (!wasRequested && (prev === 'online' || prev === 'starting')) {
    rt.lastCrash = Date.now();
    store.logActivity('system', 'server.crash', rt.id, prev === 'starting' ? 'Exited while starting' : 'Exited unexpectedly');
    let s;
    try { s = cfg(rt.id); } catch { return; }
    rt.crashes = rt.crashes.filter(t => Date.now() - t < 10 * 60 * 1000);
    if (s.settings?.restartOnCrash && prev === 'online' && rt.crashes.length < 3) {
      rt.crashes.push(Date.now());
      panelLog(rt, 'Crash detected — restarting in 10 seconds');
      setTimeout(() => start(rt.id, 'system').catch(e => panelLog(rt, `Auto-restart failed: ${e.message}`)), 10000);
    }
  }
}

// ---------- adoption of servers started elsewhere ----------
const cwdCache = new Map();
async function adoptScan(snap) {
  const managed = new Set();
  for (const rt of runtimes.values()) if (rt.pid) for (const p of proc.tree(snap, rt.pid)) managed.add(p.pid);
  const javas = [...snap.values()].filter(p => !managed.has(p.pid) && /(^|\/)java$/.test(p.command.split(/\s+/)[0]));
  const unknown = javas.filter(p => !cwdCache.has(p.pid)).map(p => p.pid);
  if (unknown.length) for (const [pid, cwd] of await proc.cwdOf(unknown)) cwdCache.set(pid, cwd);
  for (const pid of cwdCache.keys()) if (!snap.has(pid)) cwdCache.delete(pid);
  for (const s of store.get().servers) {
    const rt = get(s.id);
    if (rt.pid || rt.busy) continue;
    let real;
    try { real = fs.realpathSync(s.dir); } catch { continue; }
    const hit = javas.find(p => cwdCache.get(p.pid) === real);
    if (!hit) continue;
    Object.assign(rt, { mode: 'external', pid: hit.pid, startedAt: Date.now() - hit.etime * 1000, stopRequested: false, players: new Map(), fifo: null });
    rt.status = 'starting';
    replay(rt, path.join(s.dir, 'logs', 'latest.log'));
    if (rt.status === 'starting' && hit.etime > 240) rt.status = 'online';
    const st = rt.status; rt.status = 'starting'; setStatus(rt, st);
    if (st === 'online' && !rt.players.size) rt.idleSince = Date.now();
    panelLog(rt, `Detected this server running outside SquidPanel (pid ${hit.pid}). Console is ${rconConfig(s) ? 'connected via RCON' : 'read-only (RCON off)'}.`);
    store.logActivity('system', 'server.detected', s.id, `pid ${hit.pid}`);
    events.emit('players', s.id);
    ensureCaffeinate(rt);
  }
}

// Re-attach to servers this panel launched before it was restarted.
function reattach() {
  for (const s of store.get().servers) {
    const f = path.join(RUNTIME_DIR, s.id, 'runtime.json');
    let r;
    try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const rt = get(s.id);
    if (!proc.alive(r.pid)) { fs.rmSync(f, { force: true }); continue; }
    Object.assign(rt, { mode: 'managed', pid: r.pid, startedAt: r.startedAt, fifo: r.fifo, stopRequested: false });
    rt.status = 'starting';
    replay(rt, r.logFile);
    if (rt.status === 'starting' && Date.now() - r.startedAt > 240000) rt.status = 'online';
    if (rt.status === 'online') { rt.onlineAt = Date.now(); if (!rt.players.size) rt.idleSince = Date.now(); }
    panelLog(rt, `Panel restarted — reattached to running server (pid ${r.pid})`);
  }
}

// ---------- keep the Mac awake while a server runs ----------
let lastSnap = new Map();
function ensureCaffeinate(rt) {
  if (!store.get().settings.preventSleep || !rt.pid) return;
  const already = [...lastSnap.values()].some(p => p.command === `caffeinate -i -w ${rt.pid}`);
  if (already || rt.caffeinatedFor === rt.pid) return;
  try {
    spawn('/usr/bin/caffeinate', ['-i', '-w', String(rt.pid)], { detached: true, stdio: 'ignore' }).unref();
    rt.caffeinatedFor = rt.pid;
  } catch {}
}

// ---------- monitor loop ----------
let ticks = 0;
async function tick() {
  ticks++;
  let snap;
  try { snap = await proc.snapshot(); } catch { return; }
  lastSnap = snap;
  for (const s of store.get().servers) {
    const rt = get(s.id);
    pollTail(rt);
    if (rt.pid) {
      if (!snap.has(rt.pid)) {
        // The snapshot can predate a server started while it was being taken; only a
        // direct liveness check (kill -0) is authoritative.
        if (!proc.alive(rt.pid)) onExit(rt);
        continue;
      }
      const u = proc.usage(snap, rt.pid);
      rt.usage = { cpu: Math.round(u.cpu * 10) / 10, memMb: u.memMb };
    }
    if (Date.now() - rt.lastSample >= 5000) {
      rt.lastSample = Date.now();
      if (rt.pid) {
        rt.stats.push({ t: Date.now(), cpu: rt.usage.cpu, mem: rt.usage.memMb, players: rt.players.size });
        if (rt.stats.length > 720) rt.stats.splice(0, rt.stats.length - 720);
      }
    }
    // Idle auto-stop.
    const st = s.settings || {};
    if (rt.status === 'online' && !rt.busy) {
      if (rt.players.size) rt.idleSince = null;
      else {
        if (!rt.idleSince) rt.idleSince = Date.now();
        if (st.autoStop && Date.now() - rt.idleSince >= (st.idleMinutes || 10) * 60000 && !rt.stopRequested) {
          stop(s.id, 'system', { reason: 'idle' }).catch(() => {});
        }
      }
    }
  }
  if (ticks % 3 === 1) await adoptScan(snap).catch(e => console.error('[adopt]', e.message));
  // Keep playit running and each server's tunnel on/off to match (every 10s, or right after a start/stop).
  if (playitDirty || ticks % 5 === 0) {
    playitDirty = false;
    playit.tick(snap, id => !!get(id).pid || ['starting', 'online'].includes(get(id).status)).catch(() => {});
  }
}

// Read new console output 4x a second so replies appear right after the command
// (the 2s monitor loop is too slow for an interactive console).
setInterval(() => {
  for (const rt of runtimes.values()) {
    if (rt.pid && rt.tail) { try { pollTail(rt); } catch {} }
  }
}, 250).unref();

let loop = null;
function boot() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  reattach();
  const runLoop = async () => {
    try { await tick(); } catch (e) { console.error('[tick]', e); }
    loop = setTimeout(runLoop, 2000);
  };
  runLoop();
  // Auto-start servers flagged for it, after the first adoption scan has had a chance to run.
  setTimeout(() => {
    for (const s of store.get().servers) {
      if (s.settings?.autoStart && !get(s.id).pid) start(s.id, 'system').catch(e => console.error(`[autostart ${s.id}]`, e.message));
    }
  }, 8000);
}

function memLimitMb(s) {
  const { parseSize } = require('./util');
  const type = s.launch?.type && s.launch.type !== 'auto' ? s.launch.type : (fs.existsSync(path.join(s.dir, 'run.sh')) ? 'script' : 'jar');
  if (type === 'script') {
    try {
      const m = fs.readFileSync(path.join(s.dir, 'user_jvm_args.txt'), 'utf8').match(/^-Xmx(\S+)/m);
      if (m) return parseSize(m[1], 4096);
    } catch {}
  }
  return parseSize(s.launch?.maxRam || '4G', 4096);
}

function summary(id) {
  const s = cfg(id);
  const rt = get(id);
  const info = { port: null, maxPlayers: 20 };
  try { const p = properties.read(s.dir); info.port = parseInt(p['server-port'], 10) || 25565; info.maxPlayers = parseInt(p['max-players'], 10) || 20; } catch {}
  const st = s.settings || {};
  return {
    id, status: rt.status, mode: rt.mode, pid: rt.pid, startedAt: rt.startedAt, onlineAt: rt.onlineAt,
    cpu: rt.usage.cpu, memMb: rt.usage.memMb, memLimitMb: memLimitMb(s),
    players: [...rt.players.keys()], maxPlayers: info.maxPlayers, port: info.port,
    idle: { enabled: !!st.autoStop, minutes: st.idleMinutes || 10, since: rt.status === 'online' ? rt.idleSince : null },
    console: consoleChannel(id), busy: rt.busy, lastCrash: rt.lastCrash, tunnels: info.port ? playit.tunnelsForPort(info.port) : [],
  };
}

function forget(id) {
  const rt = runtimes.get(id);
  if (rt && rt.pid) throw httpError(409, 'Stop the server before removing it');
  runtimes.delete(id);
}

module.exports = {
  events, boot, get, start, stop, kill, restart, command, writeStdin, summary, consoleChannel, isRunning, waitOffline, forget,
  logs: (id, n = 500) => get(id).logs.slice(-n), stats: id => get(id).stats, rconConfig, panelLog: (id, t) => panelLog(get(id), t),
};
