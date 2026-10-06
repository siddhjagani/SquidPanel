// server.properties read/write that keeps comments, ordering and unknown keys intact.
const fs = require('fs');
const path = require('path');

function unescape(v) {
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', f: '\f' }[c] ?? c));
}

function escape(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[=:#!]/g, c => '\\' + c)
    .replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function file(dir) { return path.join(dir, 'server.properties'); }

function read(dir) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(file(dir), 'latin1'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('!')) continue;
    const m = s.match(/^((?:\\.|[^=:\s])+)\s*[=:]?\s*(.*)$/);
    if (m) out[unescape(m[1])] = unescape(m[2]);
  }
  return out;
}

function write(dir, updates) {
  let lines = [];
  try { lines = fs.readFileSync(file(dir), 'latin1').split(/\r?\n/); } catch {}
  const pending = new Map(Object.entries(updates).map(([k, v]) => [k, v]));
  const out = lines.map(line => {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('!')) return line;
    const m = s.match(/^((?:\\.|[^=:\s])+)/);
    if (!m) return line;
    const key = unescape(m[1]);
    if (!pending.has(key)) return line;
    const v = pending.get(key);
    pending.delete(key);
    return `${key}=${escape(v)}`;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of pending) out.push(`${k}=${escape(v)}`);
  fs.writeFileSync(file(dir), out.join('\n') + '\n', 'latin1');
}

module.exports = { read, write };
