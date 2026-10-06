// Minimal Source RCON client (used only for servers the panel did not launch).
const net = require('net');

function rcon({ host = '127.0.0.1', port, password }, command, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let authed = false;
    let out = '';
    const timer = setTimeout(() => { sock.destroy(); authed ? resolve(out) : reject(new Error('RCON timed out')); }, timeoutMs);
    const send = (id, type, body) => {
      const payload = Buffer.from(body, 'utf8');
      const pkt = Buffer.alloc(14 + payload.length);
      pkt.writeInt32LE(10 + payload.length, 0);
      pkt.writeInt32LE(id, 4);
      pkt.writeInt32LE(type, 8);
      payload.copy(pkt, 12);
      sock.write(pkt);
    };
    sock.on('connect', () => send(1, 3, password));
    sock.on('error', e => { clearTimeout(timer); reject(e); });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < len + 4) break;
        const id = buf.readInt32LE(4);
        const body = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (!authed) {
          if (id === -1) { clearTimeout(timer); sock.destroy(); return reject(new Error('RCON password rejected')); }
          authed = true;
          send(2, 2, command);
          // Terminator packet so we know when a multi-packet response has finished.
          send(3, 0, '');
        } else if (id === 2) {
          out += body;
        } else if (id === 3) {
          clearTimeout(timer); sock.end(); resolve(out);
        }
      }
    });
  });
}

module.exports = { rcon };
