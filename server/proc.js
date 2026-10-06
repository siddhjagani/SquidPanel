// macOS/Linux process inspection via `ps` and `lsof` (one cheap call per tick
// instead of one per process).
const { run } = require('./util');

function parseEtime(s) {
  // [[dd-]hh:]mm:ss
  const m = String(s).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

async function snapshot() {
  const r = await run('ps', ['-axo', 'pid=,ppid=,pgid=,pcpu=,rss=,etime=,command='], { timeout: 5000 });
  const map = new Map();
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    map.set(+m[1], { pid: +m[1], ppid: +m[2], pgid: +m[3], cpu: parseFloat(m[4]), rssKb: +m[5], etime: parseEtime(m[6]), command: m[7] });
  }
  return map;
}

// Root process plus all descendants.
function tree(snap, rootPid) {
  const children = new Map();
  for (const p of snap.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const out = [];
  const root = snap.get(rootPid);
  if (!root) return out;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    for (const c of children.get(p.pid) || []) stack.push(c);
  }
  return out;
}

function usage(snap, rootPid) {
  const procs = tree(snap, rootPid);
  let cpu = 0, rssKb = 0;
  for (const p of procs) { cpu += p.cpu; rssKb += p.rssKb; }
  const java = procs.find(p => /(^|\/)java(\s|$)/.test(p.command.split(' ')[0]) || /\bjava\b/.test(p.command.split(' ')[0]));
  return { cpu, memMb: Math.round(rssKb / 1024), javaPid: java ? java.pid : rootPid, uptime: snap.get(rootPid)?.etime || 0 };
}

async function cwdOf(pids) {
  const out = new Map();
  if (!pids.length) return out;
  const r = await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')], { timeout: 5000 });
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('p')) cur = +line.slice(1);
    else if (line.startsWith('n') && cur) out.set(cur, line.slice(1));
  }
  return out;
}

// Map of TCP listen port -> pid.
async function listeners() {
  const r = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeout: 5000 });
  const out = new Map();
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('p')) cur = +line.slice(1);
    else if (line.startsWith('n') && cur) {
      const m = line.match(/:(\d+)$/);
      if (m && !out.has(+m[1])) out.set(+m[1], cur);
    }
  }
  return out;
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function signal(pid, sig, group) {
  try { process.kill(group ? -pid : pid, sig); return true; } catch {
    if (group) { try { process.kill(pid, sig); return true; } catch { return false; } }
    return false;
  }
}

module.exports = { snapshot, tree, usage, cwdOf, listeners, alive, signal };
