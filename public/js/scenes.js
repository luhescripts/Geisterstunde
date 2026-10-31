/* Geisterstunde – prozedurale Gruselbilder für die Puzzle-Kategorie „Zerstückelt“.
 *
 *   Scenes.names                    → ['halloween', 'es', 'freitag', 'ring', 'saw']
 *   Scenes.draw(name, canvas)       → zeichnet deterministisch auf ein (quadratisches) Canvas, true/false
 *   Scenes.dataURL(name, size, type)→ Data-URL (gecacht), praktisch als background-image für Puzzleteile
 *
 * Alles wird in einem 600×600-Koordinatensystem gezeichnet und auf die Canvas-Größe skaliert.
 */
(function () {
  'use strict';

  var S = 600;
  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- Hilfen
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function R(rnd, a, b) { return a + (b - a) * rnd(); }
  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    var c = hexToRgb(hex), f = 1 + amt;
    return 'rgb(' + c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); }).join(',') + ')';
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  // Punktwolke mit wechselnder Deckkraft (Körnung, Schmutz, Sterne)
  function dots(ctx, rnd, x, y, w, h, n, color, rMin, rMax, aMin, aMax) {
    ctx.fillStyle = color;
    for (var i = 0; i < n; i++) {
      ctx.globalAlpha = R(rnd, aMin, aMax);
      circle(ctx, x + rnd() * w, y + rnd() * h, R(rnd, rMin, rMax));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function stars(ctx, rnd, n, w, h) {
    for (var i = 0; i < n; i++) {
      var x = rnd() * w, y = rnd() * rnd() * h;
      var big = rnd() < 0.08;
      var r = big ? R(rnd, 1.2, 1.9) : R(rnd, 0.4, 1.05);
      ctx.fillStyle = 'rgba(255,250,235,' + R(rnd, 0.35, 0.95).toFixed(2) + ')';
      circle(ctx, x, y, r);
      ctx.fill();
      if (big) {
        ctx.strokeStyle = 'rgba(255,250,235,0.35)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x - r * 3, y);
        ctx.lineTo(x + r * 3, y);
        ctx.moveTo(x, y - r * 3);
        ctx.lineTo(x, y + r * 3);
        ctx.stroke();
      }
    }
  }

  function moon(ctx, rnd, x, y, r, color) {
    var glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 3.4);
    glow.addColorStop(0, 'rgba(255,245,210,0.32)');
    glow.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = glow;
    circle(ctx, x, y, r * 3.4);
    ctx.fill();
    var body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    body.addColorStop(0, '#fffbea');
    body.addColorStop(1, color);
    ctx.fillStyle = body;
    circle(ctx, x, y, r);
    ctx.fill();
    for (var i = 0; i < 11; i++) {
      var a = rnd() * TAU, d = rnd() * r * 0.72, cr = R(rnd, r * 0.05, r * 0.17);
      ctx.fillStyle = 'rgba(150,140,115,' + R(rnd, 0.15, 0.35).toFixed(2) + ')';
      circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, cr);
      ctx.fill();
    }
  }

  function cloud(ctx, rnd, x, y, w, color) {
    ctx.fillStyle = color;
    for (var i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(x + R(rnd, -w / 2, w / 2), y + R(rnd, -w * 0.08, w * 0.08), R(rnd, w * 0.18, w * 0.35), R(rnd, w * 0.05, w * 0.11), 0, 0, TAU);
      ctx.fill();
    }
  }

  function bat(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 20, s / 20);
    ctx.fillStyle = color || '#07050a';
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.quadraticCurveTo(6, -10, 20, -8);
    ctx.quadraticCurveTo(16, -4, 17, 1);
    ctx.quadraticCurveTo(13, -1, 11, 3);
    ctx.quadraticCurveTo(8, 0, 4, 4);
    ctx.lineTo(0, 6);
    ctx.lineTo(-4, 4);
    ctx.quadraticCurveTo(-8, 0, -11, 3);
    ctx.quadraticCurveTo(-13, -1, -17, 1);
    ctx.quadraticCurveTo(-16, -4, -20, -8);
    ctx.quadraticCurveTo(-6, -10, 0, -3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.6, -1);
    ctx.lineTo(-2.2, -6);
    ctx.lineTo(-0.6, -3);
    ctx.lineTo(0.6, -3);
    ctx.lineTo(2.2, -6);
    ctx.lineTo(2.6, -1);
    ctx.arc(0, 0, 2.6, 0, Math.PI);
    ctx.fill();
    ctx.restore();
  }

  function branch(ctx, rnd, x, y, len, ang, depth, width) {
    var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x2) / 2 + R(rnd, -len, len) * 0.12, (y + y2) / 2 + R(rnd, -len, len) * 0.12, x2, y2);
    ctx.stroke();
    if (depth <= 0 || len < 4) return;
    var n = rnd() < 0.3 ? 3 : 2;
    for (var i = 0; i < n; i++) branch(ctx, rnd, x2, y2, len * R(rnd, 0.62, 0.8), ang + R(rnd, -0.65, 0.65), depth - 1, Math.max(0.6, width * 0.68));
  }

  var LEAVES = ['#c2410c', '#ea580c', '#b45309', '#a16207', '#7c2d12', '#d97706', '#9a3412', '#854d0e'];
  function leaf(ctx, x, y, s, a, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s / 10, s / 10);
    ctx.fillStyle = color;
    poly(ctx, [0, -10, 2.5, -5, 7, -7, 5.5, -2, 10, 0, 5, 2.5, 6, 7, 1, 4.5, 0, 9, -1, 4.5, -6, 7, -5, 2.5, -10, 0, -5.5, -2, -7, -7, -2.5, -5]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,15,5,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, -6);
    ctx.moveTo(0, 2);
    ctx.lineTo(5, -3);
    ctx.moveTo(0, 2);
    ctx.lineTo(-5, -3);
    ctx.stroke();
    ctx.restore();
  }
  function ovalLeaf(ctx, x, y, s, a, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,15,5,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-s * 1.2, 0);
    ctx.lineTo(s, 0);
    ctx.stroke();
    ctx.restore();
  }

  function grass(ctx, rnd, x, y, w, h, n, colors) {
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var gx = x + rnd() * w, gy = y + rnd() * h, len = R(rnd, 5, 16);
      ctx.strokeStyle = pick(rnd, colors);
      ctx.lineWidth = R(rnd, 0.8, 1.8);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + R(rnd, -3, 3), gy - len * 0.6, gx + R(rnd, -6, 6), gy - len);
      ctx.stroke();
    }
  }

  // Horizontale Holzbretter mit Maserung, Fugen, Ästen und Nägeln
  function planks(ctx, rnd, x, y, w, h, ph, base) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (var py = y; py < y + h; py += ph) {
      ctx.fillStyle = shade(base, R(rnd, -0.14, 0.1));
      ctx.fillRect(x, py, w, ph);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.8;
      for (var k = 0; k < 5; k++) {
        var gy = py + R(rnd, 2, ph - 2), ph0 = R(rnd, 0, 6);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        for (var gx = x; gx <= x + w + 20; gx += 18) ctx.lineTo(gx, gy + Math.sin(gx * 0.025 + ph0) * 1.6 + R(rnd, -0.5, 0.5));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,230,190,0.06)';
      ctx.beginPath();
      ctx.moveTo(x, py + 2);
      ctx.lineTo(x + w, py + 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, py + ph - 2, w, 2);
      var jx = x + R(rnd, 20, Math.max(30, w - 20));
      ctx.fillRect(jx, py, 2, ph);
      if (rnd() < 0.7) {
        var kx = x + rnd() * w, ky = py + ph * R(rnd, 0.3, 0.7), kr = R(rnd, 2, 5);
        ctx.fillStyle = 'rgba(30,15,5,0.55)';
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * 1.8, kr, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,15,5,0.35)';
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * 3, kr * 1.7, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,20,22,0.8)';
      [jx - 6, jx + 8].forEach(function (nx) {
        circle(ctx, nx, py + ph * 0.3, 1.3);
        ctx.fill();
        circle(ctx, nx, py + ph * 0.7, 1.3);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function rain(ctx, rnd, n, color, x0, y0, w, h, slant) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = x0 + rnd() * w, y = y0 + rnd() * h, len = R(rnd, 10, 28);
      ctx.globalAlpha = R(rnd, 0.12, 0.38);
      ctx.lineWidth = R(rnd, 0.6, 1.4);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * slant, y + len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function splashes(ctx, rnd, n, x, y, w, h) {
    ctx.strokeStyle = 'rgba(200,215,230,0.35)';
    ctx.lineWidth = 0.8;
    for (var i = 0; i < n; i++) {
      var sx = x + rnd() * w, sy = y + rnd() * h, r = R(rnd, 2, 6);
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * 0.3, 0, 0, TAU);
      ctx.stroke();
      if (rnd() < 0.5) {
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy - 1);
        ctx.lineTo(sx - 4, sy - 5);
        ctx.moveTo(sx + 2, sy - 1);
        ctx.lineTo(sx + 4, sy - 5);
        ctx.stroke();
      }
    }
  }

  function fogBand(ctx, y, h, color) {
    var g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - h / 2, S, h);
  }

  function vignette(ctx, strength) {
    var g = ctx.createRadialGradient(300, 300, 170, 300, 300, 440);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + strength + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  function glow(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Feine Körnung direkt auf die Pixel (nach dem Zeichnen)
  function grain(canvas, ctx, rnd, amt) {
    try {
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = (rnd() - 0.5) * amt;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) { /* ignorieren */ }
  }

  function scaleOf(ctx) {
    try { return ctx.getTransform().a || 1; } catch (e) { return 1; }
  }

  // ================================================================ HALLOWEEN
  function house(ctx, rnd, x, w, wallTop, roofTop, base, color, lit) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 9, wallTop + 2);
    ctx.lineTo(x + w / 2, roofTop);
    ctx.lineTo(x + w + 9, wallTop + 2);
    ctx.lineTo(x + w, wallTop + 2);
    ctx.lineTo(x + w, base);
    ctx.lineTo(x, base);
    ctx.lineTo(x, wallTop + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (var k = 1; k < 6; k++) {
      var yy = roofTop + ((wallTop - roofTop) * k) / 6, half = ((w / 2 + 9) * k) / 6;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - half, yy);
      ctx.lineTo(x + w / 2 + half, yy);
      ctx.stroke();
    }
    for (var sy = wallTop + 8; sy < base; sy += 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
      ctx.stroke();
    }
    var cols = Math.max(2, Math.round(w / 48)), rows = Math.max(1, Math.floor((base - wallTop - 18) / 36));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cw = (w - 20) / cols, wx = x + 10 + c * cw + 5, wy = wallTop + 12 + r * 36, ww = cw - 10, wh = 21;
        if (rnd() < lit) {
          var wg = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 2, wx + ww / 2, wy + wh / 2, ww);
          wg.addColorStop(0, '#ffe39a');
          wg.addColorStop(1, '#c9762a');
          ctx.fillStyle = wg;
          ctx.shadowColor = 'rgba(255,190,90,0.8)';
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = '#0a0710';
        }
        ctx.fillRect(wx, wy, ww, wh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy);
        ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh / 2);
        ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();
      }
    }
  }

  function fence(ctx, rnd, y, h, color) {
    ctx.fillStyle = shade(color, -0.4);
    ctx.fillRect(0, y + h * 0.26, S, 8);
    ctx.fillRect(0, y + h * 0.74, S, 8);
    for (var x = 4; x < S; x += 24) {
      if (rnd() < 0.05) continue;
      var tilt = rnd() < 0.1 ? R(rnd, -0.13, 0.13) : R(rnd, -0.015, 0.015);
      var top = R(rnd, -5, 5) - h;
      ctx.save();
      ctx.translate(x + 8, y + h);
      ctx.rotate(tilt);
      var pg = ctx.createLinearGradient(-8, 0, 8, 0);
      pg.addColorStop(0, shade(color, 0.12));
      pg.addColorStop(1, shade(color, -0.3));
      ctx.fillStyle = pg;
      poly(ctx, [-8, 0, -8, top + 12, 0, top, 8, top + 12, 8, 0]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-3, -4);
      ctx.lineTo(-3, top + 18);
      ctx.moveTo(3, -6);
      ctx.lineTo(2.5, top + 22);
      ctx.stroke();
      // abblätternde Farbe und Schmutz
      for (var k = 0; k < 4; k++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(60,45,55,0.5)' : 'rgba(40,60,30,0.35)';
        ctx.fillRect(R(rnd, -7, 4), R(rnd, top + 14, -6), R(rnd, 1.5, 4), R(rnd, 2, 7));
      }
      ctx.fillStyle = 'rgba(20,20,20,0.8)';
      circle(ctx, 0, -h * 0.26 + 4, 1.2);
      ctx.fill();
      circle(ctx, 0, -h * 0.74 + 4, 1.2);
      ctx.fill();
      ctx.restore();
    }
  }

  function streetSign(ctx, px, signY, text) {
    var pg = ctx.createLinearGradient(px - 4, 0, px + 4, 0);
    pg.addColorStop(0, '#73777f');
    pg.addColorStop(1, '#2b2e35');
    ctx.fillStyle = pg;
    ctx.fillRect(px - 4, signY - 12, 8, 432 - signY);
    ctx.fillStyle = '#4a4d55';
    ctx.fillRect(px - 6, signY - 16, 12, 6);
    ctx.save();
    ctx.translate(px, signY + 19);
    ctx.rotate(-0.045);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    roundRect(ctx, -88, -21, 176, 42, 5);
    var sg = ctx.createLinearGradient(0, -21, 0, 21);
    sg.addColorStop(0, '#24804a');
    sg.addColorStop(1, '#155a32');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.shadowBlur = 0;
    roundRect(ctx, -83, -16, 166, 32, 3);
    ctx.strokeStyle = '#e9efe9';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f2f5f0';
    var size = 21;
    ctx.font = 'bold ' + size + 'px Arial, Helvetica, sans-serif';
    while (ctx.measureText(text).width > 148 && size > 10) {
      size--;
      ctx.font = 'bold ' + size + 'px Arial, Helvetica, sans-serif';
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 1.5);
    ctx.fillStyle = '#b8c0c0';
    circle(ctx, -77, 0, 2);
    ctx.fill();
    circle(ctx, 77, 0, 2);
    ctx.fill();
    // Rostspur unter der Schraube
    var rg = ctx.createLinearGradient(0, 0, 0, 18);
    rg.addColorStop(0, 'rgba(140,70,20,0.7)');
    rg.addColorStop(1, 'rgba(140,70,20,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(75, 2, 3, 16);
    ctx.restore();
  }

  function steps(ctx, rnd) {
    var defs = [
      { x: 258, ty: 446, tH: 16, rH: 50 },
      { x: 236, ty: 512, tH: 13, rH: 38 },
      { x: 214, ty: 563, tH: 11, rH: 26 }
    ];
    defs.forEach(function (d) {
      var tg = ctx.createLinearGradient(0, d.ty, 0, d.ty + d.tH);
      tg.addColorStop(0, '#5b3f2a');
      tg.addColorStop(1, '#7c583b');
      ctx.fillStyle = tg;
      poly(ctx, [d.x + 12, d.ty, S, d.ty, S, d.ty + d.tH, d.x, d.ty + d.tH]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.7;
      for (var gx = d.x + 30; gx < S; gx += R(rnd, 40, 90)) {
        ctx.beginPath();
        ctx.moveTo(gx, d.ty + 1);
        ctx.lineTo(gx - 3, d.ty + d.tH - 1);
        ctx.stroke();
      }
      planks(ctx, rnd, d.x, d.ty + d.tH, S - d.x, d.rH, d.rH / 2, '#46301f');
      ctx.fillStyle = 'rgba(255,200,140,0.12)';
      ctx.fillRect(d.x, d.ty + d.tH - 2, S - d.x, 2);
      var sg = ctx.createLinearGradient(d.x, 0, d.x + 26, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.55)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(d.x, d.ty, 26, d.tH + d.rH);
    });
  }

  function pumpkin(ctx, rnd, cx, cy, rx, ry, carved) {
    if (carved) glow(ctx, cx, cy + 10, rx * 3.4, 'rgba(255,140,30,0.42)');
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy + ry * 0.95, rx * 1.05, ry * 0.18, 0, 0, TAU);
    ctx.fill();
    [[-0.62, 0.42, 0.86], [0.62, 0.42, 0.86], [-0.33, 0.5, 0.96], [0.33, 0.5, 0.96], [0, 0.46, 1]].forEach(function (r) {
      var x = cx + r[0] * rx, w = r[1] * rx, h = r[2] * ry;
      var gg = ctx.createRadialGradient(x - w * 0.3, cy - h * 0.4, 2, x, cy, Math.max(w, h));
      gg.addColorStop(0, carved ? '#ffb347' : '#f0a040');
      gg.addColorStop(0.55, carved ? '#f07b16' : '#d9711a');
      gg.addColorStop(1, '#8f3c07');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(x, cy, w, h, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,35,5,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    // Stiel
    ctx.fillStyle = '#4b5a23';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - ry * 0.92);
    ctx.quadraticCurveTo(cx - 6, cy - ry - 18, cx + 8, cy - ry - 22);
    ctx.lineTo(cx + 12, cy - ry - 16);
    ctx.quadraticCurveTo(cx + 4, cy - ry - 10, cx + 7, cy - ry * 0.92);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,25,5,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!carved) return;
    ctx.save();
    ctx.shadowColor = '#ffb030';
    ctx.shadowBlur = 18;
    var fg = ctx.createRadialGradient(cx, cy + 5, 4, cx, cy + 5, rx);
    fg.addColorStop(0, '#fff6b8');
    fg.addColorStop(0.5, '#ffc23d');
    fg.addColorStop(1, '#ff7b0f');
    ctx.fillStyle = fg;
    var s = rx / 76;
    function P(pts) { return pts.map(function (v, i) { return i % 2 ? cy + v * s : cx + v * s; }); }
    poly(ctx, P([-40, -6, -12, -6, -27, -34]));
    ctx.fill();
    poly(ctx, P([12, -6, 40, -6, 27, -34]));
    ctx.fill();
    poly(ctx, P([-8, 9, 8, 9, 0, -4]));
    ctx.fill();
    poly(ctx, P([-54, 14, -32, 22, -24, 15, -15, 25, 15, 25, 24, 15, 32, 22, 54, 14, 44, 31, 30, 45, 19, 39, 10, 50, -10, 50, -19, 39, -30, 45, -44, 31]));
    ctx.fill();
    ctx.restore();
    // geschnitzter Rand
    ctx.strokeStyle = 'rgba(110,45,5,0.85)';
    ctx.lineWidth = 2;
    poly(ctx, P([-40, -6, -12, -6, -27, -34]));
    ctx.stroke();
    poly(ctx, P([12, -6, 40, -6, 27, -34]));
    ctx.stroke();
  }

  function knife(ctx, x, y, len, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(len * 0.2, 14, len * 0.6, 5, 0, 0, TAU);
    ctx.fill();
    var hl = len * 0.36;
    var hg = ctx.createLinearGradient(0, -9, 0, 9);
    hg.addColorStop(0, '#3a2a22');
    hg.addColorStop(1, '#0e0907');
    ctx.fillStyle = hg;
    roundRect(ctx, -hl, -9, hl, 18, 7);
    ctx.fill();
    ctx.fillStyle = '#d6d0c2';
    [-hl * 0.75, -hl * 0.45, -hl * 0.15].forEach(function (rx) {
      circle(ctx, rx, 0, 2.6);
      ctx.fill();
    });
    ctx.fillStyle = '#9aa1a9';
    ctx.fillRect(-2, -10, 7, 20);
    var bl = len - hl;
    var bg = ctx.createLinearGradient(0, -12, 0, 12);
    bg.addColorStop(0, '#f4f7fa');
    bg.addColorStop(0.45, '#bcc3cb');
    bg.addColorStop(1, '#69707a');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(5, -10);
    ctx.lineTo(bl * 0.75, -9);
    ctx.quadraticCurveTo(bl * 0.95, -6, bl, 2);
    ctx.lineTo(5, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, 7);
    ctx.lineTo(bl * 0.96, 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,140,40,0.22)';
    ctx.beginPath();
    ctx.moveTo(12, -8);
    ctx.lineTo(bl * 0.6, -7);
    ctx.lineTo(bl * 0.55, -2);
    ctx.lineTo(12, -1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function halloween(ctx, rnd) {
    var g = ctx.createLinearGradient(0, 0, 0, 380);
    g.addColorStop(0, '#08061c');
    g.addColorStop(0.45, '#1c1035');
    g.addColorStop(0.8, '#43203a');
    g.addColorStop(1, '#6b3322');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, 380);
    stars(ctx, rnd, 190, S, 320);
    moon(ctx, rnd, 468, 108, 56, '#eadfb0');
    for (var i = 0; i < 8; i++) cloud(ctx, rnd, R(rnd, -40, 640), R(rnd, 25, 240), R(rnd, 90, 210), 'rgba(26,16,44,0.5)');
    cloud(ctx, rnd, 455, 150, 160, 'rgba(24,14,40,0.6)');
    bat(ctx, 405, 80, 28);
    bat(ctx, 525, 160, 17);
    bat(ctx, 196, 64, 21);
    bat(ctx, 300, 150, 14);
    bat(ctx, 76, 118, 16);
    bat(ctx, 250, 34, 11);
    bat(ctx, 560, 58, 12);

    house(ctx, rnd, 118, 140, 268, 222, 352, '#130d1b', 0.5);
    house(ctx, rnd, 298, 112, 286, 248, 352, '#100b17', 0.35);
    house(ctx, rnd, 432, 170, 262, 206, 352, '#140e1d', 0.55);
    ctx.fillStyle = '#120c1a';
    ctx.fillRect(560, 214, 18, 40);
    // Gestalt im erleuchteten Fenster
    var fx = 330, fy = 298;
    var fw = ctx.createRadialGradient(fx + 14, fy + 12, 2, fx + 14, fy + 12, 24);
    fw.addColorStop(0, '#ffe7a6');
    fw.addColorStop(1, '#d0802e');
    ctx.fillStyle = fw;
    ctx.shadowColor = 'rgba(255,190,90,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillRect(fx, fy, 30, 26);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0710';
    circle(ctx, fx + 15, fy + 10, 5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(fx + 5, fy + 26);
    ctx.quadraticCurveTo(fx + 15, fy + 11, fx + 25, fy + 26);
    ctx.fill();
    ctx.strokeStyle = '#0b0710';
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, 30, 26);

    fogBand(ctx, 336, 70, 'rgba(170,150,200,0.12)');
    ctx.strokeStyle = '#0a0610';
    ctx.lineCap = 'round';
    branch(ctx, rnd, 44, 400, 118, -Math.PI / 2 + 0.06, 7, 13);
    branch(ctx, rnd, 585, 372, 80, -Math.PI / 2 - 0.15, 6, 9);

    var lg = ctx.createLinearGradient(0, 390, 0, 600);
    lg.addColorStop(0, '#10160c');
    lg.addColorStop(1, '#1d2713');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 390, S, 210);
    grass(ctx, rnd, 0, 400, 270, 200, 750, ['#24331a', '#2e4020', '#1a2612', '#3a4a24']);

    fence(ctx, rnd, 318, 92, '#a49eb2');
    for (i = 0; i < 10; i++) leaf(ctx, R(rnd, 0, S), R(rnd, 330, 405), R(rnd, 6, 9), R(rnd, 0, TAU), pick(rnd, LEAVES));
    streetSign(ctx, 100, 200, 'HADDONFIELD');
    steps(ctx, rnd);
    pumpkin(ctx, rnd, 150, 480, 34, 26, false);
    for (i = 0; i < 75; i++) leaf(ctx, R(rnd, 0, 250), R(rnd, 420, 600), R(rnd, 6, 12), R(rnd, 0, TAU), pick(rnd, LEAVES));
    for (i = 0; i < 40; i++) leaf(ctx, R(rnd, 230, 600), R(rnd, 450, 600), R(rnd, 6, 11), R(rnd, 0, TAU), pick(rnd, LEAVES));
    pumpkin(ctx, rnd, 392, 396, 76, 57, true);
    knife(ctx, 455, 532, 150, -0.36);
    for (i = 0; i < 26; i++) {
      ctx.globalAlpha = R(rnd, 0.5, 0.9);
      leaf(ctx, R(rnd, 0, S), R(rnd, 30, 320), R(rnd, 4, 8), R(rnd, 0, TAU), pick(rnd, LEAVES));
    }
    ctx.globalAlpha = 1;
    vignette(ctx, 0.55);
  }

  // ================================================================ ES
  function esHouse(ctx, rnd, x, w, wallTop, roofTop, base, color, porch) {
    ctx.fillStyle = color;
    poly(ctx, [x - 10, wallTop, x + w / 2, roofTop, x + w + 10, wallTop, x + w, wallTop, x + w, base, x, base, x, wallTop]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,220,255,0.05)';
    ctx.lineWidth = 1;
    for (var sy = wallTop + 6; sy < base; sy += 7) {
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
      ctx.stroke();
    }
    for (var k = 1; k < 7; k++) {
      var yy = roofTop + ((wallTop - roofTop) * k) / 7, half = ((w / 2 + 10) * k) / 7;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - half, yy);
      ctx.lineTo(x + w / 2 + half, yy);
      ctx.stroke();
    }
    var wins = porch
      ? [[x + 30, wallTop + 18, true], [x + w - 70, wallTop + 18, false], [x + w - 70, wallTop + 105, true]]
      : [[x + 30, wallTop + 22, false], [x + 110, wallTop + 22, true], [x + 30, wallTop + 100, true]];
    wins.forEach(function (wi) {
      var wx = wi[0], wy = wi[1];
      if (wi[2]) {
        ctx.shadowColor = 'rgba(255,200,110,0.7)';
        ctx.shadowBlur = 14;
        var wg = ctx.createLinearGradient(wx, wy, wx, wy + 40);
        wg.addColorStop(0, '#e9c46a');
        wg.addColorStop(1, '#a8702e');
        ctx.fillStyle = wg;
      } else {
        ctx.fillStyle = '#0b0f14';
      }
      ctx.fillRect(wx, wy, 40, 40);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#05070a';
      ctx.lineWidth = 3;
      ctx.strokeRect(wx, wy, 40, 40);
      ctx.beginPath();
      ctx.moveTo(wx + 20, wy);
      ctx.lineTo(wx + 20, wy + 40);
      ctx.moveTo(wx, wy + 20);
      ctx.lineTo(wx + 40, wy + 20);
      ctx.stroke();
      if (!wi[2]) {
        ctx.fillStyle = 'rgba(60,20,25,0.7)';
        ctx.fillRect(wx + 2, wy + 2, 12, 36);
      }
    });
    if (porch) {
      ctx.fillStyle = '#1d242e';
      ctx.fillRect(x, wallTop + 82, w, 10);
      ctx.fillStyle = '#232b35';
      for (var cx = x + 14; cx < x + w; cx += 56) ctx.fillRect(cx, wallTop + 92, 7, base - wallTop - 92);
      ctx.fillStyle = '#0d1116';
      ctx.fillRect(x + 80, wallTop + 112, 34, base - wallTop - 112);
      ctx.strokeStyle = 'rgba(160,180,200,0.12)';
      ctx.lineWidth = 2;
      for (var rx = x; rx < x + w; rx += 9) {
        ctx.beginPath();
        ctx.moveTo(rx, base - 30);
        ctx.lineTo(rx, base - 4);
        ctx.stroke();
      }
      ctx.fillRect(x, base - 32, w, 3);
    }
  }

  function foliage(ctx, rnd, x, y, w, h, colors) {
    ctx.strokeStyle = '#080c09';
    for (var t = 0; t < 4; t++) {
      var tx = x + R(rnd, 20, w - 20);
      ctx.lineWidth = R(rnd, 5, 9);
      ctx.beginPath();
      ctx.moveTo(tx, y + h);
      ctx.lineTo(tx + R(rnd, -10, 10), y + h * 0.3);
      ctx.stroke();
    }
    for (var i = 0; i < 90; i++) {
      ctx.fillStyle = pick(rnd, colors);
      circle(ctx, x + rnd() * w, y + rnd() * h * 0.85, R(rnd, 10, 26));
      ctx.fill();
    }
    dots(ctx, rnd, x, y, w, h * 0.85, 160, '#2a3a30', 1, 3, 0.2, 0.5);
  }

  function reflection(ctx, rnd, x, y0, y1, w, color) {
    ctx.fillStyle = color;
    for (var y = y0; y < y1; y += 3) {
      var p = (y - y0) / (y1 - y0);
      var ww = w * (1 - p * 0.5) * R(rnd, 0.4, 1.2);
      ctx.globalAlpha = (1 - p) * R(rnd, 0.4, 1);
      ctx.fillRect(x - ww / 2 + R(rnd, -3, 3), y, ww, 2);
    }
    ctx.globalAlpha = 1;
  }

  function puddle(ctx, rnd, x, y, rx, ry, tint) {
    ctx.fillStyle = tint || 'rgba(70,90,110,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,210,230,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (var i = 0; i < 4; i++) {
      var r = R(rnd, 3, rx * 0.5);
      ctx.beginPath();
      ctx.ellipse(x + R(rnd, -rx * 0.5, rx * 0.5), y + R(rnd, -ry * 0.4, ry * 0.4), r, r * 0.28, 0, 0, TAU);
      ctx.stroke();
    }
  }

  function paperBoat(ctx, x, y, s, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(230,225,205,0.14)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 54, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#b6ad96';
    poly(ctx, [-32, -2, -14, -34, -2, -2]);
    ctx.fill();
    var sg = ctx.createLinearGradient(-14, -48, 18, -2);
    sg.addColorStop(0, '#f6f0dc');
    sg.addColorStop(1, '#cfc5aa');
    ctx.fillStyle = sg;
    poly(ctx, [-14, -2, 2, -48, 18, -2]);
    ctx.fill();
    ctx.fillStyle = '#d8cfb6';
    poly(ctx, [10, -2, 24, -30, 36, -2]);
    ctx.fill();
    var hg = ctx.createLinearGradient(0, -4, 0, 12);
    hg.addColorStop(0, '#f1ead6');
    hg.addColorStop(1, '#a9a088');
    ctx.fillStyle = hg;
    poly(ctx, [-52, -4, 52, -4, 35, 13, -35, 13]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,60,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-52, -4);
    ctx.lineTo(52, -4);
    ctx.moveTo(2, -48);
    ctx.lineTo(2, -4);
    ctx.moveTo(-35, 13);
    ctx.lineTo(-22, -4);
    ctx.moveTo(35, 13);
    ctx.lineTo(22, -4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,130,140,0.35)';
    ctx.beginPath();
    ctx.ellipse(-20, 6, 9, 4, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(16, 8, 7, 3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function balloon(ctx, x, y, rx, ry) {
    glow(ctx, x, y, rx * 2.4, 'rgba(220,30,40,0.18)');
    var bg = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, rx * 0.1, x, y, ry * 1.05);
    bg.addColorStop(0, '#ff7a7a');
    bg.addColorStop(0.35, '#e0202f');
    bg.addColorStop(0.8, '#9c0f1c');
    bg.addColorStop(1, '#5e0710');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(x, y - ry);
    ctx.bezierCurveTo(x + rx * 1.35, y - ry, x + rx * 1.1, y + ry * 0.75, x, y + ry);
    ctx.bezierCurveTo(x - rx * 1.1, y + ry * 0.75, x - rx * 1.35, y - ry, x, y - ry);
    ctx.fill();
    ctx.fillStyle = '#8c0c18';
    poly(ctx, [x - 6, y + ry + 7, x + 6, y + ry + 7, x, y + ry - 2]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.38, y - ry * 0.48, rx * 0.16, ry * 0.24, -0.45, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + rx * 0.45, y + ry * 0.2, rx * 0.06, ry * 0.18, 0.3, 0, TAU);
    ctx.fill();
  }

  function es(ctx, rnd) {
    var g = ctx.createLinearGradient(0, 0, 0, 280);
    g.addColorStop(0, '#0a0f17');
    g.addColorStop(1, '#27323e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, 280);
    for (var i = 0; i < 10; i++) cloud(ctx, rnd, R(rnd, -60, 660), R(rnd, -10, 120), R(rnd, 140, 260), 'rgba(55,68,82,0.32)');
    foliage(ctx, rnd, 170, 110, 250, 160, ['#0b130f', '#0f1913', '#132017', '#0d1611']);
    esHouse(ctx, rnd, -20, 215, 70, 18, 262, '#161c25', true);
    esHouse(ctx, rnd, 405, 215, 96, 46, 262, '#131921', false);
    ctx.fillStyle = '#2b3036';
    ctx.fillRect(0, 262, S, 16);
    dots(ctx, rnd, 0, 262, S, 16, 120, '#5a6068', 0.5, 1.5, 0.2, 0.6);

    // Straßenlaterne
    glow(ctx, 252, 66, 170, 'rgba(255,214,140,0.3)');
    ctx.fillStyle = 'rgba(255,214,140,0.07)';
    poly(ctx, [244, 76, 260, 76, 340, 280, 165, 280]);
    ctx.fill();
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(248, 70, 8, 205);
    ctx.fillRect(243, 262, 18, 12);
    ctx.fillStyle = '#2a2e35';
    poly(ctx, [238, 52, 266, 52, 260, 76, 244, 76]);
    ctx.fill();
    ctx.fillStyle = '#ffe2a0';
    ctx.shadowColor = '#ffd27a';
    ctx.shadowBlur = 20;
    ctx.fillRect(244, 57, 16, 15);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#16191e';
    poly(ctx, [234, 52, 270, 52, 252, 40]);
    ctx.fill();

    // Straße
    var sg = ctx.createLinearGradient(0, 278, 0, 398);
    sg.addColorStop(0, '#121519');
    sg.addColorStop(1, '#1c2026');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 278, S, 120);
    dots(ctx, rnd, 0, 278, S, 120, 1400, '#9aa4ae', 0.4, 1, 0.04, 0.16);
    ctx.fillStyle = 'rgba(190,160,70,0.35)';
    for (var dx = -20; dx < S; dx += 72) ctx.fillRect(dx, 334, 40, 4);
    reflection(ctx, rnd, 252, 280, 398, 30, 'rgba(255,205,120,0.5)');
    reflection(ctx, rnd, 60, 280, 398, 14, 'rgba(220,180,90,0.3)');
    reflection(ctx, rnd, 535, 280, 398, 14, 'rgba(220,180,90,0.28)');
    puddle(ctx, rnd, 120, 362, 60, 10);
    puddle(ctx, rnd, 470, 300, 50, 8);
    puddle(ctx, rnd, 330, 386, 72, 9);
    puddle(ctx, rnd, 560, 360, 40, 7);

    // Rinnstein mit Wasser
    var wg = ctx.createLinearGradient(0, 398, 0, 434);
    wg.addColorStop(0, '#1d252e');
    wg.addColorStop(1, '#2a3540');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 398, S, 36);
    ctx.strokeStyle = 'rgba(180,200,220,0.25)';
    ctx.lineWidth = 1;
    for (i = 0; i < 46; i++) {
      var fy0 = R(rnd, 401, 431), fx0 = R(rnd, -40, S), fl = R(rnd, 20, 70);
      ctx.beginPath();
      ctx.moveTo(fx0, fy0);
      ctx.quadraticCurveTo(fx0 + fl / 2, fy0 + R(rnd, -2, 2), fx0 + fl, fy0);
      ctx.stroke();
    }
    for (i = 0; i < 9; i++) ovalLeaf(ctx, R(rnd, 0, S), R(rnd, 404, 430), R(rnd, 5, 9), R(rnd, -0.4, 0.4), pick(rnd, ['#5a3a1a', '#4a3015', '#6b4a20']));

    // Bordstein
    var tg = ctx.createLinearGradient(0, 434, 0, 444);
    tg.addColorStop(0, '#8a8f95');
    tg.addColorStop(1, '#6b7076');
    ctx.fillStyle = tg;
    ctx.fillRect(0, 434, S, 10);
    var cg = ctx.createLinearGradient(0, 444, 0, 490);
    cg.addColorStop(0, '#5f6469');
    cg.addColorStop(1, '#45494e');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 444, S, 46);
    dots(ctx, rnd, 0, 434, S, 56, 900, '#2a2d31', 0.5, 1.8, 0.15, 0.5);
    dots(ctx, rnd, 0, 434, S, 56, 300, '#b0b5ba', 0.4, 1.2, 0.1, 0.35);
    ctx.fillStyle = 'rgba(30,35,40,0.6)';
    for (var jx = 70; jx < S; jx += 150) ctx.fillRect(jx, 434, 2, 56);
    ctx.strokeStyle = 'rgba(20,24,28,0.6)';
    for (i = 0; i < 20; i++) {
      var wx = R(rnd, 0, S);
      ctx.lineWidth = R(rnd, 0.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(wx, 446);
      ctx.lineTo(wx + R(rnd, -2, 2), 446 + R(rnd, 10, 40));
      ctx.stroke();
    }
    // Gully mit Augen
    ctx.fillStyle = '#1f2226';
    roundRect(ctx, 258, 448, 214, 37, 8);
    ctx.fill();
    var dg = ctx.createLinearGradient(0, 452, 0, 482);
    dg.addColorStop(0, '#000000');
    dg.addColorStop(1, '#0c0d0f');
    ctx.fillStyle = dg;
    roundRect(ctx, 263, 452, 204, 29, 6);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = '#ffbf00';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd23a';
    [[338, 467], [384, 467]].forEach(function (p) {
      ctx.beginPath();
      ctx.moveTo(p[0] - 9, p[1]);
      ctx.quadraticCurveTo(p[0], p[1] - 7, p[0] + 9, p[1] + 1);
      ctx.quadraticCurveTo(p[0], p[1] + 5, p[0] - 9, p[1]);
      ctx.fill();
    });
    ctx.restore();
    ctx.fillStyle = '#1a0d00';
    ctx.fillRect(337, 462, 2, 9);
    ctx.fillRect(383, 462, 2, 9);

    // Gehweg
    var pg = ctx.createLinearGradient(0, 490, 0, 600);
    pg.addColorStop(0, '#50555a');
    pg.addColorStop(1, '#3c4045');
    ctx.fillStyle = pg;
    ctx.fillRect(0, 490, S, 110);
    dots(ctx, rnd, 0, 490, S, 110, 1300, '#2a2d31', 0.5, 1.6, 0.12, 0.45);
    dots(ctx, rnd, 0, 490, S, 110, 400, '#9ca2a8', 0.4, 1.1, 0.08, 0.3);
    ctx.fillStyle = 'rgba(25,28,32,0.85)';
    ctx.fillRect(0, 546, S, 3);
    [55, 230, 410, 585].forEach(function (x) { ctx.fillRect(x, 490, 3, 56); });
    [140, 320, 500].forEach(function (x) { ctx.fillRect(x, 549, 3, 51); });
    ctx.strokeStyle = 'rgba(15,17,20,0.8)';
    ctx.lineWidth = 1.2;
    for (i = 0; i < 6; i++) {
      var crx = R(rnd, 0, S), cry = R(rnd, 495, 595);
      ctx.beginPath();
      ctx.moveTo(crx, cry);
      for (var k = 0; k < 5; k++) {
        crx += R(rnd, 4, 14);
        cry += R(rnd, -6, 6);
        ctx.lineTo(crx, cry);
      }
      ctx.stroke();
    }
    puddle(ctx, rnd, 452, 570, 62, 13, 'rgba(60,75,90,0.5)');
    ctx.fillStyle = 'rgba(200,30,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(440, 570, 16, 8, 0, 0, TAU);
    ctx.fill();
    puddle(ctx, rnd, 120, 520, 44, 9);
    for (i = 0; i < 16; i++) ovalLeaf(ctx, R(rnd, 0, S), R(rnd, 495, 598), R(rnd, 5, 10), R(rnd, 0, TAU), pick(rnd, ['#6b4a20', '#5a3a1a', '#7a3b12', '#4a3015']));

    // Schnur und Ballon
    var st = ctx.createLinearGradient(0, 281, 0, 472);
    st.addColorStop(0, '#dcdcdc');
    st.addColorStop(0.9, '#cfcfcf');
    st.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.strokeStyle = st;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(366, 283);
    ctx.bezierCurveTo(382, 340, 338, 410, 352, 472);
    ctx.stroke();
    paperBoat(ctx, 165, 412, 1, -0.05);
    balloon(ctx, 366, 205, 58, 70);

    rain(ctx, rnd, 520, '#b8c6d4', -20, -30, S + 40, S + 30, 0.18);
    splashes(ctx, rnd, 60, 0, 300, S, 300);
    dots(ctx, rnd, 320, 150, 90, 110, 22, '#ffffff', 0.6, 1.4, 0.3, 0.7);
    vignette(ctx, 0.5);
  }

  // ================================================================ FREITAG
  function pine(ctx, x, base, h, w) {
    var tiers = 6;
    ctx.beginPath();
    ctx.moveTo(x, base - h);
    for (var k = 1; k <= tiers; k++) {
      var yy = base - h + (h * k) / tiers, ww = (w * k) / tiers;
      ctx.lineTo(x + ww * 0.5, yy);
      ctx.lineTo(x + ww * 0.26, yy - 2);
    }
    ctx.lineTo(x + w * 0.1, base + 40);
    ctx.lineTo(x - w * 0.1, base + 40);
    for (var k2 = tiers; k2 >= 1; k2--) {
      var yy2 = base - h + (h * k2) / tiers, ww2 = (w * k2) / tiers;
      ctx.lineTo(x - ww2 * 0.26, yy2 - 2);
      ctx.lineTo(x - ww2 * 0.5, yy2);
    }
    ctx.closePath();
    ctx.fill();
  }

  function forest(ctx, rnd, base, hMin, hMax, color, sp) {
    ctx.fillStyle = color;
    ctx.fillRect(0, base, S, 20);
    for (var x = -20; x < S + 20; x += sp * R(rnd, 0.55, 1.1)) pine(ctx, x, base + R(rnd, -4, 6), R(rnd, hMin, hMax), sp * R(rnd, 1.1, 1.6));
  }

  function cabin(ctx, rnd) {
    var x = 392, w = 150, top = 250, base = 300;
    // Rauch
    for (var i = 0; i < 9; i++) {
      ctx.fillStyle = 'rgba(150,160,175,' + (0.12 - i * 0.011).toFixed(3) + ')';
      circle(ctx, 528 - i * 9 + R(rnd, -4, 4), 212 - i * 14, 8 + i * 3);
      ctx.fill();
    }
    ctx.fillStyle = '#1c130e';
    ctx.fillRect(520, 214, 14, 34);
    var wg = ctx.createLinearGradient(0, top, 0, base);
    wg.addColorStop(0, '#3a2719');
    wg.addColorStop(1, '#24170f');
    ctx.fillStyle = wg;
    ctx.fillRect(x, top, w, base - top);
    for (var ly = top + 4; ly < base; ly += 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
      ctx.fillStyle = '#4a3322';
      circle(ctx, x - 1, ly - 4, 4);
      ctx.fill();
      circle(ctx, x + w + 1, ly - 4, 4);
      ctx.fill();
    }
    ctx.fillStyle = '#140d09';
    poly(ctx, [x - 14, top + 2, x + w / 2, 212, x + w + 14, top + 2]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.25)';
    ctx.lineWidth = 1;
    for (var k = 1; k < 6; k++) {
      var yy = 212 + ((top + 2 - 212) * k) / 6, half = ((w / 2 + 14) * k) / 6;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - half, yy);
      ctx.lineTo(x + w / 2 + half, yy);
      ctx.stroke();
    }
    ctx.fillStyle = '#0f0906';
    ctx.fillRect(x + 18, top + 16, 22, base - top - 16);
    glow(ctx, x + 100, top + 22, 60, 'rgba(255,170,80,0.35)');
    ctx.fillStyle = '#ffb35a';
    ctx.shadowColor = '#ffa040';
    ctx.shadowBlur = 14;
    ctx.fillRect(x + 84, top + 12, 32, 22);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#1a0f08';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 84, top + 12, 32, 22);
    ctx.beginPath();
    ctx.moveTo(x + 100, top + 12);
    ctx.lineTo(x + 100, top + 34);
    ctx.moveTo(x + 84, top + 23);
    ctx.lineTo(x + 116, top + 23);
    ctx.stroke();
  }

  function dock(ctx, rnd) {
    ctx.fillStyle = '#1b130d';
    [[372, 380], [420, 380], [392, 336], [430, 336]].forEach(function (p) { ctx.fillRect(p[0] - 3, p[1] - 6, 6, 34); });
    var pts = [403, 300, 438, 300, 432, 382, 356, 382];
    var dg = ctx.createLinearGradient(0, 300, 0, 382);
    dg.addColorStop(0, '#3a2a1c');
    dg.addColorStop(1, '#5a432e');
    ctx.fillStyle = dg;
    poly(ctx, pts);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.2;
    for (var y = 306; y < 382; y += 6 + (y - 300) * 0.05) {
      var p = (y - 300) / 82;
      ctx.beginPath();
      ctx.moveTo(403 - p * 47, y);
      ctx.lineTo(438 - p * 6, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,170,120,0.08)';
    ctx.fillRect(360, 384, 70, 30);
    // Ruderboot
    ctx.fillStyle = '#2a1d14';
    ctx.beginPath();
    ctx.moveTo(452, 352);
    ctx.quadraticCurveTo(490, 368, 532, 352);
    ctx.lineTo(522, 362);
    ctx.quadraticCurveTo(490, 374, 460, 362);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,170,120,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(452, 352);
    ctx.quadraticCurveTo(490, 368, 532, 352);
    ctx.stroke();
  }

  function reeds(ctx, rnd, x0, x1, base, n) {
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = R(rnd, x0, x1), h = R(rnd, 18, 62);
      ctx.strokeStyle = pick(rnd, ['#0a1712', '#0f2018', '#13281e']);
      ctx.lineWidth = R(rnd, 1, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + R(rnd, -4, 4), base - h * 0.6, x + R(rnd, -8, 8), base - h);
      ctx.stroke();
      if (rnd() < 0.25) {
        ctx.fillStyle = '#2a1a10';
        ctx.beginPath();
        ctx.ellipse(x + R(rnd, -3, 3), base - h + 4, 2.5, 7, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  function hockeyMask(ctx, rnd, cx, cy, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx + 18, cy + ry * 0.97, rx * 0.95, 14, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.92, cy - ry * 0.2);
    ctx.quadraticCurveTo(cx - rx * 1.5, cy + ry * 0.2, cx - rx * 1.25, cy + ry * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.92, cy - ry * 0.2);
    ctx.quadraticCurveTo(cx + rx * 1.55, cy + ry * 0.1, cx + rx * 1.4, cy + ry * 0.92);
    ctx.stroke();
    function outline() {
      ctx.beginPath();
      ctx.moveTo(cx, cy - ry);
      ctx.bezierCurveTo(cx + rx * 1.06, cy - ry, cx + rx * 1.06, cy + ry * 0.35, cx + rx * 0.55, cy + ry * 0.8);
      ctx.quadraticCurveTo(cx, cy + ry * 1.12, cx - rx * 0.55, cy + ry * 0.8);
      ctx.bezierCurveTo(cx - rx * 1.06, cy + ry * 0.35, cx - rx * 1.06, cy - ry, cx, cy - ry);
      ctx.closePath();
    }
    outline();
    var mg = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.35, 5, cx, cy, ry * 1.1);
    mg.addColorStop(0, '#fbf8ee');
    mg.addColorStop(0.6, '#ddd6c3');
    mg.addColorStop(1, '#9d957f');
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,50,35,0.7)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Mondlicht von links
    ctx.save();
    outline();
    ctx.clip();
    var ml = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    ml.addColorStop(0, 'rgba(190,215,255,0.18)');
    ml.addColorStop(1, 'rgba(0,0,30,0.22)');
    ctx.fillStyle = ml;
    ctx.fillRect(cx - rx * 1.2, cy - ry * 1.1, rx * 2.4, ry * 2.3);
    ctx.restore();
    // Nasenrücken
    ctx.strokeStyle = 'rgba(120,110,90,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry * 0.35);
    ctx.quadraticCurveTo(cx + 3, cy + ry * 0.05, cx, cy + ry * 0.2);
    ctx.stroke();
    // Augen
    var eyes = [[cx - rx * 0.42, cy - ry * 0.12, 0.18], [cx + rx * 0.42, cy - ry * 0.12, -0.18]];
    eyes.forEach(function (e) {
      ctx.fillStyle = '#060606';
      ctx.beginPath();
      ctx.ellipse(e[0], e[1], 17, 11, e[2], 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(e[0], e[1] + 2, 18, 12, e[2], 0.2, Math.PI - 0.2);
      ctx.stroke();
    });
    // Rote Winkel
    function chevron(x, y, w, h, t, rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      poly(ctx, [-w / 2, -h / 2, 0, h / 2 - t, w / 2, -h / 2, w / 2, -h / 2 + t, 0, h / 2, -w / 2, -h / 2 + t]);
      ctx.fillStyle = '#c4122b';
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,0,10,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    chevron(cx, cy - ry * 0.6, 42, 22, 8, 0);
    chevron(cx - rx * 0.56, cy + ry * 0.3, 28, 15, 6, -0.45);
    chevron(cx + rx * 0.56, cy + ry * 0.3, 28, 15, 6, 0.45);
    // Atemlöcher
    for (var y = cy - ry * 0.86; y < cy + ry * 0.85; y += 12) {
      var row = Math.round((y - cy) / 12);
      for (var x = cx - rx; x < cx + rx; x += 12) {
        var hx = x + (row % 2 ? 6 : 0), hy = y;
        var nx = (hx - cx) / (rx * 0.84), ny = (hy - cy) / (ry * 0.88);
        if (nx * nx + ny * ny > 1) continue;
        if (hy > cy + ry * 0.62 && Math.abs(hx - cx) > rx * 0.42) continue;
        if (Math.abs(hx - cx) < 26 && hy > cy - ry * 0.78 && hy < cy - ry * 0.42) continue;
        if (eyes.some(function (e) { return Math.abs(hx - e[0]) < 26 && Math.abs(hy - e[1]) < 18; })) continue;
        if (Math.abs(hx - cx) < 9 && hy > cy - ry * 0.4 && hy < cy + ry * 0.2) continue;
        if (Math.abs(Math.abs(hx - cx) - rx * 0.56) < 20 && Math.abs(hy - (cy + ry * 0.3)) < 13) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        circle(ctx, hx + 0.6, hy + 1.2, 3.4);
        ctx.fill();
        ctx.fillStyle = '#0d0b08';
        circle(ctx, hx, hy, 3.2);
        ctx.fill();
      }
    }
    // Kratzer und Dreck
    ctx.strokeStyle = 'rgba(90,70,45,0.45)';
    ctx.lineWidth = 0.8;
    for (var i = 0; i < 14; i++) {
      var sx = cx + R(rnd, -rx * 0.7, rx * 0.7), sy = cy + R(rnd, -ry * 0.8, ry * 0.7);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + R(rnd, -14, 14), sy + R(rnd, -6, 6));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(110,30,20,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.3, cy + ry * 0.62, 9, 5, 0.6, 0, TAU);
    ctx.fill();
  }

  function machete(ctx, rnd, tx, ty, len, a) {
    // Kerbe im Holz
    ctx.strokeStyle = '#120a05';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tx - 12, ty + 3);
    ctx.lineTo(tx + 10, ty - 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(210,170,120,0.5)';
    ctx.lineWidth = 1;
    for (var s = 0; s < 4; s++) {
      ctx.beginPath();
      ctx.moveTo(tx + R(rnd, -8, 8), ty);
      ctx.lineTo(tx + R(rnd, -16, 16), ty + R(rnd, -6, 3));
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(a);
    var bl = len * 0.68;
    var bg = ctx.createLinearGradient(0, -16, 0, 14);
    bg.addColorStop(0, '#5a6168');
    bg.addColorStop(0.3, '#dfe5ea');
    bg.addColorStop(0.55, '#9ba3ab');
    bg.addColorStop(1, '#474d53');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(6, -9);
    ctx.quadraticCurveTo(bl * 0.4, -15, bl, -11);
    ctx.lineTo(bl, 9);
    ctx.quadraticCurveTo(bl * 0.45, 18, 6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10, 3);
    ctx.quadraticCurveTo(bl * 0.45, 12, bl - 4, 5);
    ctx.stroke();
    for (var i = 0; i < 16; i++) {
      ctx.fillStyle = rgba(pick(rnd, ['#7a3b12', '#8f4a1b', '#5a2a0e']), R(rnd, 0.3, 0.7).toFixed(2));
      circle(ctx, R(rnd, 12, bl - 8), R(rnd, -10, 8), R(rnd, 1, 3.5));
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(220,235,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bl * 0.55, -11);
    ctx.lineTo(bl * 0.78, -11.5);
    ctx.stroke();
    ctx.fillStyle = '#2b2b2b';
    roundRect(ctx, bl - 2, -14, 8, 28, 2);
    ctx.fill();
    var hg = ctx.createLinearGradient(0, -10, 0, 10);
    hg.addColorStop(0, '#3e2c20');
    hg.addColorStop(1, '#140e0a');
    ctx.fillStyle = hg;
    roundRect(ctx, bl + 5, -10, len - bl - 5, 20, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    for (var x = bl + 12; x < len - 6; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x + 4, 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  function freitag(ctx, rnd) {
    var g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, '#040912');
    g.addColorStop(0.7, '#0d1e31');
    g.addColorStop(1, '#17324b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, 300);
    stars(ctx, rnd, 230, S, 260);
    moon(ctx, rnd, 140, 100, 48, '#e3e9ee');
    for (var i = 0; i < 6; i++) cloud(ctx, rnd, R(rnd, -40, 640), R(rnd, 40, 200), R(rnd, 90, 190), 'rgba(18,34,54,0.5)');
    forest(ctx, rnd, 266, 50, 105, '#0c1c29', 30);
    forest(ctx, rnd, 288, 34, 80, '#06111a', 24);
    cabin(ctx, rnd);
    var lgr = ctx.createLinearGradient(0, 292, 0, 442);
    lgr.addColorStop(0, '#0e2236');
    lgr.addColorStop(1, '#06111c');
    ctx.fillStyle = lgr;
    ctx.fillRect(0, 294, S, 148);
    // Spiegelung des Waldes
    ctx.fillStyle = 'rgba(3,10,16,0.6)';
    ctx.fillRect(0, 294, S, 14);
    // Mondspiegelung
    for (var y = 298; y < 440; y += 3) {
      var p = (y - 298) / 142;
      ctx.fillStyle = 'rgba(210,228,245,' + (0.55 * (1 - p) * R(rnd, 0.4, 1)).toFixed(3) + ')';
      var w = R(rnd, 6, 36) * (1 - p * 0.4);
      ctx.fillRect(140 - w / 2 + R(rnd, -6, 6), y, w, 1.6);
    }
    reflection(ctx, rnd, 492, 300, 360, 18, 'rgba(255,170,80,0.45)');
    ctx.strokeStyle = 'rgba(150,180,210,0.18)';
    ctx.lineWidth = 1;
    for (i = 0; i < 70; i++) {
      var rx0 = R(rnd, 0, S), ry0 = R(rnd, 304, 438), rl = R(rnd, 10, 40);
      ctx.beginPath();
      ctx.moveTo(rx0, ry0);
      ctx.quadraticCurveTo(rx0 + rl / 2, ry0 - 1.5, rx0 + rl, ry0);
      ctx.stroke();
    }
    dock(ctx, rnd);
    reeds(ctx, rnd, 0, 140, 442, 70);
    reeds(ctx, rnd, 520, 600, 442, 40);
    fogBand(ctx, 312, 60, 'rgba(180,200,225,0.12)');
    for (i = 0; i < 16; i++) {
      var fx = R(rnd, 0, S), fy = R(rnd, 250, 430);
      glow(ctx, fx, fy, 9, 'rgba(210,255,120,0.45)');
      ctx.fillStyle = '#e8ff9a';
      circle(ctx, fx, fy, 1.4);
      ctx.fill();
    }
    planks(ctx, rnd, 0, 440, S, 160, 40, '#5a4331');
    var sh = ctx.createLinearGradient(0, 440, 0, 456);
    sh.addColorStop(0, 'rgba(0,0,0,0.7)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 440, S, 16);
    hockeyMask(ctx, rnd, 212, 438, 74, 100);
    machete(ctx, rnd, 455, 566, 175, -0.98);
    ctx.fillStyle = 'rgba(120,25,15,0.5)';
    ctx.beginPath();
    ctx.ellipse(500, 585, 14, 4, 0.1, 0, TAU);
    ctx.fill();
    vignette(ctx, 0.5);
  }

  // ================================================================ RING
  function wallpaper(ctx, rnd, x, y, w, h) {
    ctx.strokeStyle = 'rgba(70,95,98,0.22)';
    ctx.lineWidth = 1.2;
    for (var d = -h; d < w + h; d += 34) {
      ctx.beginPath();
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
      ctx.moveTo(x + d, y + h);
      ctx.lineTo(x + d + h, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(95,120,120,0.28)';
    for (var gy = y; gy < y + h; gy += 34) {
      for (var gx = x + (Math.round(gy / 34) % 2 ? 17 : 0); gx < x + w; gx += 34) {
        ctx.beginPath();
        ctx.moveTo(gx, gy + 17 - 5);
        ctx.lineTo(gx + 4, gy + 17);
        ctx.lineTo(gx, gy + 17 + 5);
        ctx.lineTo(gx - 4, gy + 17);
        ctx.closePath();
        ctx.fill();
      }
    }
    for (var i = 0; i < 14; i++) {
      glow(ctx, x + rnd() * w, y + rnd() * h, R(rnd, 20, 60), 'rgba(40,30,10,0.25)');
    }
  }

  function nightWindow(ctx, rnd, x, y, w, h) {
    ctx.fillStyle = '#0c0907';
    ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#0b1a2e');
    g.addColorStop(1, '#1f3550');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    glow(ctx, x + w * 0.7, y + h * 0.25, 50, 'rgba(200,220,255,0.35)');
    ctx.fillStyle = '#e8eef5';
    circle(ctx, x + w * 0.7, y + h * 0.25, 11);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = '#05070b';
    ctx.lineCap = 'round';
    branch(ctx, rnd, x + 8, y + h, 60, -Math.PI / 2 + 0.3, 6, 5);
    ctx.restore();
    ctx.strokeStyle = '#0c0907';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,220,0.14)';
    ctx.fillRect(x, y, 22, h);
    ctx.fillRect(x + w - 22, y, 22, h);
    ctx.fillStyle = '#0c0907';
    ctx.fillRect(x - 14, y + h + 6, w + 28, 7);
  }

  function portrait(ctx, rnd, x, y, w, h) {
    var fg = ctx.createLinearGradient(x, y, x + w, y + h);
    fg.addColorStop(0, '#6b5428');
    fg.addColorStop(0.5, '#3a2c13');
    fg.addColorStop(1, '#5e4823');
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#16120c';
    ctx.fillRect(x + 10, y + 10, w - 20, h - 20);
    var bg = ctx.createRadialGradient(x + w / 2, y + h * 0.4, 5, x + w / 2, y + h / 2, w);
    bg.addColorStop(0, '#2c3a33');
    bg.addColorStop(1, '#0d120f');
    ctx.fillStyle = bg;
    ctx.fillRect(x + 13, y + 13, w - 26, h - 26);
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.42, w * 0.17, h * 0.15, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + h - 13);
    ctx.quadraticCurveTo(x + w / 2, y + h * 0.5, x + w * 0.75, y + h - 13);
    ctx.fill();
    ctx.fillStyle = 'rgba(240,240,230,0.85)';
    circle(ctx, x + w / 2 - 5, y + h * 0.41, 1.4);
    ctx.fill();
    circle(ctx, x + w / 2 + 5, y + h * 0.41, 1.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,160,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  }

  function curtain(ctx, rnd, x, y, w, h) {
    for (var i = 0; i < 6; i++) {
      var fx = x + (i * w) / 6, fw = w / 6 + 2;
      var g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
      g.addColorStop(0, '#1c0507');
      g.addColorStop(0.5, '#4a1016');
      g.addColorStop(1, '#1c0507');
      ctx.fillStyle = g;
      ctx.fillRect(fx, y, fw, h + (i % 2 ? 6 : 0));
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (var k = 0; k < 40; k++) ctx.fillRect(x + rnd() * w, y + rnd() * h, 1, R(rnd, 10, 40));
    ctx.fillStyle = '#7a5a20';
    ctx.fillRect(x, y + h * 0.45, w, 7);
  }

  function tvScreen(rnd, w, h, k) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k));
    c.height = Math.max(1, Math.ceil(h * k));
    var x = c.getContext('2d');
    x.scale(k, k);
    var sky = x.createLinearGradient(0, 0, 0, h * 0.5);
    sky.addColorStop(0, '#aeb6b1');
    sky.addColorStop(1, '#717a75');
    x.fillStyle = sky;
    x.fillRect(0, 0, w, h);
    for (var i = 0; i < 8; i++) cloud(x, rnd, R(rnd, 0, w), R(rnd, 5, 50), R(rnd, 40, 90), 'rgba(200,205,200,0.25)');
    x.fillStyle = '#353c38';
    for (var tx = -10; tx < w + 10; tx += R(rnd, 7, 14)) pine(x, tx, 112, R(rnd, 26, 52), R(rnd, 12, 20));
    var gr = x.createLinearGradient(0, 105, 0, h);
    gr.addColorStop(0, '#5c655d');
    gr.addColorStop(1, '#353d36');
    x.fillStyle = gr;
    x.fillRect(0, 108, w, h - 108);
    grass(x, rnd, 0, 112, w, h - 112, 260, ['#4a524b', '#2f3530', '#6a736b']);
    var cx = w / 2, top = 124, rw = 66, rh = 16, depth = 56;
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.beginPath();
    x.ellipse(cx + 8, top + depth + 4, rw * 1.1, rh, 0, 0, TAU);
    x.fill();
    x.save();
    x.beginPath();
    x.moveTo(cx - rw, top);
    x.lineTo(cx - rw, top + depth);
    x.ellipse(cx, top + depth, rw, rh, 0, Math.PI, 0, true);
    x.lineTo(cx + rw, top);
    x.closePath();
    x.clip();
    var side = x.createLinearGradient(cx - rw, 0, cx + rw, 0);
    side.addColorStop(0, '#3f4541');
    side.addColorStop(0.4, '#8c928c');
    side.addColorStop(1, '#2e332f');
    x.fillStyle = side;
    x.fillRect(cx - rw, top - rh, rw * 2, depth + rh * 2);
    x.strokeStyle = 'rgba(20,24,22,0.7)';
    x.lineWidth = 1;
    for (var row = 0; row < 6; row++) {
      var by = top + 4 + row * 9.5;
      x.beginPath();
      x.ellipse(cx, by, rw, rh, 0, 0, Math.PI);
      x.stroke();
      for (var a = 0.15 + (row % 2) * 0.2; a < Math.PI; a += 0.4) {
        var bx = cx + Math.cos(a) * rw;
        x.beginPath();
        x.moveTo(bx, by + Math.sin(a) * rh);
        x.lineTo(bx, by + Math.sin(a) * rh + 9.5);
        x.stroke();
      }
    }
    x.restore();
    x.fillStyle = '#9da39e';
    x.beginPath();
    x.ellipse(cx, top, rw, rh, 0, 0, TAU);
    x.fill();
    x.fillStyle = '#030303';
    x.beginPath();
    x.ellipse(cx, top, rw - 8, rh - 5, 0, 0, TAU);
    x.fill();
    // Haare über den Rand
    x.strokeStyle = '#050505';
    x.lineCap = 'round';
    for (i = 0; i < 60; i++) {
      var hx = cx + R(rnd, -30, 40), hy = top + R(rnd, -2, 5);
      x.lineWidth = R(rnd, 0.9, 2.4);
      x.beginPath();
      x.moveTo(hx, hy);
      x.bezierCurveTo(hx + R(rnd, -4, 4), hy + 12, hx + R(rnd, -8, 8), hy + 26, hx + R(rnd, -10, 10), hy + R(rnd, 30, 52));
      x.stroke();
    }
    // Hand am Rand: Handrücken im Brunnen, Finger über die Kante
    var hdx = cx - 44, hdy = top + 4;
    x.fillStyle = '#cfccc2';
    x.beginPath();
    x.ellipse(hdx + 12, hdy - 7, 17, 7, -0.1, 0, TAU);
    x.fill();
    [['#6e6c64', 9], ['#e2dfd5', 6.5]].forEach(function (st) {
      x.strokeStyle = st[0];
      x.lineWidth = st[1];
      for (var f = 0; f < 4; f++) {
        x.beginPath();
        x.moveTo(hdx + f * 8, hdy - 5);
        x.quadraticCurveTo(hdx + f * 8 + 3, hdy + 7, hdx + f * 8 - 1, hdy + 17 - Math.abs(f - 1.5) * 3);
        x.stroke();
      }
    });
    x.fillStyle = 'rgba(80,70,70,0.6)';
    for (var nf = 0; nf < 4; nf++) {
      circle(x, hdx + nf * 8 - 1, hdy + 15 - Math.abs(nf - 1.5) * 3, 1.6);
      x.fill();
    }
    // Grünstich, Zeilen, Rauschen
    x.fillStyle = 'rgba(110,150,130,0.16)';
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.18)';
    for (var sl = 0; sl < h; sl += 2.4) x.fillRect(0, sl, w, 0.9);
    x.setTransform(1, 0, 0, 1, 0, 0);
    try {
      var img = x.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width, H = c.height;
      var bands = [];
      for (i = 0; i < 5; i++) bands.push([Math.floor(rnd() * H), Math.floor(R(rnd, 2, 6) * k)]);
      for (var py = 0; py < H; py++) {
        var inBand = bands.some(function (b) { return py >= b[0] && py < b[0] + b[1]; });
        for (var px = 0; px < W; px++) {
          var e = Math.min(px / W, 1 - px / W, py / H, 1 - py / H);
          var amt = inBand ? 0.7 : Math.max(0, 1 - e / 0.15) * 0.8 + 0.06;
          var n = rnd() * 255, o = (py * W + px) * 4;
          d[o] = d[o] * (1 - amt) + n * amt;
          d[o + 1] = d[o + 1] * (1 - amt) + n * amt;
          d[o + 2] = d[o + 2] * (1 - amt) + n * amt;
        }
      }
      x.putImageData(img, 0, 0);
    } catch (err) { /* ignorieren */ }
    return c;
  }

  function tv(ctx, rnd, x, y, w, h) {
    ctx.strokeStyle = '#8a8f96';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + 2);
    ctx.lineTo(x + w * 0.31, y - 92);
    ctx.moveTo(x + w * 0.5, y + 2);
    ctx.lineTo(x + w * 0.72, y - 96);
    ctx.stroke();
    ctx.fillStyle = '#b6bbc2';
    circle(ctx, x + w * 0.31, y - 92, 3.5);
    ctx.fill();
    circle(ctx, x + w * 0.72, y - 96, 3.5);
    ctx.fill();
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y + 2, 26, 10, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#20140c';
    poly(ctx, [x + 26, y + h, x + 42, y + h, x + 38, y + h + 28, x + 30, y + h + 28]);
    ctx.fill();
    poly(ctx, [x + w - 42, y + h, x + w - 26, y + h, x + w - 30, y + h + 28, x + w - 38, y + h + 28]);
    ctx.fill();
    var cg = ctx.createLinearGradient(x, y, x, y + h);
    cg.addColorStop(0, '#5a3a25');
    cg.addColorStop(1, '#2e1d13');
    ctx.fillStyle = cg;
    roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.save();
    roundRect(ctx, x, y, w, h, 16);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (var gy = y + 4; gy < y + h; gy += 5) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      for (var gx = x; gx <= x + w; gx += 16) ctx.lineTo(gx, gy + Math.sin(gx * 0.04 + gy * 0.13) * 1.8);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,220,180,0.18)';
    ctx.lineWidth = 2;
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 14);
    ctx.stroke();
    var bw = w * 0.68;
    ctx.fillStyle = '#141414';
    roundRect(ctx, x + 22, y + 20, bw, h - 40, 30);
    ctx.fill();
    var sx = x + 38, sy = y + 36, sw = bw - 32, sh = h - 72;
    var scr = tvScreen(rnd, sw, sh, scaleOf(ctx));
    ctx.save();
    roundRect(ctx, sx, sy, sw, sh, 34);
    ctx.clip();
    ctx.drawImage(scr, sx, sy, sw, sh);
    var vg = ctx.createRadialGradient(sx + sw / 2, sy + sh / 2, sw * 0.25, sx + sw / 2, sy + sh / 2, sw * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.ellipse(sx + sw * 0.3, sy + sh * 0.2, sw * 0.35, sh * 0.12, -0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Bedienfeld
    var px = x + 22 + bw + 14, pw = x + w - 16 - px;
    [[y + 62, 17], [y + 116, 13]].forEach(function (kn) {
      var kx = px + pw / 2, ky = kn[0];
      var kg = ctx.createRadialGradient(kx - 4, ky - 4, 1, kx, ky, kn[1]);
      kg.addColorStop(0, '#5a5a5a');
      kg.addColorStop(1, '#151515');
      ctx.fillStyle = kg;
      circle(ctx, kx, ky, kn[1]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      for (var a = 0; a < TAU; a += TAU / 16) {
        ctx.beginPath();
        ctx.moveTo(kx + Math.cos(a) * kn[1] * 0.8, ky + Math.sin(a) * kn[1] * 0.8);
        ctx.lineTo(kx + Math.cos(a) * kn[1], ky + Math.sin(a) * kn[1]);
        ctx.stroke();
      }
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx + kn[1] * 0.6, ky - kn[1] * 0.55);
      ctx.stroke();
    });
    ctx.fillStyle = '#1a120c';
    roundRect(ctx, px + 2, y + 150, pw - 4, h - 196, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,60,0.5)';
    ctx.lineWidth = 2;
    for (var ly = y + 158; ly < y + h - 52; ly += 6) {
      ctx.beginPath();
      ctx.moveTo(px + 8, ly);
      ctx.lineTo(px + pw - 8, ly);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff2a1a';
    ctx.shadowColor = '#ff2a1a';
    ctx.shadowBlur = 8;
    circle(ctx, px + pw / 2, y + h - 30, 2.6);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function vhs(ctx, rnd, x, y, w, h) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-0.07);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(w / 2 + 6, h + 4, w * 0.55, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0c0c0c';
    poly(ctx, [0, h * 0.72, w, h * 0.72, w, h, 0, h]);
    ctx.fill();
    var tg = ctx.createLinearGradient(0, 0, 0, h * 0.72);
    tg.addColorStop(0, '#2a2a2a');
    tg.addColorStop(1, '#161616');
    ctx.fillStyle = tg;
    poly(ctx, [14, 0, w + 14, 0, w, h * 0.72, 0, h * 0.72]);
    ctx.fill();
    ctx.fillStyle = '#e6e1d3';
    poly(ctx, [w * 0.18 + 10, 4, w * 0.82 + 10, 4, w * 0.82 + 4, h * 0.3, w * 0.18 + 4, h * 0.3]);
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.1;
    for (var l = 0; l < 2; l++) {
      ctx.beginPath();
      var ly = 9 + l * 6, lx = w * 0.24 + 9;
      ctx.moveTo(lx, ly);
      for (var s = 0; s < 14; s++) ctx.lineTo(lx + s * 5, ly + Math.sin(s * 1.7 + l) * 2);
      ctx.stroke();
    }
    [[w * 0.3, h * 0.48], [w * 0.7, h * 0.48]].forEach(function (p) {
      ctx.fillStyle = '#050505';
      ctx.beginPath();
      ctx.ellipse(p[0] + 5, p[1], 17, 8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#5a3a20';
      ctx.beginPath();
      ctx.ellipse(p[0] + 5, p[1], 12, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.ellipse(p[0] + 5, p[1], 5, 2.4, 0, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  function rotaryPhone(ctx, cx, cy) {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var px = cx + 30, py = cy + 14;
    ctx.moveTo(px, py);
    for (var i = 0; i < 26; i++) {
      var t = i / 25;
      ctx.lineTo(px + 18 + Math.sin(t * 40) * 5 + t * 10, py + t * 80);
    }
    ctx.stroke();
    var bg = ctx.createLinearGradient(0, cy - 12, 0, cy + 20);
    bg.addColorStop(0, '#2c2c2c');
    bg.addColorStop(1, '#0d0d0d');
    ctx.fillStyle = bg;
    poly(ctx, [cx - 36, cy + 20, cx + 36, cy + 20, cx + 25, cy - 12, cx - 25, cy - 12]);
    ctx.fill();
    ctx.fillStyle = '#111';
    roundRect(ctx, cx - 40, cy - 27, 80, 12, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - 34, cy - 21, 10, 8, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 34, cy - 21, 10, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#bfb8a8';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 15, 9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    for (var a = 0; a < 10; a++) {
      var ang = -2.4 + (a * 4.6) / 9;
      circle(ctx, cx + Math.cos(ang) * 10.5, cy + 4 + Math.sin(ang) * 6, 1.7);
      ctx.fill();
    }
    ctx.fillStyle = '#e8e2d0';
    circle(ctx, cx, cy + 4, 3.5);
    ctx.fill();
  }

  function candle(ctx, rnd, x, y) {
    glow(ctx, x, y - 34, 90, 'rgba(255,170,70,0.28)');
    var cg = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
    cg.addColorStop(0, '#d8cfb8');
    cg.addColorStop(1, '#9a917c');
    ctx.fillStyle = cg;
    ctx.fillRect(x - 7, y - 30, 14, 34);
    ctx.fillStyle = '#e9e1cc';
    ctx.beginPath();
    ctx.ellipse(x, y - 30, 7, 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(x + 3, y - 30, 3, 12);
    ctx.fillRect(x - 6, y - 30, 2.5, 7);
    ctx.fillStyle = '#c9c0a8';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 14, 4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - 30);
    ctx.lineTo(x, y - 35);
    ctx.stroke();
    var fg = ctx.createRadialGradient(x, y - 40, 1, x, y - 40, 9);
    fg.addColorStop(0, '#fffbe0');
    fg.addColorStop(0.5, '#ffc04a');
    fg.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x, y - 52);
    ctx.quadraticCurveTo(x + 7, y - 40, x, y - 33);
    ctx.quadraticCurveTo(x - 7, y - 40, x, y - 52);
    ctx.fill();
  }

  function ring(ctx, rnd) {
    var wg = ctx.createLinearGradient(0, 0, 0, 480);
    wg.addColorStop(0, '#11171a');
    wg.addColorStop(1, '#1c2426');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, S, 480);
    wallpaper(ctx, rnd, 0, 0, S, 470);
    nightWindow(ctx, rnd, 468, 34, 110, 150);
    portrait(ctx, rnd, 92, 40, 92, 116);
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(0, 466, S, 16);
    planks(ctx, rnd, 0, 482, S, 118, 30, '#33251a');
    glow(ctx, 260, 300, 380, 'rgba(150,200,205,0.2)');
    curtain(ctx, rnd, 0, 0, 74, 482);
    // Beistelltisch mit Telefon
    ctx.fillStyle = '#2a1b11';
    ctx.fillRect(504, 402, 6, 80);
    ctx.fillRect(582, 402, 6, 80);
    ctx.fillRect(500, 440, 92, 5);
    var tt = ctx.createLinearGradient(0, 392, 0, 404);
    tt.addColorStop(0, '#5a3b25');
    tt.addColorStop(1, '#3a2617');
    ctx.fillStyle = tt;
    ctx.fillRect(494, 392, 104, 12);
    ctx.fillStyle = 'rgba(230,225,210,0.55)';
    for (var dx = 498; dx < 596; dx += 8) {
      circle(ctx, dx + 4, 405, 3.6);
      ctx.fill();
    }
    rotaryPhone(ctx, 546, 372);
    tv(ctx, rnd, 118, 150, 364, 292);
    vhs(ctx, rnd, 222, 498, 158, 46);
    candle(ctx, rnd, 104, 556);
    dots(ctx, rnd, 0, 482, S, 118, 160, '#000000', 0.5, 2, 0.1, 0.4);
    vignette(ctx, 0.6);
  }

  // ================================================================ SAW
  function tileWall(ctx, rnd, x, y, w, h, size, base, grout) {
    ctx.fillStyle = grout;
    ctx.fillRect(x, y, w, h);
    for (var ty = y; ty < y + h; ty += size) {
      for (var tx = x; tx < x + w; tx += size) {
        if (rnd() < 0.035) {
          ctx.fillStyle = '#2b2a24';
          ctx.fillRect(tx + 1, ty + 1, size - 2, size - 2);
          dots(ctx, rnd, tx, ty, size, size, 30, '#6b6553', 0.5, 2, 0.2, 0.6);
          continue;
        }
        ctx.fillStyle = shade(base, R(rnd, -0.16, 0.06));
        ctx.fillRect(tx + 1.5, ty + 1.5, size - 3, size - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(tx + 2, ty + 2, size - 4, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(tx + 2, ty + size - 5, size - 4, 3);
      }
    }
  }

  function grime(ctx, rnd, x, y, w, h) {
    for (var i = 0; i < 26; i++) {
      glow(ctx, x + rnd() * w, y + rnd() * h, R(rnd, 14, 60), pick(rnd, ['rgba(70,50,20,0.35)', 'rgba(90,70,30,0.3)', 'rgba(40,40,20,0.35)', 'rgba(110,60,25,0.25)']));
    }
    ctx.strokeStyle = 'rgba(15,15,10,0.65)';
    for (i = 0; i < 9; i++) {
      var cx = x + rnd() * w, cy = y + rnd() * h;
      ctx.lineWidth = R(rnd, 0.8, 1.6);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (var k = 0; k < 7; k++) {
        cx += R(rnd, -14, 14);
        cy += R(rnd, 3, 12);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    dots(ctx, rnd, x, y, w, h, 700, '#2d2a1c', 0.5, 2, 0.1, 0.4);
  }

  function tally(ctx, x, y, groups) {
    ctx.strokeStyle = 'rgba(30,25,20,0.8)';
    ctx.lineWidth = 1.6;
    for (var g = 0; g < groups; g++) {
      var gx = x + g * 26;
      for (var i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(gx + i * 5, y);
        ctx.lineTo(gx + i * 5 + 1, y + 18);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(gx - 3, y + 14);
      ctx.lineTo(gx + 19, y + 3);
      ctx.stroke();
    }
  }

  function pipes(ctx, rnd) {
    var pg = ctx.createLinearGradient(0, 220, 0, 240);
    pg.addColorStop(0, '#8a6a52');
    pg.addColorStop(0.4, '#5e4433');
    pg.addColorStop(1, '#2e2018');
    ctx.fillStyle = pg;
    ctx.fillRect(0, 221, S, 18);
    var vg = ctx.createLinearGradient(30, 0, 52, 0);
    vg.addColorStop(0, '#8a6a52');
    vg.addColorStop(0.4, '#5e4433');
    vg.addColorStop(1, '#2a1d15');
    ctx.fillStyle = vg;
    ctx.fillRect(30, 221, 22, 379);
    [[150, 218, 14, 24], [400, 218, 14, 24], [26, 330, 30, 12], [26, 520, 30, 12]].forEach(function (f) {
      ctx.fillStyle = '#4a3527';
      ctx.fillRect(f[0], f[1], f[2], f[3]);
      ctx.fillStyle = 'rgba(255,200,150,0.15)';
      ctx.fillRect(f[0], f[1], f[2], 2);
    });
    // Rostspuren
    for (var i = 0; i < 14; i++) {
      var rx = R(rnd, 60, S), rl = R(rnd, 20, 90);
      var rg = ctx.createLinearGradient(0, 239, 0, 239 + rl);
      rg.addColorStop(0, 'rgba(120,60,20,0.55)');
      rg.addColorStop(1, 'rgba(120,60,20,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(rx, 239, R(rnd, 2, 5), rl);
    }
    dots(ctx, rnd, 0, 221, S, 18, 160, '#a0521d', 0.6, 2, 0.3, 0.8);
    // Ventilrad
    ctx.strokeStyle = '#7a2a18';
    ctx.lineWidth = 4;
    circle(ctx, 41, 300, 16);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (var a = 0; a < 3; a++) {
      ctx.beginPath();
      ctx.moveTo(41 + Math.cos(a * 2.09) * 16, 300 + Math.sin(a * 2.09) * 16);
      ctx.lineTo(41, 300);
      ctx.stroke();
    }
    ctx.fillStyle = '#3a2a20';
    circle(ctx, 41, 300, 4);
    ctx.fill();
  }

  function mirror(ctx, rnd, x, y, w, h) {
    ctx.fillStyle = '#2d2a26';
    ctx.fillRect(x - 7, y - 7, w + 14, h + 14);
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#5d6d60');
    g.addColorStop(0.5, '#2c3a31');
    g.addColorStop(1, '#4a5a4d');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    poly(ctx, [x + 10, y, x + 40, y, x + 4, y + h, x, y + h, x, y + 30]);
    ctx.fill();
    var ix = x + w * 0.55, iy = y + h * 0.38;
    ctx.strokeStyle = 'rgba(230,240,230,0.7)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 11; i++) {
      var a = (i / 11) * TAU + R(rnd, -0.2, 0.2), len = R(rnd, 30, 90);
      var px = ix, py = iy;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (var k = 0; k < 4; k++) {
        px += (Math.cos(a) * len) / 4 + R(rnd, -4, 4);
        py += (Math.sin(a) * len) / 4 + R(rnd, -4, 4);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    poly(ctx, [ix, iy, ix + 30, iy + 10, ix + 12, iy + 34]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,240,230,0.5)';
    circle(ctx, ix, iy, 5);
    ctx.stroke();
  }

  function floorTiles(ctx, rnd) {
    var g = ctx.createLinearGradient(0, 432, 0, 600);
    g.addColorStop(0, '#3a4234');
    g.addColorStop(1, '#262c22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 432, S, 168);
    var rows = [432, 450, 472, 500, 536, 580, 640];
    var vpx = 300, vpy = 250;
    for (var r = 0; r < rows.length - 1; r++) {
      for (var c = -12; c < 12; c++) {
        if ((r + c) % 2) continue;
        var bx0 = 300 + c * 70, bx1 = 300 + (c + 1) * 70;
        var y0 = rows[r], y1 = rows[r + 1];
        var f0 = (y0 - vpy) / (600 - vpy), f1 = (y1 - vpy) / (600 - vpy);
        ctx.fillStyle = 'rgba(150,165,135,' + R(rnd, 0.1, 0.2).toFixed(2) + ')';
        poly(ctx, [vpx + (bx0 - vpx) * f0, y0, vpx + (bx1 - vpx) * f0, y0, vpx + (bx1 - vpx) * f1, y1, vpx + (bx0 - vpx) * f1, y1]);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(10,12,8,0.7)';
    ctx.lineWidth = 1.5;
    rows.forEach(function (y) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y);
      ctx.stroke();
    });
    for (var c2 = -12; c2 <= 12; c2++) {
      var bx = 300 + c2 * 70, f = (432 - vpy) / (600 - vpy);
      ctx.beginPath();
      ctx.moveTo(vpx + (bx - vpx) * f, 432);
      ctx.lineTo(bx, 600);
      ctx.stroke();
    }
    dots(ctx, rnd, 0, 432, S, 168, 900, '#151810', 0.5, 2.2, 0.15, 0.5);
    for (var i = 0; i < 10; i++) glow(ctx, R(rnd, 0, S), R(rnd, 440, 600), R(rnd, 15, 45), 'rgba(60,40,15,0.35)');
    ctx.fillStyle = 'rgba(10,14,12,0.6)';
    ctx.beginPath();
    ctx.ellipse(150, 512, 70, 12, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,200,170,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#1a1c18';
    circle(ctx, 505, 568, 17);
    ctx.fill();
    ctx.strokeStyle = '#4a4e44';
    ctx.lineWidth = 2;
    circle(ctx, 505, 568, 17);
    ctx.stroke();
    for (var s = -2; s <= 2; s++) {
      ctx.beginPath();
      ctx.moveTo(497, 568 + s * 5);
      ctx.lineTo(513, 568 + s * 5);
      ctx.stroke();
    }
  }

  function chain(ctx, rnd, x0, y0, x1, y1, cxp, cyp) {
    var n = 34;
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cxp + t * t * x1;
      var y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cyp + t * t * y1;
      var dx = 2 * (1 - t) * (cxp - x0) + 2 * t * (x1 - cxp), dy = 2 * (1 - t) * (cyp - y0) + 2 * t * (y1 - cyp);
      var a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      if (i % 2) {
        ctx.strokeStyle = '#3e3a33';
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(7, 0);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#74706a';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 4.4, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(160,80,30,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = '#5a5650';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x1 + 8, y1, 11, Math.PI * 0.1, Math.PI * 1.9);
    ctx.stroke();
  }

  function hacksaw(ctx, rnd, x, y, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(100, 16, 110, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#5c5a55';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(30, -2);
    ctx.lineTo(30, -26);
    ctx.lineTo(196, -26);
    ctx.lineTo(196, 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,200,190,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(30, -28);
    ctx.lineTo(196, -28);
    ctx.stroke();
    ctx.fillStyle = '#9ba09a';
    ctx.fillRect(32, -2, 166, 7);
    ctx.fillStyle = '#6a6e68';
    ctx.beginPath();
    ctx.moveTo(32, 5);
    for (var tx = 32; tx < 198; tx += 5) {
      ctx.lineTo(tx + 2.5, 9);
      ctx.lineTo(tx + 5, 5);
    }
    ctx.closePath();
    ctx.fill();
    dots(ctx, rnd, 30, -28, 170, 36, 60, '#8a4416', 0.6, 2, 0.4, 0.8);
    var hg = ctx.createLinearGradient(0, -14, 0, 18);
    hg.addColorStop(0, '#7a1712');
    hg.addColorStop(1, '#2a0606');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(34, -10);
    ctx.quadraticCurveTo(10, -16, 0, -6);
    ctx.quadraticCurveTo(-6, 10, 8, 22);
    ctx.quadraticCurveTo(22, 26, 34, 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0d0d0d';
    ctx.beginPath();
    ctx.ellipse(14, 4, 7, 9, 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function recorder(ctx, rnd, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2 + 6, y + h + 3, w * 0.55, 6, 0, 0, TAU);
    ctx.fill();
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#2c2c2a');
    g.addColorStop(1, '#0f0f0e');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.fillStyle = '#1a1a19';
    for (var b = 0; b < 5; b++) {
      ctx.fillStyle = b === 0 ? '#8a1a14' : '#3a3a37';
      ctx.fillRect(x + 6 + b * 11, y - 5, 9, 6);
    }
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + 6, y + 9, w * 0.48, h - 18);
    ctx.fillStyle = '#4a3a2a';
    circle(ctx, x + 16, y + h / 2, 6);
    ctx.fill();
    circle(ctx, x + w * 0.48 - 4, y + h / 2, 6);
    ctx.fill();
    ctx.fillStyle = '#d8d0c0';
    circle(ctx, x + 16, y + h / 2, 2);
    ctx.fill();
    circle(ctx, x + w * 0.48 - 4, y + h / 2, 2);
    ctx.fill();
    ctx.fillStyle = '#050505';
    for (var sy = y + 9; sy < y + h - 6; sy += 6) {
      for (var sx = x + w * 0.6; sx < x + w - 5; sx += 6) {
        circle(ctx, sx, sy, 1.6);
        ctx.fill();
      }
    }
  }

  function tricycle(ctx, rnd) {
    function wheel(cx, cy, r, spokes, dark) {
      ctx.strokeStyle = dark ? '#0b0b0b' : '#151515';
      ctx.lineWidth = r * 0.22;
      circle(ctx, cx, cy, r * 0.88);
      ctx.stroke();
      ctx.strokeStyle = dark ? '#5a2a1a' : '#8a3b22';
      ctx.lineWidth = 3;
      circle(ctx, cx, cy, r * 0.74);
      ctx.stroke();
      ctx.strokeStyle = dark ? '#555' : '#8a8a86';
      ctx.lineWidth = 1;
      for (var s = 0; s < spokes; s++) {
        var a = (s / spokes) * TAU;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
        ctx.stroke();
      }
      ctx.fillStyle = '#6a6a66';
      circle(ctx, cx, cy, r * 0.14);
      ctx.fill();
      dots(ctx, rnd, cx - r, cy - r, r * 2, r * 2, 26, '#a0521d', 0.6, 2, 0.3, 0.7);
    }
    wheel(250, 552, 30, 10, true);
    function tube(pts, wdt) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4a120c';
      ctx.lineWidth = wdt + 3;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
      ctx.strokeStyle = '#9b2a1c';
      ctx.lineWidth = wdt;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,170,140,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    tube([226, 548, 248, 488, 372, 414], 9);
    tube([248, 488, 240, 458], 8);
    tube([372, 414, 380, 512], 7);
    tube([226, 548, 262, 552], 6);
    wheel(222, 548, 30, 10, false);
    wheel(380, 512, 62, 16, false);
    ctx.strokeStyle = '#3a3a37';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(380, 512);
    ctx.lineTo(398, 498);
    ctx.moveTo(380, 512);
    ctx.lineTo(362, 526);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillRect(392, 492, 16, 7);
    ctx.fillRect(354, 524, 16, 7);
    tube([372, 414, 370, 390], 6);
    ctx.strokeStyle = '#8a8a86';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(350, 386);
    ctx.lineTo(394, 393);
    ctx.stroke();
    ctx.fillStyle = '#121212';
    roundRect(ctx, 338, 380, 16, 11, 4);
    ctx.fill();
    roundRect(ctx, 390, 387, 16, 11, 4);
    ctx.fill();
    ['#c0392b', '#e0b020', '#2a7ab0'].forEach(function (c, i) {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(400, 393);
      ctx.quadraticCurveTo(408 + i * 3, 405, 404 + i * 4, 420 + i * 3);
      ctx.stroke();
    });
    dots(ctx, rnd, 220, 400, 170, 160, 90, '#c0601e', 0.6, 1.8, 0.35, 0.8);
    ctx.fillStyle = '#0c0c0c';
    ctx.beginPath();
    ctx.ellipse(238, 455, 26, 8, -0.05, 0, TAU);
    ctx.fill();
  }

  function puppet(ctx, rnd) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(250, 448);
    ctx.lineTo(302, 446);
    ctx.lineTo(320, 494);
    ctx.stroke();
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(240, 446);
    ctx.lineTo(286, 452);
    ctx.lineTo(296, 500);
    ctx.stroke();
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.ellipse(326, 500, 12, 6, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(302, 505, 11, 6, 0.2, 0, TAU);
    ctx.fill();
    var sg = ctx.createLinearGradient(220, 0, 290, 0);
    sg.addColorStop(0, '#1d1d1d');
    sg.addColorStop(1, '#070707');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(234, 452);
    ctx.lineTo(228, 378);
    ctx.quadraticCurveTo(232, 360, 256, 358);
    ctx.quadraticCurveTo(282, 360, 286, 378);
    ctx.lineTo(276, 452);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e6df';
    poly(ctx, [244, 362, 268, 362, 256, 396]);
    ctx.fill();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(256, 370);
    ctx.lineTo(256, 396);
    ctx.stroke();
    ctx.fillStyle = '#b3121f';
    poly(ctx, [256, 366, 242, 359, 242, 373]);
    ctx.fill();
    poly(ctx, [256, 366, 270, 359, 270, 373]);
    ctx.fill();
    circle(ctx, 256, 366, 3.2);
    ctx.fill();
    ctx.strokeStyle = '#0b0b0b';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(280, 372);
    ctx.lineTo(316, 398);
    ctx.lineTo(346, 388);
    ctx.stroke();
    ctx.fillStyle = '#e8e4dc';
    circle(ctx, 348, 386, 6.5);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(248, 340, 16, 20);
    var hx = 256, hy = 316;
    var fg = ctx.createRadialGradient(hx - 10, hy - 12, 4, hx, hy, 42);
    fg.addColorStop(0, '#f6f4ee');
    fg.addColorStop(0.7, '#d9d5cb');
    fg.addColorStop(1, '#9e998c');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 31, 39, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.moveTo(hx - 32, hy - 2);
    ctx.quadraticCurveTo(hx - 34, hy - 42, hx, hy - 42);
    ctx.quadraticCurveTo(hx + 34, hy - 42, hx + 32, hy - 2);
    ctx.quadraticCurveTo(hx + 24, hy - 26, hx + 4, hy - 26);
    ctx.quadraticCurveTo(hx - 18, hy - 22, hx - 32, hy - 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,120,120,0.4)';
    ctx.lineWidth = 1;
    for (var hl = -20; hl < 24; hl += 6) {
      ctx.beginPath();
      ctx.moveTo(hx + hl, hy - 40);
      ctx.quadraticCurveTo(hx + hl + 6, hy - 32, hx + hl + 10, hy - 26);
      ctx.stroke();
    }
    [[hx - 12, hy - 4], [hx + 12, hy - 4]].forEach(function (e) {
      ctx.fillStyle = '#050505';
      ctx.beginPath();
      ctx.ellipse(e[0], e[1], 7.5, 5.5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ff2030';
      ctx.shadowColor = '#ff0010';
      ctx.shadowBlur = 8;
      circle(ctx, e[0], e[1] + 0.5, 1.8);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    function spiral(cx, cy, dir) {
      ctx.strokeStyle = '#c0141f';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (var a = 0; a < TAU * 2.2; a += 0.2) {
        var r = 1 + a * 1.05;
        var px = cx + Math.cos(a * dir) * r, py = cy + Math.sin(a * dir) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    spiral(hx - 19, hy + 14, 1);
    spiral(hx + 19, hy + 14, -1);
    ctx.strokeStyle = 'rgba(80,70,60,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 2);
    ctx.lineTo(hx - 2, hy + 12);
    ctx.lineTo(hx + 2, hy + 13);
    ctx.stroke();
    ctx.fillStyle = '#9a0f1a';
    ctx.beginPath();
    ctx.ellipse(hx, hy + 23, 9, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a0003';
    ctx.fillRect(hx - 6, hy + 22, 12, 4);
    ctx.strokeStyle = '#3a3530';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx - 8, hy + 25);
    ctx.lineTo(hx - 9, hy + 37);
    ctx.moveTo(hx + 8, hy + 25);
    ctx.lineTo(hx + 9, hy + 37);
    ctx.stroke();
  }

  function saw(ctx, rnd) {
    tileWall(ctx, rnd, 0, 0, S, 432, 48, '#8c9a80', '#262c23');
    grime(ctx, rnd, 0, 0, S, 432);
    tally(ctx, 120, 84, 3);
    tally(ctx, 300, 140, 2);
    tally(ctx, 470, 262, 2);
    mirror(ctx, rnd, 452, 58, 118, 140);
    // Neonröhre
    glow(ctx, 300, 28, 260, 'rgba(200,255,200,0.22)');
    ctx.fillStyle = '#3c3f3a';
    ctx.fillRect(184, 10, 232, 12);
    ctx.fillStyle = '#efffef';
    ctx.shadowColor = '#c8ffc8';
    ctx.shadowBlur = 18;
    roundRect(ctx, 192, 22, 216, 7, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    // blutiger Handabdruck, verwischt
    ctx.fillStyle = 'rgba(110,20,15,0.45)';
    ctx.beginPath();
    ctx.ellipse(395, 318, 14, 17, 0.2, 0, TAU);
    ctx.fill();
    for (var f = 0; f < 4; f++) {
      ctx.beginPath();
      ctx.ellipse(384 + f * 8, 296 - Math.abs(f - 1.5) * 3, 3.4, 9, 0.15, 0, TAU);
      ctx.fill();
    }
    ctx.fillRect(390, 330, 4, 40);
    ctx.fillRect(398, 330, 3, 26);
    pipes(ctx, rnd);
    floorTiles(ctx, rnd);
    chain(ctx, rnd, 104, 238, 252, 586, 118, 520);
    hacksaw(ctx, rnd, 52, 552, -0.08);
    recorder(ctx, rnd, 452, 486, 96, 48);
    tricycle(ctx, rnd);
    puppet(ctx, rnd);
    // Farbstich und Licht
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#b9d4a6';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    var lg = ctx.createRadialGradient(300, 260, 140, 300, 280, 470);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, S, S);
  }

  // ================================================================ API
  var SCENES = { halloween: halloween, es: es, freitag: freitag, ring: ring, saw: saw };
  var cache = {};

  function draw(name, canvas) {
    var fn = SCENES[name];
    if (!fn || !canvas || !canvas.getContext) return false;
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.width / S, canvas.height / S);
    fn(ctx, mulberry32(hash(name)));
    ctx.restore();
    grain(canvas, ctx, mulberry32(hash(name) ^ 0x9e3779b9), 16);
    return true;
  }

  function dataURL(name, size, type) {
    size = size || 600;
    var key = name + '@' + size + (type || '');
    if (cache[key]) return cache[key];
    var c = document.createElement('canvas');
    c.width = c.height = size;
    if (!draw(name, c)) return null;
    cache[key] = c.toDataURL(type || 'image/jpeg', 0.9);
    return cache[key];
  }

  window.Scenes = { names: Object.keys(SCENES), draw: draw, dataURL: dataURL };
})();
