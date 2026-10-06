// playit.gg integration: keeps the playit agent running (with the agent key the
// SquidServers app created) and switches each server's tunnels on while it runs
// and off when it stops — the same thing the SquidServers app does, without the app.
//
// If the SquidServers app already runs a playit agent, SquidPanel reuses it instead of
// starting a second one; tunnels follow the same rule either way (on while running).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const proc = require('./proc');
const properties = require('./properties');

const DIR = path.join(store.DATA_DIR, 'playit');
const APP_DATA = path.join(os.homedir(), 'Library/Application Support/squidservers');
const APP_KEY = path.join(APP_DATA, 'playit_agent_key');
const APP_BINS = [path.join(APP_DATA, 'playit_binaries/playit'), '/Applications/SquidServers.app/Contents/Resources/playit_binaries/playit'];
const BIN = path.join(DIR, 'playit');
const KEY = path.join(DIR, 'agent_key');
const PIDFILE = path.join(DIR, 'agent.pid');
const LOG = path.join(DIR, 'playit.log');
const SOCK = path.join(DIR, 'playitd.sock');
const API = 'https://api.playit.gg';

const state = { agent: 'stopped', pid: null, error: null, tunnels: [], tunnelsAt: 0, lastSync: null };
let busy = false;

function settings() {
  const s = store.get().settings;
  // Default on when the SquidServers app already set up playit on this Mac.
  if (!s.playit) { s.playit = { enabled: fs.existsSync(APP_KEY) }; store.save(); }
  return s.playit;
}

// Copy the binary and key into the panel's data folder so it keeps working even if
// the SquidServers app is removed later.
function prepare() {
  fs.mkdirSync(DIR, { recursive: true });
  const srcBin = APP_BINS.find(p => fs.existsSync(p));
  if (srcBin) {
    const need = !fs.existsSync(BIN) || fs.statSync(BIN).size !== fs.statSync(srcBin).size;
    if (need) { fs.copyFileSync(srcBin, BIN); fs.chmodSync(BIN, 0o755); }
  }
  if (fs.existsSync(APP_KEY)) {
    const k = fs.readFileSync(APP_KEY, 'utf8').trim();
    if (k && (!fs.existsSync(KEY) || fs.readFileSync(KEY, 'utf8').trim() !== k)) fs.writeFileSync(KEY, k, { mode: 0o600 });
  }
  if (!fs.existsSync(BIN)) throw new Error('playit binary not found (install/open the SquidServers app once)');
  if (!fs.existsSync(KEY)) throw new Error('playit agent key not found (set up playit in the SquidServers app once)');
}

function key() {
  try { return fs.readFileSync(KEY, 'utf8').trim(); } catch { return null; }
}

async function call(p, body) {
  const k = key();
  if (!k) throw new Error('No playit agent key');
  const res = await fetch(API + p, { method: 'POST', headers: { Authorization: `Agent-Key ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 'success') throw new Error(`playit ${p} failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data.data;
}

async function refreshTunnels() {
  const data = await call('/tunnels/list', { tunnel_id: null, agent_id: null });
  state.tunnels = (data.tunnels || []).map(t => {
    const a = (t.alloc && t.alloc.data) || {};
    const o = (t.origin && t.origin.data) || {};
    return {
      id: t.id, type: t.tunnel_type, active: !!t.active, disabledReason: t.disabled_reason || null,
      address: a.assigned_srv || (a.assigned_domain ? `${a.assigned_domain}${a.port_start ? ':' + a.port_start : ''}` : null),
      localPort: o.local_port || null,
    };
  });
  state.tunnelsAt = Date.now();
  return state.tunnels;
}

function readPid() {
  try { return parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10) || null; } catch { return null; }
}

function startAgent() {
  prepare();
  fs.rmSync(SOCK, { force: true });
  const child = spawn(BIN, ['--secret-path', KEY, '--socket-path', SOCK, '--log-path', LOG], { cwd: DIR, detached: true, stdio: 'ignore', env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } });
  child.unref();
  fs.writeFileSync(PIDFILE, String(child.pid));
  state.pid = child.pid;
  state.agent = 'running';
  store.logActivity('system', 'playit.start', null, `agent pid ${child.pid}`);
}

function stopAgent(reason) {
  const pid = readPid();
  if (pid && proc.alive(pid)) { proc.signal(pid, 'SIGTERM', false); store.logActivity('system', 'playit.stop', null, reason || ''); }
  fs.rmSync(PIDFILE, { force: true });
  state.pid = null;
}

// Is the SquidServers app running its own playit agent right now?
function appAgentPid(snap) {
  const ours = readPid();
  for (const p of snap.values()) {
    if (p.pid !== ours && /playit_binaries\/playit\b/.test(p.command) && !p.command.includes(DIR)) return p.pid;
  }
  return null;
}

function serverPort(s) {
  try { return parseInt(properties.read(s.dir)['server-port'], 10) || 25565; } catch { return null; }
}

// Turn each server's tunnels on while it runs, off when it is stopped.
async function syncTunnels(isRunning) {
  if (!settings().enabled || !['running', 'external'].includes(state.agent)) return;
  prepare();
  if (Date.now() - state.tunnelsAt > 60000) await refreshTunnels();
  let changed = false;
  for (const s of store.get().servers) {
    const port = serverPort(s);
    const want = isRunning(s.id);
    for (const t of state.tunnels.filter(x => x.localPort === port && !x.disabledReason)) {
      if (t.active === want) continue;
      await call('/tunnels/enable', { tunnel_id: t.id, enabled: want });
      t.active = want;
      changed = true;
      store.logActivity('system', want ? 'playit.tunnel_on' : 'playit.tunnel_off', s.id, t.address || t.id);
    }
  }
  if (changed) state.tunnelsAt = 0; // re-read authoritative state next time
  state.lastSync = Date.now();
}

async function tick(snap, isRunning) {
  if (busy) return;
  busy = true;
  try {
    const cfg = settings();
    const ours = readPid();
    const oursAlive = !!ours && proc.alive(ours);
    if (!cfg.enabled) {
      if (oursAlive) stopAgent('disabled in settings');
      state.agent = 'disabled';
      return;
    }
    const app = appAgentPid(snap);
    if (app) {
      // The app's agent is connected; never run two agents with one key — reuse it.
      if (oursAlive) stopAgent('SquidServers app agent is running');
      state.agent = 'external';
      state.pid = app;
    } else if (!oursAlive) startAgent();
    else { state.agent = 'running'; state.pid = ours; }
    // Tunnel rule is the same one the app uses (on while the server runs), so both can apply it safely.
    await syncTunnels(isRunning);
    state.error = null;
  } catch (e) {
    state.error = e.message;
  } finally {
    busy = false;
  }
}

function tunnelsForPort(port) {
  return state.tunnels.filter(t => t.localPort === port && t.address).map(t => ({ address: t.address, type: t.type, active: t.active }));
}

function status() {
  const s = store.get().servers;
  return {
    enabled: !!settings().enabled, agent: state.agent, pid: state.pid, error: state.error, lastSync: state.lastSync,
    keyFound: fs.existsSync(KEY) || fs.existsSync(APP_KEY), binaryFound: fs.existsSync(BIN) || APP_BINS.some(p => fs.existsSync(p)),
    tunnels: state.tunnels.map(t => ({ ...t, server: (s.find(x => serverPort(x) === t.localPort) || {}).name || null })),
  };
}

module.exports = { tick, status, refreshTunnels, tunnelsForPort, settings, stopAgent };
