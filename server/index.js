// SquidPanel — self-hosted Minecraft server panel.
// Express REST API + a single authenticated WebSocket for live updates; serves the built UI.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const store = require('./store');
store.load();
const rbac = require('./rbac');
const auth = require('./auth');
const manager = require('./manager');
const backups = require('./backups');
const servers = require('./routes/servers');
const system = require('./routes/system');

const PORT = parseInt(process.env.PORT, 10) || 3333;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const api = express.Router();
api.use(auth.authenticate);
api.use(auth.csrf);
api.use(require('./routes/account'));
api.use(require('./routes/users'));
api.use(servers.router);
api.use(require('./routes/content'));
api.use(system.router);
api.use((req, res) => res.status(404).json({ error: 'Not found' }));
api.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('[api]', req.method, req.path, err);
  res.status(status).json({ error: err.message || 'Something went wrong', ...(err.extra || {}) });
});
app.use('/api', api);

// ---------- static UI ----------
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
app.get('/{*splat}', (req, res) => {
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) return res.status(503).send('UI not built yet. Run: npm run build');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(index);
});

// ---------- WebSocket: live status, stats, console ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const found = auth.sessionFromRequest(req);
  if (!found) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.userId = found.user.id;
    ws.sessionId = found.session.id;
    ws.subs = new Set();
    ws.isAlive = true;
    clients.add(ws);
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => clients.delete(ws));
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const user = currentUser(ws);
      if (!user) return ws.close(4401);
      if (msg.t === 'sub' && typeof msg.id === 'string') {
        if (rbac.access(user, msg.id).console < 1) return send(ws, { t: 'error', id: msg.id, error: 'No console access' });
        ws.subs.add(msg.id);
        send(ws, { t: 'console-init', id: msg.id, lines: manager.logs(msg.id, 600), channel: manager.consoleChannel(msg.id) });
      } else if (msg.t === 'unsub') {
        ws.subs.delete(msg.id);
      }
    });
    sendSummaries(ws);
  });
});

function currentUser(ws) {
  const d = store.get();
  const s = d.sessions.find(x => x.id === ws.sessionId && x.expiresAt > Date.now());
  const u = s && d.users.find(x => x.id === ws.userId);
  return u && !u.disabled ? u : null;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function sendSummaries(ws) {
  const user = currentUser(ws);
  if (!user) return ws.close(4401);
  const list = store.get().servers.filter(s => rbac.access(user, s.id).view).map(s => ({ ...manager.summary(s.id), job: backups.jobs(s.id) }));
  send(ws, { t: 'servers', servers: list, host: rbac.isAdmin(user) ? system.host() : null });
}

setInterval(() => { for (const ws of clients) sendSummaries(ws); }, 2000);
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

function pushServer(id) {
  let summary;
  try { summary = { ...manager.summary(id), job: backups.jobs(id) }; } catch { return; }
  for (const ws of clients) {
    const user = currentUser(ws);
    if (user && rbac.access(user, id).view) send(ws, { t: 'server', server: summary });
  }
}

manager.events.on('status', pushServer);
manager.events.on('players', pushServer);
backups.events.on('job', job => pushServer(job.serverId));
manager.events.on('log', (id, lines) => {
  for (const ws of clients) {
    if (!ws.subs.has(id)) continue;
    const user = currentUser(ws);
    if (!user || rbac.access(user, id).console < 1) { ws.subs.delete(id); continue; }
    send(ws, { t: 'console', id, lines });
  }
});
manager.events.on('access', () => { for (const ws of clients) sendSummaries(ws); });
store.events.on('activity', entry => {
  for (const ws of clients) {
    const user = currentUser(ws);
    if (!user) continue;
    if (rbac.isAdmin(user) || (entry.serverId && rbac.access(user, entry.serverId).view)) send(ws, { t: 'activity', entry });
  }
});

// ---------- boot ----------
const imported = servers.autoImport();
if (imported.length) console.log(`[boot] imported ${imported.length} server(s): ${imported.map(s => s.name).join(', ')}`);
manager.boot();
backups.schedule();

server.listen(PORT, HOST, () => {
  console.log(`SquidPanel listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (!store.get().users.length) console.log('No accounts yet — open http://localhost:' + PORT + ' on this Mac to create the owner account.');
});

function shutdown() {
  // Minecraft servers keep running; the panel reattaches to them on next start.
  try { store.saveNow(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));
