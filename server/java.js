// Java runtime discovery and per-Minecraft-version selection.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./util');

let cache = null;
let cacheAt = 0;

function candidates() {
  const home = os.homedir();
  const list = new Set();
  const globs = [
    path.join(home, 'Library/Application Support/squidservers/java'),
    '/Library/Java/JavaVirtualMachines',
    path.join(home, 'Library/Java/JavaVirtualMachines'),
  ];
  for (const base of globs) {
    try {
      for (const d of fs.readdirSync(base)) {
        for (const sub of ['Contents/Home/bin/java', 'bin/java']) {
          const p = path.join(base, d, sub);
          if (fs.existsSync(p)) { list.add(p); break; }
        }
      }
    } catch {}
  }
  try {
    for (const d of fs.readdirSync('/opt/homebrew/opt')) {
      if (d.startsWith('openjdk')) {
        const p = path.join('/opt/homebrew/opt', d, 'bin/java');
        if (fs.existsSync(p)) list.add(p);
      }
    }
  } catch {}
  for (const p of ['/usr/bin/java', '/opt/homebrew/bin/java', '/usr/local/bin/java']) if (fs.existsSync(p)) list.add(p);
  return [...list];
}

async function probe(bin) {
  const r = await run(bin, ['-version'], { timeout: 8000 });
  const text = r.stderr + r.stdout;
  const m = text.match(/version "([^"]+)"/);
  if (!m) return null;
  const v = m[1];
  const major = v.startsWith('1.') ? parseInt(v.split('.')[1], 10) : parseInt(v, 10);
  const vendor = (text.split('\n')[1] || '').replace(/\(build.*$/, '').trim();
  return { path: bin, version: v, major, vendor, bundled: bin.includes('squidservers') };
}

async function runtimes(force = false) {
  if (cache && !force && Date.now() - cacheAt < 10 * 60 * 1000) return cache;
  const found = (await Promise.all(candidates().map(probe))).filter(Boolean);
  // De-duplicate identical versions that are just symlinks to the same JDK.
  const seen = new Map();
  for (const r of found) {
    let real = r.path;
    try { real = fs.realpathSync(r.path); } catch {}
    if (!seen.has(real)) seen.set(real, r);
  }
  // /usr/bin/java is only a launcher stub for one of the JDKs already listed.
  const list = [...seen.values()];
  cache = list.filter(r => r.path !== '/usr/bin/java' || !list.some(o => o !== r && o.version === r.version))
    .sort((a, b) => b.major - a.major);
  cacheAt = Date.now();
  return cache;
}

// Minimum Java major version for a Minecraft version string.
function requiredJava(mc) {
  const s = String(mc || '').trim();
  const parts = s.split('.').map(n => parseInt(n, 10));
  if (!parts.length || isNaN(parts[0])) return 21;
  if (parts[0] >= 26) return 25; // year-based versions (26.1+) need Java 25
  if (parts[0] !== 1) return 21;
  const minor = parts[1] || 0, patch = parts[2] || 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

async function pick(mcVersion) {
  const need = requiredJava(mcVersion);
  const list = await runtimes();
  // Prefer system-installed JDKs over the SquidServers app's bundled copies (no dependency on the app).
  const ok = list.filter(r => r.major >= need).sort((a, b) => a.major - b.major || Number(a.bundled) - Number(b.bundled));
  return { need, runtime: ok[0] || null };
}

module.exports = { runtimes, requiredJava, pick };
