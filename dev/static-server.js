// Minimaler statischer Server nur zum Testen der Assets (Sounds, Puzzle-Szenen).
// Start: node dev/static-server.js  →  http://localhost:3668/dev/assets-test.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3668;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end('Bad request');
    }
    if (p === '/') p = '/dev/assets-test.html';
    const file = path.resolve(ROOT, '.' + p);
    // Kein Ausbruch aus dem Projektordner, keine versteckten Dateien/Ordner
    if (!file.startsWith(ROOT + path.sep) || /[\\/]\./.test(file.slice(ROOT.length))) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(PORT, () => console.log('assets-test läuft auf http://localhost:' + PORT + '/dev/assets-test.html'));
