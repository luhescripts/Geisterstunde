/* Geisterstunde – Backrooms-Minispiel (Client)
 * window.Backrooms.mount(el, ctx) / unmount()
 * Spieler: Raycaster in Ich-Perspektive. Host/Zuschauer: Draufsicht mit Rangliste.
 */
(function () {
  'use strict';

  const WALK = 3.0;
  const SPRINT = 4.6;
  const RADIUS = 0.22;
  const SEND_MS = 50;
  const KEEPALIVE_MS = 250;
  const INTERP_MS = 110;
  const FOG_R = 16;
  const FOG_G = 13;
  const FOG_B = 6;
  const STAMINA_DRAIN = 1 / 2.5;
  const STAMINA_REGEN = 1 / 4;
  const STUN_MS = 6000;
  const MOUSE_SENS = 0.0024;
  const KEY_TURN = 2.4;
  // Ohne Pointer Lock: Steht die Maus am Bildrand, dreht die Kamera von selbst weiter
  const EDGE_ZONE = 0.12; // Anteil der Bildbreite links und rechts
  const EDGE_TURN = 2.2; // rad/s ganz am Rand
  const JUMPSCARE_MS = 1100;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function wrapAngle(a) {
    a %= Math.PI * 2;
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pack(r, g, b, a) {
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  function fogOf(d) {
    return 1 - Math.exp(-d * d * 0.024);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // ------------------------------------------------------------------ Texturen

  let TEXTURES = null;
  function textures() {
    if (!TEXTURES) TEXTURES = buildTextures();
    return TEXTURES;
  }

  function buildTextures() {
    const vshade = new Float32Array(64);
    for (let i = 0; i < 64; i++) vshade[i] = 1.08 - 0.24 * (i / 63);
    return {
      wall: genWall(),
      floor: genFloor(),
      ceil: genCeil(),
      panel: genPanel(false),
      panelOff: genPanel(true),
      vshade,
      note: genNote(),
      monster: genMonster(),
      players: new Map(),
      grain: genNoiseURL(160),
      staticNoise: genNoiseURL(220),
    };
  }

  function playerTex(color) {
    const T = textures();
    let t = T.players.get(color);
    if (!t) {
      t = genPlayer(color);
      T.players.set(color, t);
    }
    return t;
  }

  function genWall() {
    const rnd = mulberry32(1337);
    const stain = new Float32Array(4096);
    for (let k = 0; k < 9; k++) {
      const cx = rnd() * 64;
      const cy = 14 + rnd() * 50;
      const rad = 3 + rnd() * 11;
      const str = 0.12 + rnd() * 0.28;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          let dx = Math.abs(x - cx);
          if (dx > 32) dx = 64 - dx;
          const dy = (y - cy) * 0.8;
          const d = Math.sqrt(dx * dx + dy * dy) / rad;
          if (d < 1) stain[y * 64 + x] += (1 - d * d) * str;
        }
      }
    }
    for (let k = 0; k < 6; k++) {
      const x = (rnd() * 64) | 0;
      const y0 = (rnd() * 24) | 0;
      const len = 14 + rnd() * 34;
      for (let y = y0; y < Math.min(57, y0 + len); y++) stain[y * 64 + x] += 0.2 * (1 - (y - y0) / len);
    }
    const t = new Uint32Array(4096);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = (rnd() - 0.5) * 9;
        let r = 200 + n;
        let g = 180 + n;
        let b = 96 + n * 0.6;
        if ((x & 7) === 0) {
          r -= 16;
          g -= 15;
          b -= 10;
        }
        const mx = (x & 7) - 4;
        const my = (y & 7) - 4;
        if (Math.abs(mx) + Math.abs(my) === 2 && ((y >> 3) & 1) === ((x >> 3) & 1)) {
          r -= 12;
          g -= 14;
          b -= 9;
        }
        const s = Math.min(0.65, stain[y * 64 + x]);
        r = r * (1 - s) + 105 * s;
        g = g * (1 - s) + 86 * s;
        b = b * (1 - s) + 38 * s;
        if (y < 2) {
          r *= 0.7;
          g *= 0.7;
          b *= 0.7;
        }
        if (y >= 57) {
          r = 108 + n;
          g = 88 + n;
          b = 46 + n * 0.5;
          if (y === 57) {
            r += 34;
            g += 30;
            b += 16;
          }
          if (y === 63) {
            r *= 0.7;
            g *= 0.7;
            b *= 0.7;
          }
        }
        t[y * 64 + x] = pack(clampByte(r), clampByte(g), clampByte(b), 255);
      }
    }
    return t;
  }

  function genFloor() {
    const rnd = mulberry32(4242);
    const blot = new Float32Array(4096);
    for (let k = 0; k < 7; k++) {
      const cx = rnd() * 64;
      const cy = rnd() * 64;
      const rad = 6 + rnd() * 14;
      const str = 0.15 + rnd() * 0.25;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          let dx = Math.abs(x - cx);
          if (dx > 32) dx = 64 - dx;
          let dy = Math.abs(y - cy);
          if (dy > 32) dy = 64 - dy;
          const d = Math.sqrt(dx * dx + dy * dy) / rad;
          if (d < 1) blot[y * 64 + x] += (1 - d * d) * str;
        }
      }
    }
    const t = new Uint32Array(4096);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = (rnd() - 0.5) * 26;
        let r = 128 + n;
        let g = 108 + n * 0.9;
        let b = 58 + n * 0.5;
        if ((x + y) % 4 === 0) {
          r -= 9;
          g -= 8;
          b -= 5;
        }
        if ((x - y + 64) % 4 === 0) {
          r += 4;
          g += 4;
          b += 2;
        }
        const k = 1 - Math.min(0.5, blot[y * 64 + x]) * 0.9;
        t[y * 64 + x] = pack(clampByte(r * k), clampByte(g * k), clampByte(b * k * 0.95), 255);
      }
    }
    return t;
  }

  function genCeil() {
    const rnd = mulberry32(777);
    const t = new Uint32Array(4096);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = (rnd() - 0.5) * 8;
        let r = 206 + n;
        let g = 200 + n;
        let b = 166 + n * 0.8;
        const bx = x & 31;
        const by = y & 31;
        if (bx === 0 || by === 0) {
          r = 150;
          g = 144;
          b = 110;
        } else if (bx === 1 || by === 1) {
          r -= 16;
          g -= 16;
          b -= 14;
        }
        if (rnd() < 0.05) {
          r -= 30;
          g -= 30;
          b -= 26;
        }
        t[y * 64 + x] = pack(clampByte(r), clampByte(g), clampByte(b), 255);
      }
    }
    return t;
  }

  function genPanel(off) {
    const rnd = mulberry32(off ? 99 : 98);
    const t = new Uint32Array(4096);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = (rnd() - 0.5) * 6;
        let r;
        let g;
        let b;
        if (x < 4 || y < 4 || x > 59 || y > 59) {
          r = 168 + n;
          g = 163 + n;
          b = 138 + n;
        } else if (off) {
          r = 74 + n;
          g = 72 + n;
          b = 64 + n;
          if ((x & 7) === 0 || (y & 7) === 0) {
            r -= 10;
            g -= 10;
            b -= 10;
          }
        } else {
          const cx = (x - 32) / 28;
          const cy = (y - 32) / 28;
          const glow = 1 - (cx * cx + cy * cy) * 0.1;
          r = 238 * glow;
          g = 246 * glow;
          b = 226 * glow;
          if ((x & 7) === 0 || (y & 7) === 0) {
            r -= 12;
            g -= 12;
            b -= 12;
          }
        }
        t[y * 64 + x] = pack(clampByte(r), clampByte(g), clampByte(b), 255);
      }
    }
    return t;
  }

  function canvasToTex(cv, emissiveTest) {
    const w = cv.width;
    const h = cv.height;
    const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new Uint32Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      if (d[j + 3] < 110) continue;
      const r = d[j];
      const g = d[j + 1];
      const b = d[j + 2];
      out[i] = pack(r, g, b, emissiveTest && emissiveTest(r, g, b) ? 254 : 255);
    }
    return { tex: out, w, h };
  }

  function genNote() {
    const cv = mkCanvas(24, 28);
    const g = cv.getContext('2d');
    g.fillStyle = '#f2edda';
    g.beginPath();
    g.moveTo(2, 2);
    g.lineTo(17, 1);
    g.lineTo(22, 6);
    g.lineTo(21, 26);
    g.lineTo(3, 27);
    g.closePath();
    g.fill();
    g.fillStyle = '#cfc6aa';
    g.beginPath();
    g.moveTo(17, 1);
    g.lineTo(17, 6);
    g.lineTo(22, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = '#6a6458';
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(5, 9.5 + i * 3.4);
      g.lineTo(i === 4 ? 12 : 18, 9.5 + i * 3.4);
      g.stroke();
    }
    g.fillStyle = '#8b1a1a';
    g.fillRect(13, 22, 6, 2);
    return canvasToTex(cv, null);
  }

  function genMonster() {
    const cv = mkCanvas(64, 128);
    const g = cv.getContext('2d');
    const body = '#070608';
    g.fillStyle = body;
    g.strokeStyle = body;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const line = (pts, w) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    };
    const ell = (x, y, rx, ry) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    };
    line([[29, 84], [27, 104], [25, 126]], 5);
    line([[35, 84], [38, 104], [40, 126]], 5);
    ell(32, 62, 9, 25);
    line([[21, 42], [43, 41]], 7);
    line([[21, 43], [14, 66], [10, 92], [8, 112]], 3.5);
    line([[43, 42], [50, 64], [54, 90], [57, 110]], 3.5);
    line([[8, 112], [5, 121]], 1.5);
    line([[8, 112], [8, 122]], 1.5);
    line([[8, 112], [11, 120]], 1.5);
    line([[57, 110], [54, 119]], 1.5);
    line([[57, 110], [58, 121]], 1.5);
    line([[57, 110], [61, 118]], 1.5);
    line([[32, 40], [33, 30]], 4);
    g.save();
    g.translate(34, 21);
    g.rotate(0.18);
    ell(0, 0, 8.5, 11.5);
    g.fillStyle = '#ffffff';
    ell(-3.6, -1.5, 2.4, 1.7);
    ell(3.6, -1.8, 2.0, 1.5);
    g.strokeStyle = '#ececec';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-5, 5);
    g.quadraticCurveTo(0, 8.5, 5.5, 4.5);
    g.stroke();
    g.restore();
    return canvasToTex(cv, (r, gg, b) => r > 190 && gg > 190 && b > 190);
  }

  function genPlayer(color) {
    const cv = mkCanvas(32, 64);
    const g = cv.getContext('2d');
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, w, h, r);
      else g.rect(x, y, w, h);
      g.fill();
    };
    const shape = (e) => {
      g.beginPath();
      g.arc(16, 9, 6 + e, 0, Math.PI * 2);
      g.fill();
      rr(9 - e, 16 - e, 14 + 2 * e, 24 + 2 * e, 4);
      rr(5 - e, 17 - e, 4 + 2 * e, 21 + 2 * e, 2);
      rr(23 - e, 17 - e, 4 + 2 * e, 21 + 2 * e, 2);
      rr(10 - e, 39 - e, 5 + 2 * e, 24 + e, 2);
      rr(17 - e, 39 - e, 5 + 2 * e, 24 + e, 2);
    };
    g.fillStyle = color || '#efe6d8';
    shape(1.4);
    g.fillStyle = '#17161c';
    shape(0);
    return canvasToTex(cv, (r, gg, b) => Math.max(r, gg, b) - Math.min(r, gg, b) > 60);
  }

  function genNoiseURL(size) {
    const cv = mkCanvas(size, size);
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------------ Audio

  class BRAudio {
    constructor(sound) {
      this.S = sound;
      this.ready = false;
      this.loops = {};
    }

    ensure() {
      if (this.ready) return this.ac.state !== 'closed';
      const S = this.S;
      if (!S || !S.ctx) return false;
      try {
        this.ac = S.ctx;
        this.bus = this.ac.createGain();
        this.bus.gain.value = 1;
        this.bus.connect(S.master || this.ac.destination);
        const len = Math.floor(this.ac.sampleRate * 2);
        this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ready = true;
      } catch (e) {
        return false;
      }
      return true;
    }

    buf(name) {
      try {
        const S = this.S;
        return S && typeof S.buffer === 'function' ? S.buffer(name) || null : null;
      } catch (e) {
        return null;
      }
    }

    chain(gain, pan) {
      const g = this.ac.createGain();
      g.gain.value = gain;
      if (pan && this.ac.createStereoPanner) {
        const p = this.ac.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p);
        p.connect(this.bus);
      } else {
        g.connect(this.bus);
      }
      return g;
    }

    sample(name, gain, pan, rate) {
      if (!this.ensure()) return false;
      const b = this.buf(name);
      if (!b) return false;
      const src = this.ac.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = rate || 1;
      const o = this.chain(gain, pan || 0);
      src.connect(o);
      src.onended = () => {
        try {
          o.disconnect();
        } catch (e) {
          /* schon getrennt */
        }
      };
      src.start();
      return true;
    }

    loop(key, sampleName, synthFactory, target) {
      if (!this.ensure()) return;
      let L = this.loops[key];
      if (!L && target <= 0.001) return;
      const b = this.buf(sampleName);
      if (L && L.kind === 'synth' && b) {
        L.stop();
        L = null;
      }
      if (!L) {
        const ac = this.ac;
        if (b) {
          const src = ac.createBufferSource();
          src.buffer = b;
          src.loop = true;
          const g = ac.createGain();
          g.gain.value = 0;
          src.connect(g);
          g.connect(this.bus);
          src.start();
          L = {
            kind: 'sample',
            gain: g,
            scale: 1,
            stop() {
              try {
                src.stop();
              } catch (e) {
                /* schon gestoppt */
              }
              g.disconnect();
            },
          };
        } else if (synthFactory) {
          L = synthFactory();
        } else {
          return;
        }
        this.loops[key] = L;
      }
      L.gain.gain.setTargetAtTime(target * L.scale, this.ac.currentTime, 0.05);
    }

    destroy() {
      for (const k of Object.keys(this.loops)) {
        try {
          this.loops[k].stop();
        } catch (e) {
          /* egal */
        }
      }
      this.loops = {};
      if (this.bus) {
        try {
          this.bus.disconnect();
        } catch (e) {
          /* egal */
        }
      }
    }

    synthHum() {
      const ac = this.ac;
      const g = ac.createGain();
      g.gain.value = 0;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 340;
      const o1 = ac.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 60;
      const o2 = ac.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 120;
      const g2 = ac.createGain();
      g2.gain.value = 0.6;
      o1.connect(lp);
      o2.connect(g2);
      g2.connect(lp);
      lp.connect(g);
      g.connect(this.bus);
      o1.start();
      o2.start();
      return {
        kind: 'synth',
        gain: g,
        scale: 0.35,
        stop() {
          try {
            o1.stop();
            o2.stop();
          } catch (e) {
            /* egal */
          }
          g.disconnect();
        },
      };
    }

    synthStatic() {
      const ac = this.ac;
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.7;
      const g = ac.createGain();
      g.gain.value = 0;
      src.connect(bp);
      bp.connect(g);
      g.connect(this.bus);
      src.start();
      return {
        kind: 'synth',
        gain: g,
        scale: 0.5,
        stop() {
          try {
            src.stop();
          } catch (e) {
            /* egal */
          }
          g.disconnect();
        },
      };
    }

    noiseBurst(dur, freq, type, gain, pan) {
      const ac = this.ac;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const o = this.chain(0, pan);
      o.gain.setValueAtTime(0, t);
      o.gain.linearRampToValueAtTime(gain, t + 0.01);
      o.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(o);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
      src.onended = () => o.disconnect();
    }

    tone(type, f0, f1, dur, gain, pan, delay) {
      const ac = this.ac;
      const t = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const o = this.chain(0, pan);
      o.gain.setValueAtTime(0, t);
      o.gain.linearRampToValueAtTime(gain, t + 0.01);
      o.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(o);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      osc.onended = () => o.disconnect();
    }

    step(gain, rate) {
      if (!this.ensure()) return;
      if (!this.sample('br_step', gain, 0, rate)) this.noiseBurst(0.08, 600, 'lowpass', gain * 0.35, 0);
    }

    beat(gain) {
      if (!this.ensure()) return;
      if (this.sample('br_heartbeat', gain)) return;
      this.tone('sine', 64, 38, 0.14, gain * 0.7, 0, 0);
      this.tone('sine', 58, 36, 0.12, gain * 0.45, 0, 0.19);
    }

    growl(gain, pan, rate) {
      if (!this.ensure()) return;
      if (this.sample('br_growl', gain, pan, rate || 1)) return;
      this.noiseBurst(1.2, 220, 'lowpass', gain * 0.8, pan);
      this.tone('sawtooth', 52 * (rate || 1), 38, 1.1, gain * 0.18, pan, 0);
    }

    scream(gain, pan) {
      if (!this.ensure()) return;
      if (this.sample('br_scream', gain, pan)) return;
      const S = this.S;
      if (S && typeof S.play === 'function') {
        S.play('scream');
        return;
      }
      this.tone('sawtooth', 950, 480, 0.9, gain * 0.12, pan, 0);
    }

    jumpscare() {
      if (!this.ensure()) return;
      if (this.sample('br_jumpscare', 1)) return;
      const S = this.S;
      if (S && typeof S.play === 'function') {
        S.play('jumpscare');
        return;
      }
      this.noiseBurst(0.8, 3000, 'highpass', 0.6, 0);
      this.tone('sawtooth', 1400, 300, 0.8, 0.35, 0, 0);
      this.tone('square', 70, 50, 0.9, 0.3, 0, 0);
    }

    paper() {
      if (!this.ensure()) return;
      if (this.sample('br_paper', 0.8)) return;
      const S = this.S;
      if (S && typeof S.play === 'function') {
        S.play('pickup');
        return;
      }
      this.noiseBurst(0.15, 3500, 'highpass', 0.15, 0);
      this.tone('sine', 880, 870, 0.5, 0.12, 0, 0.05);
      this.tone('sine', 1320, 1310, 0.6, 0.08, 0, 0.12);
    }

    // Wut-Stufe: ein ferner Monsterschrei, mit jeder Stufe etwas tiefer
    rage(level) {
      if (!this.ensure()) return;
      const S = this.S;
      const rate = 1 - 0.04 * clamp(level, 1, 5);
      if (S && typeof S.has === 'function' && S.has('br_rage') && typeof S.play === 'function') {
        S.play('br_rage', { rate });
        return;
      }
      this.growl(0.9, 0, rate);
      this.scream(0.5, 0);
    }

    breath(gain) {
      if (!this.ensure()) return;
      this.sample('br_breath', gain);
    }

    whisper(gain, pan) {
      if (!this.ensure()) return;
      this.sample('br_whisper', gain, pan);
    }
  }

  // ------------------------------------------------------------------ Client

  let inst = null;

  class BRClient {
    constructor(el, ctx) {
      this.el = el;
      this.ctx = ctx || {};
      this.socket = this.ctx.socket;
      this.alive = true;
      this.domL = [];
      this.sockL = [];
      this.init = null;
      this.mode = null;
      this.snaps = [];
      this.feed = [];
      this.offset = 0;
      this.offsetSet = false;
      this.ended = false;
      this.endReason = null;
      this.awakeUntil = 0;
      this.audio = new BRAudio(this.ctx.sound);
      this._frame = () => this.frame();

      this.root = document.createElement('div');
      this.root.className = 'br-root';
      this.root.innerHTML =
        '<div class="br-loading"><div class="br-loading-title">Betrete die Backrooms …</div>' +
        '<div class="br-loading-sub">Das Summen wird lauter.</div></div>';
      el.appendChild(this.root);

      this.onSock('br:init', (d) => this.handleInit(d));
      this.onSock('br:snap', (d) => this.handleSnap(d));
      this.onSock('br:note', (d) => this.handleNote(d));
      this.onSock('br:caught', (d) => this.handleCaught(d));
      this.onSock('br:join', (d) => this.handleJoin(d));
      this.onSock('br:correct', (d) => this.handleCorrect(d));
      this.onSock('br:awake', () => this.handleAwake());
      this.onSock('br:rage', (d) => this.handleRage(d));
      this.onSock('br:end', (d) => this.handleEnd(d));
      if (this.socket) this.socket.emit('br:ready');
      this.readyRetry = setInterval(() => {
        if (!this.init && this.socket) this.socket.emit('br:ready');
      }, 2000);
      this.raf = requestAnimationFrame(this._frame);
    }

    onSock(ev, fn) {
      if (!this.socket) return;
      const h = (d) => {
        if (!this.alive) return;
        try {
          fn(d);
        } catch (e) {
          console.error('[backrooms]', ev, e);
        }
      };
      this.socket.on(ev, h);
      this.sockL.push([ev, h]);
    }

    onDom(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.domL.push([target, type, fn, opts]);
    }

    destroy() {
      this.alive = false;
      cancelAnimationFrame(this.raf);
      clearInterval(this.readyRetry);
      if (this.socket) for (const [ev, h] of this.sockL) this.socket.off(ev, h);
      for (const [t, ty, fn, o] of this.domL) t.removeEventListener(ty, fn, o);
      this.domL = [];
      if (this.ro) this.ro.disconnect();
      if (this.view && document.pointerLockElement === this.view) {
        try {
          document.exitPointerLock();
        } catch (e) {
          /* egal */
        }
      }
      this.audio.destroy();
      this.root.remove();
    }

    // ---------------------------------------------------------------- Netz

    serverNow() {
      return Date.now() + this.offset;
    }

    handleInit(d) {
      if (!d || typeof d.grid !== 'string') return;
      this.init = d;
      this.MW = d.w;
      this.MH = d.h;
      this.grid = new Uint8Array(d.w * d.h);
      for (let i = 0; i < this.grid.length; i++) this.grid[i] = d.grid.charCodeAt(i) === 35 ? 1 : 0;
      this.offset = d.now - Date.now();
      this.offsetSet = true;
      this.countdownEnd = d.countdownEnd;
      this.endAt = d.endAt;
      this.phase = d.phase;
      this.durationSec = d.durationSec;
      this.totalNotes = d.totalNotes;
      this.rage = d.rage || 0;
      this.players = new Map();
      for (const p of d.players) this.players.set(p.id, Object.assign({}, p, { flags: p.f || 0 }));
      this.monsters = new Map();
      for (const m of d.monsters) this.monsters.set(m.id, Object.assign({}, m));
      this.notes = new Map();
      for (const n of d.notes) this.notes.set(n.id, Object.assign({}, n));
      this.snaps = [];
      this.pushSnap({
        t: d.now,
        ph: d.phase,
        p: d.players.map((p) => [p.id, p.x, p.y, p.a, p.f || 0, p.notes]),
        m: d.monsters.map((m) => [m.id, m.x, m.y, m.a, m.st || 0]),
      });
      this.you = d.you;
      this.ended = d.phase === 'ended';
      this.setupLights();
      this.root.innerHTML = '';
      if (this.ro) this.ro.disconnect();
      for (const [t, ty, fn, o] of this.domL) t.removeEventListener(ty, fn, o);
      this.domL = [];
      if (this.ctx.isHost || !d.you || !this.players.has(d.you)) this.setupSpectator();
      else this.setupPlayer();
    }

    pushSnap(s) {
      const p = new Map();
      for (const e of s.p) p.set(e[0], e);
      const m = new Map();
      for (const e of s.m) m.set(e[0], e);
      this.snaps.push({ t: s.t, p, m });
      if (this.snaps.length > 40) this.snaps.shift();
    }

    handleSnap(s) {
      if (!this.init || !s) return;
      const sample = s.t - Date.now();
      if (!this.offsetSet || sample > this.offset) {
        this.offset = sample;
        this.offsetSet = true;
      } else {
        this.offset -= 0.02;
      }
      this.pushSnap(s);
      if (s.ph) this.phase = s.ph;
      if (s.ce) this.countdownEnd = s.ce;
      if (s.ea) this.endAt = s.ea;
      if (typeof s.r === 'number') this.rage = s.r;
      for (const e of s.p) {
        const pl = this.players.get(e[0]);
        if (!pl) continue;
        pl.flags = e[4];
        pl.notes = e[5];
      }
    }

    handleNote(d) {
      if (!this.init || !d) return;
      if (d.t === 'take') {
        this.notes.delete(d.id);
        const pl = this.players.get(d.by);
        if (pl) pl.notes = d.n;
        if (d.by === this.you && this.mode === 'player') {
          this.showPaper(d.text || '…');
          this.audio.paper();
          if (this.notesEl) {
            this.notesEl.classList.remove('bump');
            void this.notesEl.offsetWidth;
            this.notesEl.classList.add('bump');
          }
        } else if (pl) {
          this.addFeed(`<span style="color:${esc(pl.color)}">${esc(pl.name)}</span> hat einen Zettel gefunden (${d.n})`);
        }
      } else if (d.t === 'spawn') {
        this.notes.set(d.id, { id: d.id, x: d.x, y: d.y });
      }
    }

    handleCaught(d) {
      if (!this.init || !d) return;
      const pl = this.players.get(d.pid);
      if (pl) pl.notes = d.n;
      if (d.pid === this.you && this.mode === 'player') {
        const now = performance.now();
        this.stunUntilLocal = now + STUN_MS;
        this.jumpscareUntil = now + JUMPSCARE_MS;
        this.lostNote = !!d.lost;
        this.audio.jumpscare();
        this.stage && this.stage.classList.add('br-shake');
        setTimeout(() => this.stage && this.stage.classList.remove('br-shake'), 700);
      } else {
        let gain = 0.35;
        let pan = 0;
        if (this.mode === 'player' && this.me) {
          const dx = d.x - this.me.x;
          const dy = d.y - this.me.y;
          const dist = Math.hypot(dx, dy) || 1;
          gain = clamp(0.75 * (1 - dist / 38), 0.08, 0.75);
          pan = this.panFor(dx, dy);
        }
        this.audio.scream(gain, pan);
        if (pl) this.addFeed(`<span style="color:${esc(pl.color)}">${esc(pl.name)}</span> wurde erwischt!${d.lost ? ' (−1 Zettel)' : ''}`, 'bad');
      }
    }

    handleJoin(d) {
      if (!this.init || !d || !d.p) return;
      if (!this.players.has(d.p.id)) {
        this.players.set(d.p.id, Object.assign({}, d.p, { flags: d.p.f || 0 }));
        this.addFeed(`<span style="color:${esc(d.p.color)}">${esc(d.p.name)}</span> ist in den Backrooms aufgetaucht`);
      }
    }

    handleCorrect(d) {
      if (this.mode !== 'player' || !this.me || !d) return;
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
        this.me.x = d.x;
        this.me.y = d.y;
      }
      if (Number.isFinite(d.a)) this.me.a = d.a;
    }

    // Das Monster wird eine Stufe wütender: Schrei für alle, roter Blitz und Hinweis im Feed
    handleRage(d) {
      if (!this.init || !d) return;
      if (typeof d.r === 'number') this.rage = d.r;
      this.audio.rage(d.lvl || 1);
      this.flash('rgba(150, 0, 18, 0.55)');
      this.addFeed(`😈 Das Monster wird wütender! <b>Stufe ${d.lvl} von 5</b>`, 'bad');
      if (this.rageEl) {
        this.rageEl.classList.remove('up');
        void this.rageEl.offsetWidth;
        this.rageEl.classList.add('up');
      }
    }

    handleAwake() {
      this.phase = 'running';
      this.awakeUntil = performance.now() + 2200;
      this.audio.growl(0.9, 0, 0.8);
      this.flash('rgba(120,0,10,0.9)');
    }

    handleEnd(d) {
      this.ended = true;
      this.phase = 'ended';
      this.endReason = (d && d.reason) || 'time';
      if (this.view && document.pointerLockElement === this.view) {
        try {
          document.exitPointerLock();
        } catch (e) {
          /* egal */
        }
      }
    }

    interp(kind, id, rt) {
      const S = this.snaps;
      if (!S.length) return null;
      let j = -1;
      for (let k = S.length - 1; k >= 0; k--) {
        if (S[k].t <= rt) {
          j = k;
          break;
        }
      }
      if (j < 0) return S[0][kind].get(id) || null;
      const a = S[j][kind].get(id);
      if (j === S.length - 1) return a || null;
      const b = S[j + 1][kind].get(id);
      if (!a) return b || null;
      if (!b) return a;
      const t = (rt - S[j].t) / (S[j + 1].t - S[j].t || 1);
      return [a[0], lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerpAngle(a[3], b[3], t), b[4], b[5]];
    }

    updateInterp() {
      const rt = this.serverNow() - INTERP_MS;
      const ps = [];
      for (const p of this.players.values()) {
        const s = this.interp('p', p.id, rt);
        if (s) ps.push({ id: p.id, x: s[1], y: s[2], a: s[3], f: s[4], pl: p });
      }
      const ms = [];
      for (const m of this.monsters.values()) {
        const s = this.interp('m', m.id, rt);
        if (s) ms.push({ id: m.id, x: s[1], y: s[2], a: s[3], st: s[4] });
      }
      this.ipPlayers = ps;
      this.ipMonsters = ms;
    }

    // ---------------------------------------------------------------- Licht

    setupLights() {
      const MW = this.MW;
      const MH = this.MH;
      const rnd = mulberry32((this.init.seed ^ 0x9e3779b9) | 0);
      this.lightIdx = new Int16Array(MW * MH).fill(-1);
      this.lights = [];
      for (let y = 1; y < MH - 1; y++) {
        for (let x = 1; x < MW - 1; x++) {
          if (this.grid[y * MW + x] || x % 3 !== 1 || y % 3 !== 1) continue;
          const r = rnd();
          const kind = r < 0.08 ? 2 : r < 0.2 ? 1 : 0;
          this.lightIdx[y * MW + x] = this.lights.length;
          this.lights.push({ x, y, kind, phase: rnd() * 100, I: kind === 2 ? 0 : 1 });
        }
      }
      this.cellLight = new Float32Array(MW * MH);
      this.cellLight2 = new Float32Array(MW * MH);
      this.corner = new Float32Array((MW + 1) * (MH + 1));
      const R = 3;
      this.kernel = new Float32Array(49);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy);
          this.kernel[(dy + R) * 7 + dx + R] = Math.pow(Math.max(0, 1 - d / 3.4), 1.5) * 0.85;
        }
      }
      this.G = 1;
      this.dipUntil = 0;
      this.dipLevel = 1;
    }

    updateFlicker(dt, now, danger) {
      if (now < this.dipUntil) {
        this.G = this.dipLevel;
        return;
      }
      this.G = 0.97 + Math.random() * 0.03;
      const rate = 0.15 + danger * 2.4;
      if (Math.random() < rate * dt) {
        const deep = danger > 0.6 && Math.random() < 0.4;
        this.dipUntil = now + 40 + Math.random() * (deep ? 280 : 120);
        this.dipLevel = deep ? 0.08 : 0.5 + Math.random() * 0.25;
      }
    }

    updateLights(now) {
      const MW = this.MW;
      const MH = this.MH;
      const L = this.cellLight;
      const g = this.grid;
      const K = this.kernel;
      L.fill(0.1);
      for (const li of this.lights) {
        let I = 1;
        if (li.kind === 2) I = 0;
        else if (li.kind === 1) {
          const s = Math.sin(now * 0.013 + li.phase) + Math.sin(now * 0.031 + li.phase * 2.1);
          I = s > 1.15 ? 0.12 : s > 0.9 ? 0.6 : 1;
        }
        li.I = I;
        if (I <= 0) continue;
        for (let dy = -3; dy <= 3; dy++) {
          const yy = li.y + dy;
          if (yy < 0 || yy >= MH) continue;
          for (let dx = -3; dx <= 3; dx++) {
            const xx = li.x + dx;
            if (xx < 0 || xx >= MW) continue;
            L[yy * MW + xx] += I * K[(dy + 3) * 7 + dx + 3];
          }
        }
      }
      // Wände übernehmen das hellste Nachbarfeld
      const L2 = this.cellLight2;
      for (let y = 0; y < MH; y++) {
        for (let x = 0; x < MW; x++) {
          const i = y * MW + x;
          if (!g[i]) {
            L2[i] = L[i];
            continue;
          }
          let m = 0.05;
          if (x > 0 && !g[i - 1] && L[i - 1] > m) m = L[i - 1];
          if (x < MW - 1 && !g[i + 1] && L[i + 1] > m) m = L[i + 1];
          if (y > 0 && !g[i - MW] && L[i - MW] > m) m = L[i - MW];
          if (y < MH - 1 && !g[i + MW] && L[i + MW] > m) m = L[i + MW];
          L2[i] = m;
        }
      }
      const C = this.corner;
      const W1 = MW + 1;
      for (let y = 0; y <= MH; y++) {
        for (let x = 0; x <= MW; x++) {
          let s = 0;
          let n = 0;
          if (x > 0 && y > 0) {
            s += L2[(y - 1) * MW + x - 1];
            n++;
          }
          if (x < MW && y > 0) {
            s += L2[(y - 1) * MW + x];
            n++;
          }
          if (x > 0 && y < MH) {
            s += L2[y * MW + x - 1];
            n++;
          }
          if (x < MW && y < MH) {
            s += L2[y * MW + x];
            n++;
          }
          C[y * W1 + x] = n ? s / n : 0.1;
        }
      }
    }

    lightAt(x, y) {
      const MW = this.MW;
      const W1 = MW + 1;
      let x0 = Math.floor(x);
      let y0 = Math.floor(y);
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x0 > MW - 1) x0 = MW - 1;
      if (y0 > this.MH - 1) y0 = this.MH - 1;
      const fx = clamp(x - x0, 0, 1);
      const fy = clamp(y - y0, 0, 1);
      const C = this.corner;
      const i = y0 * W1 + x0;
      const t = C[i] + (C[i + 1] - C[i]) * fx;
      const b = C[i + W1] + (C[i + W1 + 1] - C[i + W1]) * fx;
      return t + (b - t) * fy;
    }

    // ---------------------------------------------------------------- Spieler-Modus

    setupPlayer() {
      this.mode = 'player';
      const me = this.players.get(this.you);
      this.me = { x: me.x, y: me.y, a: me.a };
      this.myColor = me.color;
      this.stamina = 1;
      this.exhausted = false;
      this.sprinting = false;
      this.keys = new Set();
      this.lookDX = 0;
      this.touchVec = null;
      this.touchSprint = false;
      this.joy = null;
      this.lookTouch = null;
      this.locked = false;
      this.bobPhase = 0;
      this.bobY = 0;
      this.stepT = 0;
      this.beatT = 0;
      this.growlT = 1;
      this.whisperT = 18 + Math.random() * 20;
      this.breathT = 0;
      this.stunUntilLocal = 0;
      this.jumpscareUntil = 0;
      this.lastSend = 0;
      this.sent = { x: NaN, y: NaN, a: NaN, s: false };
      this.danger = 0;
      this.dangerPan = 0;
      this.spriteList = [];
      this.hudCache = {};
      this.rankAt = 0;
      this.paperUntil = 0;

      const T = textures();
      this.root.innerHTML = `
        <div class="br-stage">
          <canvas class="br-view"></canvas>
          <div class="br-fx br-grain"></div>
          <div class="br-fx br-scan"></div>
          <div class="br-fx br-vignette"></div>
          <div class="br-fx br-danger"></div>
          <div class="br-fx br-static"></div>
          <div class="br-fx br-flash"></div>
          <canvas class="br-overlay"></canvas>
        </div>
        <div class="br-hud">
          <div class="br-timer"></div>
          <div class="br-notes"><span class="br-notes-icon"></span><span class="br-notes-count">0</span><span class="br-notes-label">Zettel</span></div>
          <div class="br-rage" title="Jeder gefundene Zettel macht das Monster wütender"><span class="br-rage-label">Monster-Wut</span><div class="br-rage-bar"><div class="br-rage-fill"></div></div></div>
          <div class="br-rank"></div>
          <div class="br-stamina"><div class="br-stamina-fill"></div></div>
          <div class="br-feed"></div>
          <div class="br-center"></div>
          <div class="br-stunned"></div>
          <div class="br-paper"><div class="br-paper-text"></div></div>
          <div class="br-lockhint">Maus bewegen zum Umsehen · Klick ins Bild fängt die Maus ein (ESC gibt sie frei)</div>
          <button class="br-sprint-btn" type="button">Sprint</button>
        </div>`;
      const q = (s) => this.root.querySelector(s);
      this.stage = q('.br-stage');
      this.view = q('.br-view');
      this.overlay = q('.br-overlay');
      this.dangerEl = q('.br-danger');
      this.staticEl = q('.br-static');
      this.flashEl = q('.br-flash');
      this.timerEl = q('.br-timer');
      this.notesEl = q('.br-notes');
      this.notesCountEl = q('.br-notes-count');
      this.rageEl = q('.br-rage');
      this.rageFill = q('.br-rage-fill');
      this.rankEl = q('.br-rank');
      this.staminaEl = q('.br-stamina');
      this.staminaFill = q('.br-stamina-fill');
      this.feedEl = q('.br-feed');
      this.centerEl = q('.br-center');
      this.stunEl = q('.br-stunned');
      this.paperEl = q('.br-paper');
      this.paperTextEl = q('.br-paper-text');
      this.lockHint = q('.br-lockhint');
      q('.br-grain').style.backgroundImage = `url(${T.grain})`;
      this.staticEl.style.backgroundImage = `url(${T.staticNoise})`;

      this.setupRender();
      this.bindPlayerInput(q('.br-sprint-btn'));
      if (typeof ResizeObserver === 'function') {
        this.ro = new ResizeObserver(() => this.setupRender());
        this.ro.observe(this.root);
      }
    }

    setupRender() {
      const rect = this.stage.getBoundingClientRect();
      const w = Math.max(64, rect.width);
      const h = Math.max(64, rect.height);
      const RH = h < 420 ? 150 : 180;
      const RW = clamp(Math.round((RH * w) / h), 160, 480);
      if (RW !== this.RW || RH !== this.RH) {
        this.RW = RW;
        this.RH = RH;
        this.view.width = RW;
        this.view.height = RH;
        this.g = this.view.getContext('2d', { alpha: false });
        this.img = this.g.createImageData(RW, RH);
        this.buf = new Uint32Array(this.img.data.buffer);
        this.zbuf = new Float32Array(RW);
        this.wallTop = new Int16Array(RW);
        this.wallBot = new Int16Array(RW);
        this.planeLen = (0.42 * RW) / RH;
        this.proj = RW / 2 / this.planeLen;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.dpr = dpr;
      const ow = Math.round(w * dpr);
      const oh = Math.round(h * dpr);
      if (this.overlay.width !== ow || this.overlay.height !== oh) {
        this.overlay.width = ow;
        this.overlay.height = oh;
      }
      this.og = this.overlay.getContext('2d');
    }

    bindPlayerInput(sprintBtn) {
      const isTyping = (e) => {
        const t = e.target;
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      };
      const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
      this.onDom(window, 'keydown', (e) => {
        if (isTyping(e) || !GAME_KEYS.has(e.code)) return;
        this.keys.add(e.code);
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
        if (this.ctx.sound && this.ctx.sound.unlock) this.ctx.sound.unlock();
      });
      this.onDom(window, 'keyup', (e) => {
        this.keys.delete(e.code);
      });
      this.onDom(window, 'blur', () => {
        this.keys.clear();
        this.hoverX = null;
      });
      this.onDom(document, 'pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.view;
        if (this.locked) this.hoverX = null;
      });
      // Umsehen nur mit Mausbewegung, ohne Taste: Mit Pointer Lock unbegrenzt. Erlaubt der Browser
      // keinen Pointer Lock, folgt die Kamera der Maus über dem Bild und dreht am Rand von selbst weiter.
      this.onDom(document, 'mousemove', (e) => {
        if (this.locked) {
          this.lookDX += e.movementX || 0;
          return;
        }
        const r = this.view.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside || this.lastTouch > performance.now() - 800) {
          this.hoverX = null;
          return;
        }
        this.lookDX += e.movementX || 0;
        this.hoverX = (e.clientX - r.left) / r.width;
      });
      this.onDom(document, 'mouseleave', () => {
        this.hoverX = null;
      });
      this.onDom(this.stage, 'click', (e) => {
        if (this.ctx.sound && this.ctx.sound.unlock) this.ctx.sound.unlock();
        if (this.locked || this.ended || e.pointerType === 'touch' || this.lastTouch > performance.now() - 800) return;
        try {
          const r = this.view.requestPointerLock && this.view.requestPointerLock();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch (err) {
          /* Pointer Lock nicht verfügbar – Ziehen mit gedrückter Maus geht trotzdem */
        }
      });
      this.onDom(this.stage, 'pointerdown', (e) => {
        if (e.pointerType === 'touch') {
          this.lastTouch = performance.now();
          const r = this.stage.getBoundingClientRect();
          if (e.clientX - r.left < r.width / 2) {
            if (!this.joy) this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
          } else if (!this.lookTouch) {
            this.lookTouch = { id: e.pointerId, x: e.clientX };
          }
          if (this.ctx.sound && this.ctx.sound.unlock) this.ctx.sound.unlock();
        }
      });
      this.onDom(window, 'pointermove', (e) => {
        if (this.joy && e.pointerId === this.joy.id) {
          let dx = (e.clientX - this.joy.x0) / 55;
          let dy = (e.clientY - this.joy.y0) / 55;
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            dx /= len;
            dy /= len;
          }
          this.touchVec = { x: dx, y: dy };
        } else if (this.lookTouch && e.pointerId === this.lookTouch.id) {
          this.lookDX += (e.clientX - this.lookTouch.x) * 1.8;
          this.lookTouch.x = e.clientX;
        }
      });
      const endPointer = (e) => {
        if (this.joy && e.pointerId === this.joy.id) {
          this.joy = null;
          this.touchVec = null;
        }
        if (this.lookTouch && e.pointerId === this.lookTouch.id) this.lookTouch = null;
      };
      this.onDom(window, 'pointerup', endPointer);
      this.onDom(window, 'pointercancel', endPointer);
      const sprintOn = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touchSprint = true;
      };
      const sprintOff = () => {
        this.touchSprint = false;
      };
      this.onDom(sprintBtn, 'pointerdown', sprintOn);
      this.onDom(sprintBtn, 'pointerup', sprintOff);
      this.onDom(sprintBtn, 'pointerleave', sprintOff);
      this.onDom(sprintBtn, 'pointercancel', sprintOff);
    }

    isStunned(now) {
      const mine = this.players.get(this.you);
      return now < this.stunUntilLocal || !!(mine && mine.flags & 1);
    }

    moveCollide(dx, dy) {
      const me = this.me;
      const nx = me.x + dx;
      if (!this.blocked(nx, me.y, RADIUS)) me.x = nx;
      const ny = me.y + dy;
      if (!this.blocked(me.x, ny, RADIUS)) me.y = ny;
    }

    wallAt(x, y) {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= this.MW || cy >= this.MH) return true;
      return this.grid[cy * this.MW + cx] === 1;
    }

    blocked(x, y, r) {
      return this.wallAt(x - r, y - r) || this.wallAt(x + r, y - r) || this.wallAt(x - r, y + r) || this.wallAt(x + r, y + r);
    }

    updateLocal(dt, now) {
      const k = this.keys;
      const running = this.phase === 'running' && !this.ended;
      const stunned = this.isStunned(now);
      let turn = 0;
      if (k.has('ArrowLeft') || k.has('KeyQ')) turn -= 1;
      if (k.has('ArrowRight') || k.has('KeyE')) turn += 1;
      if (!this.locked && this.hoverX != null) {
        if (this.hoverX < EDGE_ZONE) turn -= ((1 - this.hoverX / EDGE_ZONE) * EDGE_TURN) / KEY_TURN;
        else if (this.hoverX > 1 - EDGE_ZONE) turn += ((1 - (1 - this.hoverX) / EDGE_ZONE) * EDGE_TURN) / KEY_TURN;
      }
      if (!this.ended) this.me.a = wrapAngle(this.me.a + turn * KEY_TURN * dt + this.lookDX * MOUSE_SENS);
      this.lookDX = 0;

      let f = 0;
      let s = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD')) s += 1;
      if (k.has('KeyA')) s -= 1;
      if (this.touchVec) {
        f -= this.touchVec.y;
        s += this.touchVec.x;
      }
      const len = Math.hypot(f, s);
      if (len > 1) {
        f /= len;
        s /= len;
      }
      const moving = len > 0.08 && running && !stunned;
      const wantSprint = (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint) && moving && f > -0.2;
      if (wantSprint && !this.exhausted && this.stamina > 0) {
        this.sprinting = true;
        this.stamina -= STAMINA_DRAIN * dt;
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.exhausted = true;
          if (now > this.breathT) {
            this.audio.breath(0.55);
            this.breathT = now + 9000;
          }
        }
      } else {
        this.sprinting = false;
        this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt);
        if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
      }
      if (moving) {
        const sp = (this.sprinting ? SPRINT : WALK) * dt;
        const ca = Math.cos(this.me.a);
        const sa = Math.sin(this.me.a);
        this.moveCollide((ca * f - sa * s) * sp, (sa * f + ca * s) * sp);
        this.bobPhase += sp * 2.1;
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.audio.step(this.sprinting ? 0.5 : 0.32, 0.9 + Math.random() * 0.2);
          this.stepT = this.sprinting ? 0.29 : 0.42;
        }
      } else {
        this.sprinting = false;
        this.stepT = 0.08;
      }
      const amp = moving ? (this.sprinting ? 2.2 : 1.3) : 0;
      this.bobY = Math.sin(this.bobPhase * 3.2) * amp * (this.RH / 180);
    }

    sendInput(now) {
      if (!this.socket || this.ended) return;
      const me = this.me;
      const sent = this.sent;
      const changed =
        !(Math.abs(me.x - sent.x) < 0.004) || !(Math.abs(me.y - sent.y) < 0.004) || !(Math.abs(me.a - sent.a) < 0.01) || this.sprinting !== sent.s;
      if ((changed && now - this.lastSend >= SEND_MS) || now - this.lastSend >= KEEPALIVE_MS) {
        this.socket.emit('br:pos', {
          x: Math.round(me.x * 1000) / 1000,
          y: Math.round(me.y * 1000) / 1000,
          a: Math.round(me.a * 1000) / 1000,
          s: this.sprinting ? 1 : 0,
        });
        this.sent = { x: me.x, y: me.y, a: me.a, s: this.sprinting };
        this.lastSend = now;
      }
    }

    panFor(dx, dy) {
      if (!this.me) return 0;
      const a = this.me.a;
      const right = dx * -Math.sin(a) + dy * Math.cos(a);
      const dist = Math.hypot(dx, dy) || 1;
      return clamp(right / dist, -1, 1);
    }

    computeDanger() {
      let best = Infinity;
      let bx = 0;
      let by = 0;
      for (const m of this.ipMonsters) {
        if (m.st === 0) continue;
        const dx = m.x - this.me.x;
        const dy = m.y - this.me.y;
        const d = Math.hypot(dx, dy);
        if (d < best) {
          best = d;
          bx = dx;
          by = dy;
        }
      }
      const target = best === Infinity ? 0 : clamp(1 - (best - 1.5) / 8.5, 0, 1);
      this.danger += (target - this.danger) * 0.15;
      this.dangerPan = this.panFor(bx, by);
    }

    framePlayer(now, dt) {
      this.updateInterp();
      this.updateLocal(dt, now);
      this.sendInput(now);
      this.computeDanger();
      this.updateFlicker(dt, now, this.danger);
      this.updateLights(now);
      this.renderView(now);
      this.g.putImageData(this.img, 0, 0);
      this.renderOverlay(now);
      this.updateHud(now);
      this.updateAudioPlayer(dt, now);
    }

    renderView(now) {
      const RW = this.RW;
      const RH = this.RH;
      const buf = this.buf;
      const zb = this.zbuf;
      const wallTop = this.wallTop;
      const wallBot = this.wallBot;
      const grid = this.grid;
      const MW = this.MW;
      const MH = this.MH;
      const T = textures();
      const wallT = T.wall;
      const floorT = T.floor;
      const ceilT = T.ceil;
      const panelT = T.panel;
      const panelOffT = T.panelOff;
      const vshade = T.vshade;
      const C = this.corner;
      const W1 = MW + 1;
      const lightIdx = this.lightIdx;
      const lights = this.lights;
      const G = this.G;
      const px = this.me.x;
      const py = this.me.y;
      const dirX = Math.cos(this.me.a);
      const dirY = Math.sin(this.me.a);
      const plX = -dirY * this.planeLen;
      const plY = dirX * this.planeLen;
      const proj = this.proj;
      const horizon = Math.round(RH / 2 + this.bobY);
      const FOGPIX = pack(FOG_R, FOG_G, FOG_B, 255);

      // ---- Wände
      for (let x = 0; x < RW; x++) {
        const camX = (2 * x) / RW - 1;
        const rdx = dirX + plX * camX;
        const rdy = dirY + plY * camX;
        let mx = Math.floor(px);
        let my = Math.floor(py);
        const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
        const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
        let sx;
        let sy;
        let sdx;
        let sdy;
        if (rdx < 0) {
          sx = -1;
          sdx = (px - mx) * ddx;
        } else {
          sx = 1;
          sdx = (mx + 1 - px) * ddx;
        }
        if (rdy < 0) {
          sy = -1;
          sdy = (py - my) * ddy;
        } else {
          sy = 1;
          sdy = (my + 1 - py) * ddy;
        }
        let side = 0;
        let hit = false;
        for (let s = 0; s < 100; s++) {
          if (sdx < sdy) {
            sdx += ddx;
            mx += sx;
            side = 0;
          } else {
            sdy += ddy;
            my += sy;
            side = 1;
          }
          if (mx < 0 || my < 0 || mx >= MW || my >= MH) break;
          if (grid[my * MW + mx] === 1) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          zb[x] = 1e9;
          wallTop[x] = 1;
          wallBot[x] = 0;
          continue;
        }
        let perp = side === 0 ? sdx - ddx : sdy - ddy;
        if (perp < 0.02) perp = 0.02;
        zb[x] = perp;
        const lineH = proj / perp;
        const top = horizon - lineH * 0.5;
        let y0 = Math.ceil(top);
        let y1 = Math.floor(horizon + lineH * 0.5);
        if (y0 < 0) y0 = 0;
        if (y1 > RH - 1) y1 = RH - 1;
        wallTop[x] = y0;
        wallBot[x] = y1;
        let wallX = side === 0 ? py + perp * rdy : px + perp * rdx;
        wallX -= Math.floor(wallX);
        let tx = (wallX * 64) | 0;
        if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) tx = 63 - tx;
        let lx = px + perp * rdx;
        let ly = py + perp * rdy;
        if (side === 0) lx -= sx * 0.02;
        else ly -= sy * 0.02;
        const L = this.lightAt(lx, ly) * G * (side === 1 ? 0.8 : 1);
        const fog = fogOf(perp);
        const inv = 1 - fog;
        const fr = FOG_R * fog;
        const fg = FOG_G * fog;
        const fb = FOG_B * fog;
        const step = 64 / lineH;
        let tp = (y0 - top) * step;
        let o = y0 * RW + x;
        for (let y = y0; y <= y1; y++, o += RW) {
          const ty = tp & 63;
          tp += step;
          const c = wallT[(ty << 6) | tx];
          const k = L * vshade[ty] * inv;
          const r = (c & 255) * k + fr;
          const gg = ((c >> 8) & 255) * k + fg;
          const b = ((c >> 16) & 255) * k + fb;
          buf[o] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
        }
      }

      // ---- Boden und Decke
      const rx0 = dirX - plX;
      const ry0 = dirY - plY;
      const rsx = (2 * plX) / RW;
      const rsy = (2 * plY) / RW;
      for (let y = 0; y < RH; y++) {
        const isFloor = y > horizon;
        const p = isFloor ? y - horizon : horizon - y;
        const o0 = y * RW;
        if (p <= 0) {
          for (let x = 0; x < RW; x++) if (y < wallTop[x] || y > wallBot[x]) buf[o0 + x] = FOGPIX;
          continue;
        }
        const rowDist = (0.5 * proj) / p;
        const fog = fogOf(rowDist);
        const inv = 1 - fog;
        const fr = FOG_R * fog;
        const fg = FOG_G * fog;
        const fb = FOG_B * fog;
        const pfog = fog * 0.55;
        const pinv = 1 - pfog;
        const stepX = rowDist * rsx;
        const stepY = rowDist * rsy;
        let wx = px + rowDist * rx0;
        let wy = py + rowDist * ry0;
        for (let x = 0; x < RW; x++, wx += stepX, wy += stepY) {
          if (y >= wallTop[x] && y <= wallBot[x]) continue;
          const o = o0 + x;
          const cx = Math.floor(wx);
          const cy = Math.floor(wy);
          if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) {
            buf[o] = FOGPIX;
            continue;
          }
          const fx = wx - cx;
          const fy = wy - cy;
          const ti = (((fy * 64) | 0) << 6) | ((fx * 64) | 0);
          let c;
          if (isFloor) {
            c = floorT[ti];
          } else {
            const li = lightIdx[cy * MW + cx];
            if (li >= 0) {
              const I = lights[li].I * G;
              if (I > 0.05) {
                c = panelT[ti];
                const kk = (0.55 + 0.6 * I) * pinv;
                const r = (c & 255) * kk + FOG_R * pfog;
                const gg = ((c >> 8) & 255) * kk + FOG_G * pfog;
                const b = ((c >> 16) & 255) * kk + FOG_B * pfog;
                buf[o] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
                continue;
              }
              c = panelOffT[ti];
            } else {
              c = ceilT[ti];
            }
          }
          const ci = cy * W1 + cx;
          const l0 = C[ci] + (C[ci + 1] - C[ci]) * fx;
          const l1 = C[ci + W1] + (C[ci + W1 + 1] - C[ci + W1]) * fx;
          const k = (l0 + (l1 - l0) * fy) * G * inv;
          const r = (c & 255) * k + fr;
          const gg = ((c >> 8) & 255) * k + fg;
          const b = ((c >> 16) & 255) * k + fb;
          buf[o] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
        }
      }

      this.renderSprites(now, px, py, dirX, dirY, plX, plY, horizon);
    }

    renderSprites(now, px, py, dirX, dirY, plX, plY, horizon) {
      const T = textures();
      const RW = this.RW;
      const RH = this.RH;
      const buf = this.buf;
      const zb = this.zbuf;
      const proj = this.proj;
      const G = this.G;
      const list = this.spriteList;
      list.length = 0;
      for (const n of this.notes.values()) {
        const bob = Math.sin(now * 0.003 + n.id * 1.7) * 0.035;
        list.push({ kind: 'note', x: n.x, y: n.y, t: T.note, wh: 0.24, zb: 0.1 + bob, minL: 0.85, fogMul: 0.55, jx: 0 });
      }
      for (const p of this.ipPlayers) {
        if (p.id === this.you) continue;
        const stunned = p.f & 1;
        list.push({
          kind: 'player',
          x: p.x,
          y: p.y,
          t: playerTex(p.pl.color),
          wh: 0.8,
          zb: stunned ? -0.05 : 0,
          minL: 0.35,
          fogMul: 1,
          jx: stunned ? (Math.random() - 0.5) * 3 : 0,
          name: p.pl.name,
          color: p.pl.color,
          stunned,
        });
      }
      for (const m of this.ipMonsters) {
        list.push({
          kind: 'monster',
          x: m.x,
          y: m.y,
          t: T.monster,
          wh: 0.97,
          zb: 0,
          minL: 0,
          fogMul: 1,
          jx: Math.random() < 0.08 ? (Math.random() - 0.5) * 6 : 0,
        });
      }
      for (const s of list) {
        const dx = s.x - px;
        const dy = s.y - py;
        s.d2 = dx * dx + dy * dy;
        s.visible = false;
      }
      list.sort((a, b) => b.d2 - a.d2);
      const invDet = 1 / (plX * dirY - dirX * plY);
      for (const s of list) {
        const sx = s.x - px;
        const sy = s.y - py;
        const tX = invDet * (dirY * sx - dirX * sy);
        const tY = invDet * (-plY * sx + plX * sy);
        if (tY < 0.15) continue;
        const tw = s.t.w;
        const th = s.t.h;
        const tex = s.t.tex;
        const scrX = (RW / 2) * (1 + tX / tY) + s.jx;
        const hPix = (proj * s.wh) / tY;
        const wPix = (hPix * tw) / th;
        const yTop = horizon + ((0.5 - s.zb - s.wh) * proj) / tY;
        const xL = scrX - wPix / 2;
        const xs = Math.max(0, Math.ceil(xL));
        const xe = Math.min(RW - 1, Math.floor(xL + wPix));
        const ys = Math.max(0, Math.ceil(yTop));
        const ye = Math.min(RH - 1, Math.floor(yTop + hPix));
        s.tY = tY;
        s.scrX = scrX;
        s.yTop = yTop;
        if (xs > xe || ys > ye) continue;
        const fog = fogOf(tY) * s.fogMul;
        const inv = 1 - fog;
        const L = Math.max(s.minL, this.lightAt(s.x, s.y) * G);
        const k = L * inv;
        const fr = FOG_R * fog;
        const fg = FOG_G * fog;
        const fb = FOG_B * fog;
        const ef = fogOf(tY) * 0.22;
        const einv = 1 - ef;
        const ux = tw / wPix;
        const uy = th / hPix;
        for (let x = xs; x <= xe; x++) {
          if (tY >= zb[x]) continue;
          const txi = ((x - xL) * ux) | 0;
          if (txi < 0 || txi >= tw) continue;
          s.visible = true;
          let o = ys * RW + x;
          let ty = (ys - yTop) * uy;
          for (let y = ys; y <= ye; y++, o += RW, ty += uy) {
            const tyi = ty | 0;
            if (tyi >= th) break;
            const c = tex[tyi * tw + txi];
            const al = c >>> 24;
            if (al < 200) continue;
            let r = c & 255;
            let gg = (c >> 8) & 255;
            let b = (c >> 16) & 255;
            if (al === 254) {
              r = r * einv + FOG_R * ef;
              gg = gg * einv + FOG_G * ef;
              b = b * einv + FOG_B * ef;
            } else {
              r = r * k + fr;
              gg = gg * k + fg;
              b = b * k + fb;
            }
            buf[o] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
          }
        }
      }
    }

    renderOverlay(now) {
      const og = this.og;
      const W = this.overlay.width;
      const H = this.overlay.height;
      og.clearRect(0, 0, W, H);
      const kx = W / this.RW;
      const ky = H / this.RH;
      og.textAlign = 'center';
      og.textBaseline = 'bottom';
      for (const s of this.spriteList) {
        if (s.kind !== 'player' || !s.visible || s.tY > 12) continue;
        const size = clamp(17 - s.tY, 10, 15) * this.dpr;
        og.font = `600 ${size}px Rubik, system-ui, sans-serif`;
        const x = s.scrX * kx;
        const y = s.yTop * ky - 4 * this.dpr;
        og.fillStyle = 'rgba(0,0,0,0.7)';
        og.fillText(s.name, x + this.dpr, y + this.dpr);
        og.fillStyle = s.color || '#efe6d8';
        og.fillText(s.name + (s.stunned ? ' 💫' : ''), x, y);
      }
      if (now < this.jumpscareUntil) this.drawJumpscare(og, W, H, now);
    }

    drawJumpscare(g, W, H, now) {
      const t = 1 - (this.jumpscareUntil - now) / JUMPSCARE_MS;
      const dpr = this.dpr;
      const shake = (1 - t) * 46 * dpr;
      const ox = (Math.random() - 0.5) * shake;
      const oy = (Math.random() - 0.5) * shake;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.93)';
      g.fillRect(0, 0, W, H);
      g.translate(W / 2 + ox, H / 2 + oy);
      const s = Math.min(W, H) * (0.95 + t * 0.4);
      g.fillStyle = '#050405';
      g.beginPath();
      g.ellipse(0, 0, s * 0.42, s * 0.56, 0, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = '#ffffff';
      g.shadowBlur = 34 * dpr;
      g.fillStyle = '#f6f6f6';
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.13, s * 0.08, s * 0.052, -0.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(s * 0.15, -s * 0.14, s * 0.068, s * 0.046, 0.25, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(-s * 0.14 + (Math.random() - 0.5) * 3, -s * 0.13, s * 0.012, 0, Math.PI * 2);
      g.arc(s * 0.155 + (Math.random() - 0.5) * 3, -s * 0.14, s * 0.011, 0, Math.PI * 2);
      g.fill();
      // Maul
      g.fillStyle = '#140000';
      g.beginPath();
      g.moveTo(-s * 0.3, s * 0.1);
      g.quadraticCurveTo(0, s * 0.18, s * 0.3, s * 0.08);
      g.quadraticCurveTo(s * 0.12, s * 0.46, 0, s * 0.47);
      g.quadraticCurveTo(-s * 0.14, s * 0.46, -s * 0.3, s * 0.1);
      g.fill();
      g.fillStyle = '#e8e2d0';
      const teeth = 11;
      for (let i = 0; i < teeth; i++) {
        const u = i / (teeth - 1);
        const x = lerp(-s * 0.27, s * 0.27, u);
        const yTopT = s * 0.1 + Math.sin(u * Math.PI) * s * 0.075;
        g.beginPath();
        g.moveTo(x - s * 0.022, yTopT);
        g.lineTo(x + s * 0.022, yTopT);
        g.lineTo(x + (Math.random() - 0.5) * s * 0.01, yTopT + s * (0.07 + Math.random() * 0.05));
        g.fill();
        const yb = s * 0.4 - Math.abs(u - 0.5) * s * 0.3;
        g.beginPath();
        g.moveTo(x * 0.8 - s * 0.018, yb);
        g.lineTo(x * 0.8 + s * 0.018, yb);
        g.lineTo(x * 0.8, yb - s * (0.05 + Math.random() * 0.04));
        g.fill();
      }
      g.restore();
      g.fillStyle = `rgba(170,0,0,${0.4 * (1 - t)})`;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(255,0,0,0.18)';
        g.fillRect(0, Math.random() * H, W, (2 + Math.random() * 14) * dpr);
      }
    }

    showPaper(text) {
      this.paperText = String(text);
      this.paperStart = performance.now();
      this.paperUntil = this.paperStart + 4300;
      this.paperShown = -1;
    }

    addFeed(html, cls) {
      const el = this.feedEl || this.specFeedEl;
      if (!el) return;
      const item = document.createElement('div');
      item.className = 'br-feed-item' + (cls ? ' ' + cls : '');
      item.innerHTML = html;
      el.appendChild(item);
      while (el.children.length > 5) el.removeChild(el.firstChild);
      setTimeout(() => item.remove(), 6000);
    }

    flash(color) {
      const el = this.flashEl || this.specFlashEl;
      if (!el) return;
      el.style.transition = 'none';
      el.style.background = color;
      el.style.opacity = '0.85';
      void el.offsetWidth;
      el.style.transition = 'opacity 0.6s ease-out';
      el.style.opacity = '0';
    }

    setText(key, el, value) {
      if (this.hudCache[key] === value) return;
      this.hudCache[key] = value;
      el.textContent = value;
    }

    setHtml(key, el, value) {
      if (this.hudCache[key] === value) return;
      this.hudCache[key] = value;
      el.innerHTML = value;
    }

    centerHtml(now) {
      const sNow = this.serverNow();
      if (this.ended) {
        const msg =
          this.endReason === 'notes' ? 'Alle Zettel gefunden!' : this.endReason === 'forced' ? 'Die Backrooms schließen sich …' : 'Die Zeit ist um!';
        const mine = this.players.get(this.you);
        const n = mine ? mine.notes : 0;
        return `<div class="br-end-title">${msg}</div><div class="br-end-sub">Du hast ${n} Zettel gesammelt.</div>`;
      }
      if (this.phase === 'countdown' || sNow < this.countdownEnd) {
        const sec = Math.max(1, Math.ceil((this.countdownEnd - sNow) / 1000));
        return (
          `<div class="br-cd-title">Es erwacht in <span>${sec}</span></div>` +
          '<div class="br-cd-rules">Sammle Zettel und lauf vor dem Monster weg. Jeder Zettel macht es wütender!<br>' +
          'Jeder Zettel: <b>+25 Punkte</b> fürs Team · Wer die meisten findet: <b>+50 pro Zettel</b> extra</div>' +
          '<div class="br-cd-keys"><kbd>W A S D</kbd> laufen · <kbd>Maus</kbd> umsehen · <kbd>Shift</kbd> sprinten (macht Lärm!)</div>'
        );
      }
      if (now < this.awakeUntil) return '<div class="br-awake">ES IST ERWACHT</div>';
      return '';
    }

    updateHud(now) {
      const sNow = this.serverNow();
      const countdown = this.phase === 'countdown' || sNow < this.countdownEnd;
      const rem = countdown ? this.durationSec * 1000 : this.endAt - sNow;
      this.setText('timer', this.timerEl, fmtTime(rem));
      const urgent = !countdown && !this.ended && rem <= 30000;
      if (this.hudCache.urgent !== urgent) {
        this.hudCache.urgent = urgent;
        this.timerEl.classList.toggle('urgent', urgent);
      }
      const mine = this.players.get(this.you);
      this.setText('notes', this.notesCountEl, String(mine ? mine.notes : 0));
      const rage = Math.round((this.rage || 0) * 100) / 100;
      if (this.hudCache.rage !== rage) {
        this.hudCache.rage = rage;
        this.rageFill.style.transform = `scaleX(${rage})`;
      }
      this.staminaFill.style.transform = `scaleX(${this.stamina.toFixed(3)})`;
      if (this.hudCache.exh !== this.exhausted) {
        this.hudCache.exh = this.exhausted;
        this.staminaEl.classList.toggle('exhausted', this.exhausted);
      }
      this.setHtml('center', this.centerEl, this.centerHtml(now));

      // Rauschen und Text erst nach dem Jumpscare, damit das Gesicht sichtbar bleibt
      const stunned = this.isStunned(now) && !this.ended && now >= this.jumpscareUntil;
      if (this.hudCache.stunned !== stunned) {
        this.hudCache.stunned = stunned;
        this.staticEl.classList.toggle('on', stunned);
        this.stunEl.classList.toggle('on', stunned);
      }
      if (stunned) {
        const left = Math.max(0, Math.ceil(((this.stunUntilLocal || now) - now) / 1000));
        this.setHtml(
          'stunText',
          this.stunEl,
          `<div class="br-stun-title">Erwischt!</div><div class="br-stun-sub">Gelähmt … ${left || ''}</div>` +
            (this.lostNote ? '<div class="br-stun-lost">Du hast einen Zettel verloren.</div>' : ''),
        );
      }

      const pulse = 0.78 + 0.22 * Math.sin(now * 0.008 * (1 + this.danger * 1.5));
      this.dangerEl.style.opacity = (this.danger * 0.9 * pulse).toFixed(3);

      const showHint = !this.locked && !this.ended && !this.isTouch();
      if (this.hudCache.hint !== showHint) {
        this.hudCache.hint = showHint;
        this.lockHint.classList.toggle('on', showHint);
      }

      if (now - this.rankAt > 400) {
        this.rankAt = now;
        const top = [...this.players.values()].sort((a, b) => b.notes - a.notes || a.name.localeCompare(b.name)).slice(0, 3);
        const rows = top
          .map(
            (p, i) =>
              `<div class="br-rank-row${p.id === this.you ? ' me' : ''}"><span class="br-rank-pos">${i + 1}.</span>` +
              `<span class="br-rank-name" style="color:${esc(p.color)}">${esc(p.name)}</span><b>${p.notes}</b></div>`,
          )
          .join('');
        this.setHtml('rank', this.rankEl, `<div class="br-rank-title">Zettel-Rangliste</div>${rows}`);
      }

      if (now < this.paperUntil) {
        const chars = Math.min(this.paperText.length, Math.floor((now - this.paperStart) / 28));
        if (chars !== this.paperShown) {
          this.paperShown = chars;
          this.paperTextEl.textContent = this.paperText.slice(0, chars);
        }
        if (!this.paperEl.classList.contains('show')) this.paperEl.classList.add('show');
      } else if (this.paperEl.classList.contains('show')) {
        this.paperEl.classList.remove('show');
      }
    }

    isTouch() {
      return this.lastTouch > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    }

    updateAudioPlayer(dt, now) {
      const A = this.audio;
      if (!A.ensure()) return;
      const stunned = this.isStunned(now) && !this.ended && now >= this.jumpscareUntil;
      A.loop('hum', 'br_hum', () => A.synthHum(), this.ended ? 0 : 0.22 * this.G);
      A.loop('static', 'br_static', () => A.synthStatic(), stunned ? 0.32 : 0);
      if (this.ended) return;
      if (this.danger > 0.05) {
        this.beatT -= dt;
        if (this.beatT <= 0) {
          A.beat(0.25 + this.danger * 0.75);
          this.beatT = 1.15 - 0.75 * this.danger;
        }
      } else {
        this.beatT = 0.3;
      }
      if (this.danger > 0.4) {
        this.growlT -= dt;
        if (this.growlT <= 0) {
          A.growl(0.2 + (0.7 * (this.danger - 0.4)) / 0.6, this.dangerPan, 1);
          this.growlT = 2.2 + Math.random() * 2;
        }
      }
      this.whisperT -= dt;
      if (this.whisperT <= 0) {
        A.whisper(0.22, Math.random() * 2 - 1);
        this.whisperT = 25 + Math.random() * 30;
      }
    }

    // ---------------------------------------------------------------- Zuschauer-Modus

    setupSpectator() {
      this.mode = 'spectator';
      this.hudCache = {};
      this.sideAt = 0;
      this.root.innerHTML = `
        <div class="br-spec">
          <div class="br-spec-mapwrap">
            <canvas class="br-spec-map"></canvas>
            <div class="br-spec-center"></div>
            <div class="br-fx br-flash"></div>
          </div>
          <aside class="br-spec-side">
            <div class="br-spec-title">Backrooms · Level 0</div>
            <div class="br-spec-timer">–:––</div>
            <div class="br-spec-stats"></div>
            <div class="br-spec-rank-title">Zettel-Rangliste</div>
            <ol class="br-spec-rank"></ol>
            <div class="br-spec-legend">
              <span><i class="lg-note"></i>Zettel</span><span><i class="lg-monster"></i>Monster</span><span><i class="lg-player"></i>Spieler</span>
            </div>
            <div class="br-feed br-spec-feed"></div>
          </aside>
        </div>`;
      const q = (s) => this.root.querySelector(s);
      this.mapWrap = q('.br-spec-mapwrap');
      this.mapCv = q('.br-spec-map');
      this.specCenter = q('.br-spec-center');
      this.specFlashEl = q('.br-flash');
      this.specTimer = q('.br-spec-timer');
      this.specStats = q('.br-spec-stats');
      this.specRank = q('.br-spec-rank');
      this.specFeedEl = q('.br-spec-feed');
      this.layoutSpectator();
      if (typeof ResizeObserver === 'function') {
        this.ro = new ResizeObserver(() => this.layoutSpectator());
        this.ro.observe(this.mapWrap);
      }
      this.onDom(this.root, 'pointerdown', () => {
        if (this.ctx.sound && this.ctx.sound.unlock) this.ctx.sound.unlock();
      });
    }

    layoutSpectator() {
      const r = this.mapWrap.getBoundingClientRect();
      const cs = Math.max(4, Math.floor(Math.min(r.width, r.height) / Math.max(this.MW, this.MH)));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cs === this.cs && dpr === this.sdpr && this.bg) return;
      this.cs = cs;
      this.sdpr = dpr;
      const W = this.MW * cs;
      const H = this.MH * cs;
      this.mapCv.width = Math.round(W * dpr);
      this.mapCv.height = Math.round(H * dpr);
      this.mapCv.style.width = W + 'px';
      this.mapCv.style.height = H + 'px';
      this.sg = this.mapCv.getContext('2d');
      // statischer Hintergrund
      const bg = mkCanvas(this.mapCv.width, this.mapCv.height);
      const g = bg.getContext('2d');
      const c = cs * dpr;
      g.fillStyle = '#17130a';
      g.fillRect(0, 0, bg.width, bg.height);
      const rnd = mulberry32(31337);
      for (let y = 0; y < this.MH; y++) {
        for (let x = 0; x < this.MW; x++) {
          if (this.grid[y * this.MW + x]) {
            g.fillStyle = '#6e5e25';
            g.fillRect(x * c, y * c, c, c);
            g.fillStyle = 'rgba(255,235,150,0.12)';
            g.fillRect(x * c, y * c, c, Math.max(1, c * 0.18));
          } else {
            const v = 22 + rnd() * 8;
            g.fillStyle = `rgb(${v + 6},${v},${v * 0.45})`;
            g.fillRect(x * c, y * c, c, c);
          }
        }
      }
      for (const li of this.lights) {
        if (li.kind === 2) continue;
        const gx = (li.x + 0.5) * c;
        const gy = (li.y + 0.5) * c;
        const grd = g.createRadialGradient(gx, gy, 0, gx, gy, c * 2.2);
        grd.addColorStop(0, 'rgba(255,246,200,0.16)');
        grd.addColorStop(1, 'rgba(255,246,200,0)');
        g.fillStyle = grd;
        g.fillRect(gx - c * 2.2, gy - c * 2.2, c * 4.4, c * 4.4);
      }
      this.bg = bg;
    }

    frameSpectator(now, dt) {
      this.updateInterp();
      const g = this.sg;
      if (!g || !this.bg) return;
      const c = this.cs * this.sdpr;
      g.drawImage(this.bg, 0, 0);
      // Zettel
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.005);
      for (const n of this.notes.values()) {
        const x = n.x * c;
        const y = n.y * c;
        g.save();
        g.translate(x, y);
        g.rotate(((n.id * 37) % 60) / 100 - 0.3);
        g.shadowColor = 'rgba(255,250,220,0.9)';
        g.shadowBlur = 8 * this.sdpr * pulse;
        g.fillStyle = '#f4efdc';
        g.fillRect(-c * 0.2, -c * 0.25, c * 0.4, c * 0.5);
        g.restore();
      }
      // Spieler
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.font = `600 ${Math.max(10, Math.round(c * 0.55))}px Rubik, system-ui, sans-serif`;
      for (const p of this.ipPlayers) {
        const x = p.x * c;
        const y = p.y * c;
        const stunned = p.f & 1;
        const idle = p.f & 8;
        const col = p.pl.color || '#efe6d8';
        g.globalAlpha = idle ? 0.45 : 1;
        if (stunned) {
          g.strokeStyle = now % 400 < 200 ? '#ff3344' : '#ffffff';
          g.lineWidth = 2 * this.sdpr;
          g.beginPath();
          g.arc(x, y, c * 0.62, 0, Math.PI * 2);
          g.stroke();
        } else if (p.f & 2) {
          g.strokeStyle = 'rgba(255,255,255,0.5)';
          g.lineWidth = 1 * this.sdpr;
          g.beginPath();
          g.arc(x, y, c * 0.55, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, c * 0.36, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = col;
        g.lineWidth = 2 * this.sdpr;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(p.a) * c * 0.75, y + Math.sin(p.a) * c * 0.75);
        g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillText(p.pl.name, x + 1, y - c * 0.5 + 1);
        g.fillStyle = col;
        g.fillText(p.pl.name, x, y - c * 0.5);
        g.globalAlpha = 1;
      }
      // Monster
      for (const m of this.ipMonsters) {
        const x = m.x * c;
        const y = m.y * c;
        const hunting = m.st === 2;
        const rad = c * (hunting ? 1.6 + 0.3 * Math.sin(now * 0.02) : 1.1);
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, hunting ? 'rgba(220,20,40,0.75)' : 'rgba(150,10,25,0.45)');
        grd.addColorStop(1, 'rgba(150,0,20,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#050405';
        g.beginPath();
        g.arc(x, y, c * 0.45, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        const ex = Math.cos(m.a) * c * 0.15;
        const ey = Math.sin(m.a) * c * 0.15;
        const px2 = -Math.sin(m.a) * c * 0.13;
        const py2 = Math.cos(m.a) * c * 0.13;
        g.beginPath();
        g.arc(x + ex + px2, y + ey + py2, c * 0.08, 0, Math.PI * 2);
        g.arc(x + ex - px2, y + ey - py2, c * 0.08, 0, Math.PI * 2);
        g.fill();
      }
      this.updateSpectatorHud(now);
      this.updateAudioSpectator();
    }

    updateSpectatorHud(now) {
      const sNow = this.serverNow();
      const countdown = this.phase === 'countdown' || sNow < this.countdownEnd;
      const rem = countdown ? this.durationSec * 1000 : this.endAt - sNow;
      this.setText('stimer', this.specTimer, fmtTime(rem));
      const urgent = !countdown && !this.ended && rem <= 30000;
      if (this.hudCache.surgent !== urgent) {
        this.hudCache.surgent = urgent;
        this.specTimer.classList.toggle('urgent', urgent);
      }
      let center = '';
      if (this.ended) {
        center =
          this.endReason === 'notes'
            ? '<div class="br-end-title">Alle Zettel gefunden!</div>'
            : this.endReason === 'forced'
              ? '<div class="br-end-title">Beendet</div>'
              : '<div class="br-end-title">Die Zeit ist um!</div>';
      } else if (countdown) {
        center = `<div class="br-cd-title">Das Monster erwacht in <span>${Math.max(1, Math.ceil((this.countdownEnd - sNow) / 1000))}</span></div>`;
      } else if (now < this.awakeUntil) {
        center = '<div class="br-awake">ES IST ERWACHT</div>';
      }
      this.setHtml('scenter', this.specCenter, center);
      if (now - this.sideAt < 250) return;
      this.sideAt = now;
      let found = 0;
      for (const p of this.players.values()) found += p.notes;
      this.setHtml(
        'sstats',
        this.specStats,
        `<div><b>${found}</b> eingesammelt</div><div><b>${this.notes.size}</b> im Raum</div><div><b>${this.monsters.size}</b> Monster</div><div>😈 Wut <b>${Math.round((this.rage || 0) * 100)} %</b></div>`,
      );
      const teamName = (id) => {
        const t = (this.ctx.teams || []).find((x) => x.id === id);
        return t ? t.name : '';
      };
      const rows = [...this.players.values()]
        .sort((a, b) => b.notes - a.notes || a.name.localeCompare(b.name))
        .map((p) => {
          const st = p.flags & 1 ? '<span class="br-spec-st">gelähmt</span>' : p.flags & 8 ? '<span class="br-spec-st idle">abwesend</span>' : '';
          return (
            `<li><span class="br-spec-dot" style="background:${esc(p.color)}"></span>` +
            `<span class="br-spec-name">${esc(p.name)}<small>${esc(teamName(p.teamId))}</small></span>${st}<b>${p.notes}</b></li>`
          );
        })
        .join('');
      this.setHtml('srank', this.specRank, rows);
    }

    updateAudioSpectator() {
      const A = this.audio;
      if (!A.ensure()) return;
      A.loop('hum', 'br_hum', () => A.synthHum(), this.ended ? 0 : 0.1 * (this.G || 1));
    }

    // ---------------------------------------------------------------- Loop

    frame() {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(this._frame);
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - (this.lastFrame || now)) / 1000));
      this.lastFrame = now;
      if (!this.init) return;
      try {
        if (this.mode === 'player') this.framePlayer(now, dt);
        else if (this.mode === 'spectator') {
          this.updateFlicker(dt, now, 0);
          this.frameSpectator(now, dt);
        }
      } catch (e) {
        if (!this.errLogged) {
          this.errLogged = true;
          console.error('[backrooms] frame', e);
        }
      }
    }
  }

  function mount(el, ctx) {
    unmount();
    if (!el) return;
    inst = new BRClient(el, ctx);
  }

  function unmount() {
    if (!inst) return;
    try {
      inst.destroy();
    } catch (e) {
      console.error('[backrooms] unmount', e);
    }
    inst = null;
  }

  window.Backrooms = { mount, unmount };
})();
