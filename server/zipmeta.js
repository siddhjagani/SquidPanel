// Read a few small entries out of a jar without loading the whole file, and
// turn them into display metadata for the mods/plugins list.
const fs = require('fs');
const zlib = require('zlib');

function readEntries(file, wanted) {
  const out = {};
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return out;
    const cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdSize > 32 * 1024 * 1024) return out;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const method = cd.readUInt16LE(p + 10), comp = cd.readUInt32LE(p + 20);
      const nLen = cd.readUInt16LE(p + 28), eLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nLen).toString('utf8');
      p += 46 + nLen + eLen + cLen;
      if (!wanted.includes(name) || comp > 4 * 1024 * 1024) continue;
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, local);
      const start = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = Buffer.alloc(comp);
      fs.readSync(fd, data, 0, comp, start);
      try { out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); } catch {}
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

const WANTED = ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'fabric.mod.json', 'quilt.mod.json', 'plugin.yml', 'paper-plugin.yml', 'META-INF/MANIFEST.MF'];
const cache = new Map();

function tomlField(block, key) {
  const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'''([\\s\\S]*?)'''|'([^']*)')`, 'm'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}
function yamlField(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]*)['"]?\\s*$`, 'm'));
  return m ? m[1].trim() : '';
}

function meta(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let info = { name: '', version: '', description: '', id: '', side: '', loader: '' };
  try {
    const e = readEntries(file, WANTED);
    const manifestVersion = ((e['META-INF/MANIFEST.MF'] || '').match(/Implementation-Version:\s*(\S+)/) || [])[1] || '';
    const toml = e['META-INF/neoforge.mods.toml'] || e['META-INF/mods.toml'];
    if (toml) {
      const block = toml.split(/\[\[mods\]\]/)[1] || toml;
      let version = tomlField(block, 'version');
      if (version.includes('${')) version = manifestVersion || '';
      info = { ...info, id: tomlField(block, 'modId'), name: tomlField(block, 'displayName'), version, description: tomlField(block, 'description').split('\n')[0], loader: e['META-INF/neoforge.mods.toml'] ? 'neoforge' : 'forge' };
    } else if (e['fabric.mod.json'] || e['quilt.mod.json']) {
      const j = JSON.parse(e['fabric.mod.json'] || e['quilt.mod.json']);
      const q = j.quilt_loader?.metadata || {};
      info = { ...info, id: j.id || j.quilt_loader?.id || '', name: j.name || q.name || '', version: j.version || j.quilt_loader?.version || '', description: (j.description || q.description || '').split('\n')[0], side: j.environment === 'client' ? 'client' : '', loader: 'fabric' };
    } else if (e['paper-plugin.yml'] || e['plugin.yml']) {
      const y = e['paper-plugin.yml'] || e['plugin.yml'];
      info = { ...info, name: yamlField(y, 'name'), version: yamlField(y, 'version'), description: yamlField(y, 'description'), loader: 'bukkit' };
    }
    if (!info.version) info.version = manifestVersion;
  } catch {}
  for (const k of [...cache.keys()]) if (k.startsWith(file + ':')) cache.delete(k);
  cache.set(key, info);
  return info;
}

module.exports = { meta, readEntries };
