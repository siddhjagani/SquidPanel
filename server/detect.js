// Inspect a Minecraft server folder: software, version, launch method, port, icon.
const fs = require('fs');
const path = require('path');
const properties = require('./properties');

const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ls = p => { try { return fs.readdirSync(p); } catch { return []; } };

function cmpVersion(a, b) {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function versionFromLogs(dir) {
  const log = path.join(dir, 'logs', 'latest.log');
  try {
    const fd = fs.openSync(log, 'r');
    const buf = Buffer.alloc(200000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.slice(0, n).toString('utf8');
    const m = text.match(/Starting minecraft server version (\S+)/i) || text.match(/Loading Minecraft (\S+)/) || text.match(/minecraft['": ]+(1\.\d+(?:\.\d+)?|\d\d\.\d+(?:\.\d+)?)/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

function findJar(dir) {
  const jars = ls(dir).filter(f => f.endsWith('.jar') && !/installer|setup|shim/i.test(f));
  const prefer = ['server.jar', 'paper.jar', 'purpur.jar', 'fabric-server-launch.jar', 'minecraft_server.jar'];
  return prefer.find(j => jars.includes(j)) || jars[0] || '';
}

function inspect(dir) {
  const info = { dir, valid: false, software: 'Unknown', mcVersion: '', launch: 'jar', jar: '', script: '', port: 25565, maxPlayers: 20, motd: '', hasIcon: false, addonsDir: null, eula: false };
  if (!isDir(dir)) return info;
  const props = properties.read(dir);
  info.port = parseInt(props['server-port'], 10) || 25565;
  info.maxPlayers = parseInt(props['max-players'], 10) || 20;
  info.motd = props.motd || '';
  info.hasIcon = exists(path.join(dir, 'server-icon.png'));
  try { info.eula = /eula\s*=\s*true/i.test(fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8')); } catch {}

  const runSh = ['run.sh', 'start.sh'].find(f => exists(path.join(dir, f)));
  const neo = path.join(dir, 'libraries/net/neoforged/neoforge');
  const forge = path.join(dir, 'libraries/net/minecraftforge/forge');
  if (isDir(neo)) {
    info.software = 'NeoForge';
    const v = ls(neo).filter(x => /^\d/.test(x)).sort(cmpVersion).pop();
    if (v) {
      const [a, b] = v.split('.').map(Number);
      info.mcVersion = a >= 26 ? `${a}.${b}` : (b ? `1.${a}.${b}` : `1.${a}`);
      info.loaderVersion = v;
    }
  } else if (isDir(forge)) {
    info.software = 'Forge';
    const v = ls(forge).sort(cmpVersion).pop();
    if (v) { info.mcVersion = v.split('-')[0]; info.loaderVersion = v.split('-')[1]; }
  } else if (exists(path.join(dir, '.fabric')) || exists(path.join(dir, 'fabric-server-launch.jar'))) {
    info.software = 'Fabric';
  } else if (isDir(path.join(dir, '.paper')) || exists(path.join(dir, 'paper.yml')) || isDir(path.join(dir, 'config')) && exists(path.join(dir, 'config', 'paper-global.yml'))) {
    info.software = exists(path.join(dir, 'purpur.yml')) ? 'Purpur' : 'Paper';
  } else if (exists(path.join(dir, 'bukkit.yml'))) {
    info.software = exists(path.join(dir, 'spigot.yml')) ? 'Spigot' : 'Bukkit';
  } else if (findJar(dir)) {
    info.software = 'Vanilla';
  }
  if (!info.mcVersion) {
    const versions = ls(path.join(dir, 'versions')).filter(v => /^\d/.test(v) && isDir(path.join(dir, 'versions', v)));
    if (versions.length) info.mcVersion = versions.sort(cmpVersion).pop();
  }
  if (!info.mcVersion) info.mcVersion = versionFromLogs(dir);

  info.jar = findJar(dir);
  if (runSh && (info.software === 'NeoForge' || info.software === 'Forge' || !info.jar)) {
    info.launch = 'script';
    info.script = runSh;
  }
  if (isDir(path.join(dir, 'mods'))) info.addonsDir = 'mods';
  else if (isDir(path.join(dir, 'plugins'))) info.addonsDir = 'plugins';
  else if (['NeoForge', 'Forge', 'Fabric'].includes(info.software)) info.addonsDir = 'mods';
  else if (['Paper', 'Purpur', 'Spigot', 'Bukkit'].includes(info.software)) info.addonsDir = 'plugins';

  info.valid = !!(info.jar || info.script) && (exists(path.join(dir, 'server.properties')) || exists(path.join(dir, 'eula.txt')));
  return info;
}

// Look one level deep in each scan directory for server folders.
function scan(dirs) {
  const out = [];
  for (const base of dirs) {
    for (const name of ls(base)) {
      const dir = path.join(base, name);
      if (name.startsWith('.') || !isDir(dir)) continue;
      const info = inspect(dir);
      if (info.valid) out.push({ ...info, name: name.replace(/_\d+$/, '') });
    }
  }
  return out;
}

module.exports = { inspect, scan, cmpVersion };
