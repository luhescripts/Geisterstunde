'use strict';

// Test-Harness fürs Backrooms-Minispiel (nur Entwicklung).
// Start: node dev/br-harness.js  ->  http://localhost:3667  (Zuschauer: ?spectator=1)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { BackroomsGame } = require('../lib/backrooms');

const PUB = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3667;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};
const COLORS = ['#7cfc5a', '#ff8c1a'];

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    return send(res, 400, 'bad request', 'text/plain');
  }
  if (url === '/' || url === '/br-test.html') {
    let html = fs.readFileSync(path.join(__dirname, 'br-test.html'), 'utf8');
    const hasSound = fs.existsSync(path.join(PUB, 'js', 'sound.js'));
    html = html.replace('<!--SOUND-->', hasSound ? '<script src="/js/sound.js"></script>' : '');
    return send(res, 200, html, MIME['.html']);
  }
  const file = path.normalize(path.join(PUB, url));
  if (!file.startsWith(PUB)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

const io = new Server(server);
const clients = new Map();
let game = null;
let seq = 0;
let lastResults = null;

function lobby() {
  io.emit('harness:lobby', {
    players: [...clients.values()].filter((c) => !c.spectator && c.id).map((c) => ({ id: c.id, name: c.name, teamId: c.teamId })),
    running: !!game,
    results: lastResults,
  });
}

io.on('connection', (socket) => {
  const info = { id: null, name: null, spectator: true, teamId: null, color: null };
  clients.set(socket.id, info);

  socket.on('hello', (d = {}) => {
    info.spectator = !!d.spectator;
    if (!info.spectator) {
      const taken = (id) => [...clients.values()].some((c) => c !== info && c.id === id);
      info.id = typeof d.id === 'string' && d.id && !taken(d.id) ? d.id : 'p' + ++seq + Math.random().toString(36).slice(2, 6);
      info.name = String(d.name || 'Tester').slice(0, 20);
      const idx = [...clients.values()].filter((c) => !c.spectator && c.id && c !== info).length;
      info.teamId = 't' + ((idx % 2) + 1);
      info.color = COLORS[idx % 2];
      socket.join('p:' + info.id);
      if (game) game.addPlayer({ id: info.id, name: info.name, teamId: info.teamId, color: info.color });
    }
    socket.emit('harness:you', { id: info.id, name: info.name, teamId: info.teamId, spectator: info.spectator });
    if (game) socket.emit('harness:phase', { phase: 'backrooms' });
    lobby();
  });

  socket.on('harness:start', (opts = {}) => {
    if (game) game.stop();
    lastResults = null;
    const players = [...clients.values()]
      .filter((c) => !c.spectator && c.id)
      .map((c) => ({ id: c.id, name: c.name, teamId: c.teamId, color: c.color }));
    const g = new BackroomsGame({
      players,
      durationSec: Number(opts.duration) || 150,
      countdownSec: opts.countdown != null && opts.countdown !== '' ? Number(opts.countdown) : 5,
      emit: (ev, data) => io.emit(ev, data),
      emitTo: (pid, ev, data) => io.to('p:' + pid).emit(ev, data),
      onEnd: (results) => {
        console.log('[harness] results', JSON.stringify(results));
        lastResults = results;
        setTimeout(() => {
          if (game !== g) return;
          game = null;
          io.emit('harness:phase', { phase: 'results', results });
          lobby();
        }, 2500);
      },
    });
    game = g;
    g.start();
    io.emit('harness:phase', { phase: 'backrooms' });
    lobby();
  });

  socket.on('harness:end', () => game && game.forceEnd());

  // Debug: Spieler neben das erste Monster setzen (dist = Abstand in Feldern, Standard 0.55)
  socket.on('harness:teleport', (opts = {}) => {
    if (!game || !info.id) return;
    const p = game.players.get(info.id);
    const m = game.monsters[0];
    if (!p || !m) return;
    const want = Number(opts.dist) || 0.55;
    let spot = null;
    for (const dist of [want, want * 0.75, want * 0.5, 0.55]) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = { x: m.x + dx * dist, y: m.y + dy * dist };
        if (!game._blocked(s.x, s.y, 0.22) && game._segmentClear(m.x, m.y, s.x, s.y)) {
          spot = s;
          break;
        }
      }
      if (spot) break;
    }
    spot = spot || { x: m.x, y: m.y };
    p.x = spot.x;
    p.y = spot.y;
    p.a = Math.atan2(m.y - spot.y, m.x - spot.x);
    p.invulnUntil = 0;
    p.lastMoveAt = Date.now();
    io.to('p:' + info.id).emit('br:correct', { x: p.x, y: p.y, a: p.a });
  });

  // Debug: vor den nächsten Zettel stellen (Blick darauf)
  socket.on('harness:tonote', () => {
    if (!game || !info.id) return;
    const p = game.players.get(info.id);
    if (!p) return;
    let best = null;
    for (const n of game.notes.values()) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = { x: n.x + dx * 1.6, y: n.y + dy * 1.6 };
        if (game._blocked(s.x, s.y, 0.22) || !game._segmentClear(n.x, n.y, s.x, s.y)) continue;
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (!best || d < best.d) best = { d, s, n };
      }
    }
    if (!best) return;
    p.x = best.s.x;
    p.y = best.s.y;
    p.a = Math.atan2(best.n.y - best.s.y, best.n.x - best.s.x);
    p.lastMoveAt = Date.now();
    io.to('p:' + info.id).emit('br:correct', { x: p.x, y: p.y, a: p.a });
  });

  // Debug: einen Zettel gutschreiben (um den Zettelverlust zu testen)
  socket.on('harness:give', () => {
    if (!game || !info.id) return;
    const p = game.players.get(info.id);
    if (p) p.notes++;
  });

  socket.on('br:ready', () => {
    if (game) socket.emit('br:init', game.getInitFor(info.spectator ? null : info.id));
  });
  socket.on('br:pos', (d) => {
    if (game && info.id) game.input(info.id, d);
  });
  socket.on('disconnect', () => {
    clients.delete(socket.id);
    lobby();
  });
});

server.listen(PORT, () => console.log(`[harness] http://localhost:${PORT}`));
