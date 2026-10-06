// Small shared helpers used across the backend.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/_\d+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'server';
}

// Promise wrapper around execFile that never throws on a non-zero exit;
// callers inspect `code` themselves.
function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 0, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

// Resolve `rel` inside `root`, refusing anything that escapes it (including via symlinks).
function safeResolve(root, rel = '') {
  const base = fs.realpathSync(root);
  const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(base, cleaned);
  if (target !== base && !target.startsWith(base + path.sep)) throw httpError(400, 'Path escapes the server folder');
  // If it exists, verify its real path too (symlink escape).
  try {
    const real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(base + path.sep)) throw httpError(400, 'Path escapes the server folder');
  } catch (e) {
    if (e.status) throw e;
  }
  return target;
}

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/§[0-9a-fk-or]/gi, '');
}

function parseSize(s, fallbackMb) {
  const m = String(s || '').trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i);
  if (!m) return fallbackMb;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return Math.round(unit === 'g' ? n * 1024 : unit === 't' ? n * 1024 * 1024 : unit === 'k' ? n / 1024 : n);
}

module.exports = { sleep, id, slugify, run, safeResolve, httpError, readJson, stripAnsi, parseSize };
