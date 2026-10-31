'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { Room } = require('./lib/room');

const PORT = Number(process.env.PORT) || 3666;
const PUBLIC = path.join(__dirname, 'public');
const SAVE_DIR = path.join(__dirname, 'saves');
const QUESTIONS = path.join(__dirname, 'data', 'questions.json');
const SAVE_MAX_AGE = 24 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

// Fragen werden bei jedem neuen Raum frisch gelesen: questions.json lässt sich ohne Neustart anpassen.
function loadQuestions() {
  const data = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'));
  if (!data || !Array.isArray(data.pages) || !data.pages.length) throw new Error('"pages" fehlt');
  data.pages.forEach((p, pi) => {
    if (!Array.isArray(p.categories)) throw new Error(`Seite ${pi + 1}: "categories" fehlt`);
    p.categories.forEach((c, ci) => {
      if (!Array.isArray(c.questions)) throw new Error(`Seite ${pi + 1}, Kategorie ${ci + 1}: "questions" fehlt`);
    });
  });
  return data;
}

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (p === '/' || p === '/host' || p === '/join') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': /^\.(ogg|opus|mp3|m4a|wav|png|jpg|webp|glb|woff2)$/.test(ext) ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
});

const io = new Server(server, {
  cors: { origin: true },
  maxHttpBufferSize: 1e6,
  pingInterval: 10000,
  pingTimeout: 20000,
});

const rooms = new Map();

// start.bat lässt cloudflared nach tunnel.log schreiben – daraus lesen wir den Online-Link,
// damit die Lobby ihn als Einladungslink anzeigen kann.
const TUNNEL_LOG = path.join(__dirname, 'tunnel.log');
const TUNNEL_MAX_AGE = 12 * 60 * 60 * 1000;
let publicUrl = null;

function checkTunnel() {
  fs.stat(TUNNEL_LOG, (err, st) => {
    if (err || Date.now() - st.mtimeMs > TUNNEL_MAX_AGE) return;
    fs.readFile(TUNNEL_LOG, 'utf8', (e, txt) => {
      if (e) return;
      const found = txt.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/g);
      const url = found ? found[found.length - 1] : null;
      if (!url || url === publicUrl) return;
      publicUrl = url;
      console.log(`  🌍 Online-Link für deine Freunde: ${url}`);
      for (const room of rooms.values()) {
        room.markDirty();
        printHostLink(room);
      }
    });
  });
}

// Mit dem Spielleiter-Link kommt der Host auch aus einem anderen Browser oder von einem anderen PC zurück.
function printHostLink(room) {
  const q = `/?host=${room.code}&key=${room.hostToken}`;
  console.log(`  🔑 Spielleiter-Link für Raum ${room.code} (nicht weitergeben): http://localhost:${PORT}${q}`);
  if (publicUrl) console.log(`     von einem anderen PC aus: ${publicUrl}${q}`);
}

setInterval(checkTunnel, 2000);
checkTunnel();

function restoreRooms() {
  let questions;
  try {
    questions = loadQuestions();
  } catch (e) {
    console.error('questions.json kann nicht gelesen werden:', e.message);
    return;
  }
  if (!fs.existsSync(SAVE_DIR)) return;
  for (const f of fs.readdirSync(SAVE_DIR)) {
    if (!/^room-[A-Z]{4}\.json$/.test(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, f), 'utf8'));
      if (Date.now() - (data.savedAt || 0) > SAVE_MAX_AGE) continue;
      const room = Room.restore(data, { io, questions, saveDir: SAVE_DIR, getPublicUrl: () => publicUrl });
      rooms.set(room.code, room);
      console.log(`Raum ${room.code} wiederhergestellt (${room.players.size} Spieler, Phase ${room.phase})`);
      printHostLink(room);
    } catch (e) {
      console.error(`Spielstand ${f} defekt:`, e.message);
    }
  }
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const reply = cb => (typeof cb === 'function' ? cb : () => {});

io.on('connection', socket => {
  socket.on('host:create', (_d, cb) => {
    let questions;
    try {
      questions = loadQuestions();
    } catch (e) {
      reply(cb)({ error: `questions.json ist fehlerhaft: ${e.message}` });
      return;
    }
    const room = new Room({ code: newCode(), io, questions, saveDir: SAVE_DIR, getPublicUrl: () => publicUrl });
    rooms.set(room.code, room);
    room.attachHost(socket);
    reply(cb)({ code: room.code, token: room.hostToken });
    room.markDirty();
    console.log(`Neuer Raum ${room.code}`);
    printHostLink(room);
  });

  // Startseite: Gibt es das Spiel, das dieser Browser leitet, noch? Dann bietet sie den Weg zurück an.
  socket.on('host:check', (d, cb) => {
    const room = rooms.get(String((d && d.code) || '').toUpperCase());
    if (!room || room.hostToken !== (d && d.token)) {
      reply(cb)({ error: 'Raum nicht gefunden.' });
      return;
    }
    reply(cb)({ code: room.code, players: room.players.size });
  });

  socket.on('host:resume', (d, cb) => {
    const room = rooms.get(String((d && d.code) || '').toUpperCase());
    if (!room || room.hostToken !== (d && d.token)) {
      reply(cb)({ error: 'Raum nicht gefunden.' });
      return;
    }
    room.attachHost(socket);
    reply(cb)({ code: room.code, token: room.hostToken });
    room.markDirty();
  });

  socket.on('player:join', (d, cb) => {
    const room = rooms.get(String((d && d.code) || '').trim().toUpperCase());
    if (!room) {
      reply(cb)({ error: 'Diesen Raum gibt es nicht. Code prüfen!' });
      return;
    }
    reply(cb)(room.join(socket, d || {}));
  });

  socket.on('host', (d, cb) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'host') return;
    let r;
    try {
      r = room.hostAction(socket, d || {});
    } catch (e) {
      console.error('[host]', e);
      r = { error: 'Serverfehler' };
    }
    reply(cb)(r || {});
  });

  socket.on('p', (d, cb) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player') return;
    let r;
    try {
      r = room.playerAction(socket, d || {});
    } catch (e) {
      console.error('[player]', e);
      r = { error: 'Serverfehler' };
    }
    reply(cb)(r || {});
  });

  socket.on('draw:stroke', d => socket.data.room && socket.data.room.onStroke(socket, d));
  socket.on('br:pos', d => socket.data.room && socket.data.room.onBrPos(socket, d));
  socket.on('br:ready', () => socket.data.room && socket.data.room.onBrReady(socket));
  socket.on('disconnect', () => socket.data.room && socket.data.room.detach(socket));
});

restoreRooms();

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ⚠️  Port ${PORT} ist schon belegt – läuft das Spiel bereits in einem anderen Fenster?\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `http://${i.address}:${PORT}`);
  console.log('');
  console.log('  🎃  GEISTERSTUNDE läuft');
  console.log(`  Lokal:     http://localhost:${PORT}`);
  for (const u of lan) console.log(`  Im WLAN:   ${u}`);
  console.log('  Online:    Der Link erscheint hier, sobald der Tunnel steht.');
  console.log('');
});
