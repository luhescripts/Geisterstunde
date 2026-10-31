/* Geisterstunde – Sound-Engine
 * Echte Samples aus public/sounds/ (Manifest sounds.json), prozedurale WebAudio-Klänge als Fallback.
 *
 *   Sound.unlock()            AudioContext erzeugen/fortsetzen (beim ersten Klick/Tastendruck aufrufen)
 *   Sound.play(name, opts?)   Einzelklang; opts = { volume, rate, delay } (Multiplikatoren / Sekunden)
 *   Sound.ambient(name|null)  Hintergrundschleife mit Überblendung ('lobby','board','tension','backrooms')
 *   Sound.buffer(name)        AudioBuffer (Sample oder vorgerenderter Synth) oder null
 *   Sound.has(name)           true, wenn Sound.buffer(name) etwas liefert
 *   Sound.info(name)          { volume, loop, rate, reverb, jitter } aus dem Manifest oder null
 *   Sound.ctx / .master / .reverb   für eigene Nodes anderer Module
 *   Sound.muted, Sound.setMuted(bool), Sound.toggleMute()
 *   Sound.volume (0–1), Sound.setVolume(v)   Lautstärke, wird im Browser gemerkt
 */
(function () {
  'use strict';

  var LS_KEY = 'gs-muted';
  var VOL_KEY = 'gs-volume';
  var MASTER_VOL = 0.8;
  var THROTTLE = { hover: 0.04, type: 0.025, click: 0.03, tick: 0.2, tickUrgent: 0.2, pop: 0.05, br_step: 0.05 };

  function readMuted() { try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; } }
  function writeMuted(v) { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (e) { /* ignorieren */ } }
  function readVolume() {
    try {
      var v = parseFloat(localStorage.getItem(VOL_KEY));
      return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch (e) { return 1; }
  }
  function writeVolume(v) { try { localStorage.setItem(VOL_KEY, String(v)); } catch (e) { /* ignorieren */ } }
  // Quadratisch, damit der Regler sich gleichmäßig anfühlt (das Ohr hört logarithmisch)
  function targetGain() { return Sound.muted ? 0 : MASTER_VOL * Sound.volume * Sound.volume; }
  function noop() {}

  var scriptBase = (function () {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL('../sounds/', src).href;
    } catch (e) { /* ignorieren */ }
    return 'sounds/';
  })();

  var E = null;          // aktive Engine (live oder offline beim Messen/Vorrendern)
  var live = null;       // Live-Engine
  var current = null;    // laufende Hintergrundschleife
  var wanted = null;     // gewünschte Hintergrundschleife (auch vor unlock)
  var lastPlay = {};
  var tickFlip = false;

  var manifest = {};     // name → { file, volume, loop, rate, reverb, jitter }
  var manifestP = null;
  var dataP = {};        // name → Promise<ArrayBuffer[]>
  var decoding = {};     // name → Promise
  var buffers = {};      // name → AudioBuffer[]
  var synthBufs = {};    // name → AudioBuffer (vorgerenderter Synth, falls kein Sample)
  var readyResolve;

  var Sound = {
    ctx: null,
    master: null,
    reverb: null,
    muted: readMuted(),
    volume: readVolume(),
    base: scriptBase,
    ready: new Promise(function (r) { readyResolve = r; }),
    unlock: unlock,
    setMuted: setMuted,
    toggleMute: function () { setMuted(!Sound.muted); return Sound.muted; },
    setVolume: setVolume,
    play: play,
    ambient: ambient,
    buffer: buffer,
    has: function (name) { return !!((buffers[name] && buffers[name].length) || synthBufs[name]); },
    info: function (name) {
      var m = manifest[name];
      if (!m) return null;
      return { volume: m.volume != null ? m.volume : 0.7, loop: !!m.loop, rate: m.rate || 1, reverb: m.reverb || 0, jitter: m.jitter || 0 };
    },
    samples: function () { return Object.keys(buffers); },
    _measure: measure
  };
  window.Sound = Sound;

  // ---------------------------------------------------------------- Engine
  // gain: fester Pegel fürs Offline-Vorrendern; live gilt die eingestellte Lautstärke
  function makeEngine(ctx, gain) {
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    var master = ctx.createGain();
    master.gain.value = gain == null ? targetGain() : gain;
    master.connect(comp);
    var sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    var amb = ctx.createGain();
    amb.gain.value = 0.6;
    amb.connect(master);
    var conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.6, 2.4);
    var revIn = ctx.createGain();
    var revOut = ctx.createGain();
    revOut.gain.value = 0.32;
    revIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(master);
    return { ctx: ctx, master: master, sfx: sfx, amb: amb, reverb: revIn, noise: noiseBuffer(ctx, 2), organ: organWave(ctx) };
  }

  function impulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function noiseBuffer(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function organWave(ctx) {
    var real = new Float32Array([0, 1, 0.55, 0.32, 0.22, 0, 0.12, 0, 0.08]);
    return ctx.createPeriodicWave(real, new Float32Array(real.length));
  }

  function resumeCtx() {
    if (!live || live.ctx.state !== 'suspended' || !live.ctx.resume) return;
    try { var p = live.ctx.resume(); if (p && p.catch) p.catch(noop); } catch (e) { /* ignorieren */ }
  }

  function unlock() {
    if (!live) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { live = makeEngine(new AC()); } catch (e) { live = null; return; }
      E = live;
      Sound.ctx = live.ctx;
      Sound.master = live.master;
      Sound.reverb = live.reverb;
      prefetch().then(decodeAll);
    }
    resumeCtx();
    startWanted();
  }

  // Startet die gewünschte Schleife; wartet bis zu 2,5 s auf das Sample, sonst Synth.
  // Die bisherige Schleife läuft bis dahin weiter (keine Lücke).
  function startWanted() {
    var name = wanted;
    if (!name || !live || (current && current.name === name)) return;
    if (buffers[name] && buffers[name].length) return startAmbient(name);
    var done = false;
    var go = function () {
      if (done) return;
      done = true;
      if (wanted === name && live && (!current || current.name !== name)) startAmbient(name);
    };
    setTimeout(go, 2500);
    prefetch().then(function () {
      if (!manifest[name]) return go();
      decodeEntry(name).then(go, go);
    }, go);
  }

  function rampMaster() {
    if (!live) return;
    var g = live.master.gain, t = live.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(targetGain(), t + 0.08);
  }

  function setMuted(v) {
    Sound.muted = !!v;
    writeMuted(Sound.muted);
    rampMaster();
  }

  // Wer den Regler bewegt, will etwas hören: Lauter stellen hebt die Stummschaltung auf.
  function setVolume(v) {
    Sound.volume = Math.min(1, Math.max(0, Number(v) || 0));
    writeVolume(Sound.volume);
    if (Sound.volume > 0 && Sound.muted) {
      Sound.muted = false;
      writeMuted(false);
    }
    rampMaster();
  }

  // ---------------------------------------------------------------- Samples laden
  function prefetch() {
    if (manifestP) return manifestP;
    if (typeof fetch !== 'function') return (manifestP = Promise.resolve(manifest));
    manifestP = fetch(Sound.base + 'sounds.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (m) {
        manifest = m && typeof m === 'object' ? m : {};
        var names = Object.keys(manifest).sort(function (a, b) { return prio(a) - prio(b); });
        queue(names, 4, fetchEntry);
        return manifest;
      })
      .catch(function () { manifest = {}; return manifest; });
    return manifestP;
  }

  function prio(name) {
    var m = manifest[name] || {};
    if (!m.loop) return 0;
    return name === wanted ? 1 : name === 'lobby' ? 2 : 3;
  }

  function queue(items, n, fn) {
    var i = 0;
    function next() {
      if (i >= items.length) return;
      fn(items[i++]).then(next, next);
    }
    for (var k = 0; k < n; k++) next();
  }

  function fetchEntry(name) {
    if (!dataP[name]) {
      var files = [].concat(manifest[name].file || []);
      dataP[name] = Promise.all(files.map(function (f) {
        return fetch(Sound.base + f).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        });
      }));
      dataP[name].then(function () { if (live) decodeEntry(name); }, noop);
    }
    return dataP[name].then(noop, noop);
  }

  function decodeEntry(name) {
    if (decoding[name]) return decoding[name];
    if (!dataP[name]) fetchEntry(name);
    decoding[name] = dataP[name]
      .then(function (abs) { return Promise.all(abs.map(function (ab) { return decode(live.ctx, ab); })); })
      .then(function (list) {
        buffers[name] = list.filter(Boolean);
        if (!buffers[name].length) { delete buffers[name]; return; }
        delete synthBufs[name];
        // Schleife läuft noch als Synth oder wartet auf das Sample → umschalten
        if (wanted === name && (!current || (current.name === name && !current.sample))) startAmbient(name);
      }, noop);
    return decoding[name];
  }

  function decode(ctx, ab) {
    return new Promise(function (res, rej) {
      try {
        var p = ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      } catch (e) { rej(e); }
    });
  }

  function decodeAll() {
    var names = Object.keys(manifest).sort(function (a, b) { return prio(a) - prio(b); });
    return Promise.all(names.map(function (n) { return decodeEntry(n).then(noop, noop); }))
      .then(prerenderSynth)
      .then(function () { readyResolve(); }, function () { readyResolve(); });
  }

  // Backrooms-Namen sollen über Sound.buffer() immer etwas liefern
  var BR_SYNTH = { br_hum: 2, br_step: 0.25, br_growl: 1.8, br_heartbeat: 0.9, br_scream: 1.8, br_paper: 0.5, br_static: 1, br_jumpscare: 1.4, br_breath: 2.4, br_whisper: 1.8 };
  function prerenderSynth() {
    var names = Object.keys(BR_SYNTH).filter(function (n) { return !buffers[n]; });
    return Promise.all(names.map(function (n) {
      return renderOffline(n, BR_SYNTH[n], 1).then(function (buf) {
        if (!buf) return;
        normalize(buf, 0.89);
        synthBufs[n] = buf;
      }, noop);
    }));
  }

  function normalize(buf, target) {
    var p = 0, ch, d, i;
    for (ch = 0; ch < buf.numberOfChannels; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < d.length; i++) if (Math.abs(d[i]) > p) p = Math.abs(d[i]);
    }
    if (!p) return;
    for (ch = 0; ch < buf.numberOfChannels; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < d.length; i++) d[i] *= target / p;
    }
  }

  function buffer(name) {
    var list = buffers[name];
    if (list && list.length) return list[Math.floor(Math.random() * list.length)];
    return synthBufs[name] || null;
  }

  // ---------------------------------------------------------------- Wiedergabe
  function play(name, opts) {
    if (!live || Sound.muted) return;
    var sample = !!(buffers[name] && buffers[name].length);
    if (!sample && !SFX.hasOwnProperty(name)) return;
    resumeCtx();
    var t = live.ctx.currentTime;
    var gap = THROTTLE[name];
    if (gap && lastPlay[name] != null && t - lastPlay[name] < gap) return;
    lastPlay[name] = t;
    var at = t + 0.005 + (opts && opts.delay ? opts.delay : 0);
    try {
      E = live;
      if (sample) playSample(live, name, at, opts);
      else SFX[name](at);
    } catch (e) { /* nie abstürzen */ }
  }

  function playSample(e, name, t, opts) {
    var info = manifest[name] || {}, list = buffers[name];
    var src = e.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    var rate = (info.rate || 1) * (opts && opts.rate ? opts.rate : 1);
    if (info.jitter) rate *= 1 + (Math.random() * 2 - 1) * info.jitter;
    src.playbackRate.value = rate;
    var g = e.ctx.createGain();
    g.gain.value = (info.volume != null ? info.volume : 0.7) * (opts && opts.volume != null ? opts.volume : 1);
    src.connect(g);
    route(e, g, e.sfx, info.reverb);
    src.start(t);
    return src;
  }

  function ambient(name) {
    name = name || null;
    if (name === wanted && (current ? current.name === name : !name)) return;
    wanted = name;
    if (!live) return;
    if (name) startWanted();
    else startAmbient(null);
  }

  function startAmbient(name) {
    if (current) { current.stop(1.6); current = null; }
    if (!name || !live) return;
    try {
      if (buffers[name] && buffers[name].length) {
        current = sampleAmbient(live, name);
        current.sample = true;
      } else if (AMB.hasOwnProperty(name)) {
        current = AMB[name](live);
      }
      if (current) current.name = name;
    } catch (e) { current = null; }
  }

  function sampleAmbient(e, name) {
    var info = manifest[name] || {};
    var buf = buffers[name][0];
    var out = ambShell(e, info.volume != null ? info.volume : 0.4);
    var src = e.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (info.rate) src.playbackRate.value = info.rate;
    src.connect(out);
    src.start(e.ctx.currentTime, Math.random() * buf.duration);
    return ambHandle(e, out, [src], []);
  }

  // ---------------------------------------------------------------- Synth-Bausteine
  function envGain(ctx, t, dur, peak, attack, hold) {
    var g = ctx.createGain();
    attack = Math.min(attack, dur * 0.5);
    peak = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, Math.max(t + attack, Math.min(t + attack + hold, t + dur - 0.01)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  function route(e, node, dest, rev) {
    node.connect(dest || e.sfx);
    if (rev && e.reverb) {
      var s = e.ctx.createGain();
      s.gain.value = rev;
      node.connect(s);
      s.connect(e.reverb);
    }
  }

  // o: type|wave, freq, freqEnd, glide, t, dur, gain, attack, hold, detune, filter{type,freq,freqEnd,q}, dest, rev, e
  function tone(o) {
    var e = o.e || E, ctx = e.ctx, t = o.t, dur = o.dur;
    var osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glide || dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    var src = osc;
    if (o.filter) {
      var f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(o.filter.freqEnd, t + dur);
      f.Q.value = o.filter.q != null ? o.filter.q : 0.7;
      osc.connect(f);
      src = f;
    }
    var g = envGain(ctx, t, dur, o.gain != null ? o.gain : 0.2, o.attack != null ? o.attack : 0.005, o.hold || 0);
    src.connect(g);
    route(e, g, o.dest, o.rev);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  // o: t, dur, ftype, freq, freqEnd, glide, q, gain, attack, hold, dest, rev, e
  function noise(o) {
    var e = o.e || E, ctx = e.ctx, t = o.t, dur = o.dur;
    var src = ctx.createBufferSource();
    src.buffer = e.noise;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.glide || dur));
    f.Q.value = o.q != null ? o.q : 1;
    var g = envGain(ctx, t, dur, o.gain != null ? o.gain : 0.2, o.attack != null ? o.attack : 0.005, o.hold || 0);
    src.connect(f);
    f.connect(g);
    route(e, g, o.dest, o.rev);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return f;
  }

  function lfo(ctx, freq, depth, param, type) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start();
    return o;
  }

  function organ(f, t, dur, gain) {
    tone({ wave: E.organ, freq: f, t: t, dur: dur, gain: gain, attack: 0.025, hold: Math.max(0, dur - 0.2), filter: { type: 'lowpass', freq: 2600 }, rev: 0.7 });
  }

  function thump(e, t, dest, gain) {
    tone({ e: e, type: 'sine', freq: 66, freqEnd: 36, t: t, dur: 0.24, gain: gain, attack: 0.004, dest: dest });
    noise({ e: e, t: t, dur: 0.06, ftype: 'lowpass', freq: 180, gain: gain * 0.3, attack: 0.002, dest: dest });
  }

  function creak(e, t, dest) {
    var dur = 0.5 + Math.random() * 0.6;
    tone({ e: e, type: 'sawtooth', freq: 48 + Math.random() * 20, freqEnd: 70 + Math.random() * 30, t: t, dur: dur, gain: 0.03, attack: 0.08,
      filter: { type: 'bandpass', freq: 900 + Math.random() * 500, q: 5 }, dest: dest, rev: 0.5 });
  }

  function distantBell(e, t, dest) {
    var f0 = [196, 174.6, 220][Math.floor(Math.random() * 3)];
    [[1, 0.05, 4], [2.4, 0.02, 3], [3.0, 0.015, 2.5], [4.5, 0.008, 1.8]].forEach(function (p) {
      tone({ e: e, type: 'sine', freq: f0 * p[0], t: t, dur: p[2], gain: p[1], attack: 0.01, dest: dest, rev: 0.9 });
    });
  }

  function scream(t, lp, dryAmt) {
    var e = E, ctx = e.ctx, dur = 1.6;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(980, t + 0.25);
    osc.frequency.setValueAtTime(980, t + 0.6);
    osc.frequency.exponentialRampToValueAtTime(420, t + dur);
    var vib = ctx.createOscillator();
    vib.frequency.value = 7;
    var vibG = ctx.createGain();
    vibG.gain.value = 35;
    vib.connect(vibG);
    vibG.connect(osc.frequency);
    var mix = ctx.createGain();
    [[1000, 4], [2600, 6]].forEach(function (p) {
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = p[0];
      f.Q.value = p[1];
      osc.connect(f);
      f.connect(mix);
    });
    var low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = lp;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    g.gain.setValueAtTime(0.5, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(low);
    low.connect(g);
    var dry = ctx.createGain();
    dry.gain.value = dryAmt;
    g.connect(dry);
    dry.connect(e.sfx);
    if (e.reverb) {
      var wet = ctx.createGain();
      wet.gain.value = 1.2;
      g.connect(wet);
      wet.connect(e.reverb);
    }
    noise({ t: t, dur: dur * 0.8, freq: 1800, q: 1.2, gain: 0.04, attack: 0.1, rev: 0.8 });
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  function jumpscare(t) {
    [1250, 1320, 1475, 1660, 1870].forEach(function (f) {
      tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.7, glide: 0.9, t: t, dur: 1.0, gain: 0.12, attack: 0.004, hold: 0.25, filter: { type: 'highpass', freq: 600 } });
    });
    noise({ t: t, dur: 0.9, ftype: 'highpass', freq: 1200, q: 0.7, gain: 0.45, attack: 0.002, hold: 0.2 });
    tone({ type: 'sine', freq: 70, freqEnd: 30, t: t, dur: 0.6, gain: 0.8, attack: 0.002 });
    noise({ t: t, dur: 0.2, ftype: 'lowpass', freq: 300, gain: 0.6, attack: 0.001 });
  }

  function rustle(t, n) {
    for (var i = 0; i < n; i++) {
      noise({ t: t + i * 0.03 + Math.random() * 0.02, dur: 0.04 + Math.random() * 0.05, freq: 2500 + Math.random() * 3500, q: 1.5, gain: 0.08 + Math.random() * 0.06, attack: 0.002 });
    }
  }

  // ---------------------------------------------------------------- Synth-Einzelklänge (Fallback)
  var SFX = {
    click: function (t) {
      tone({ type: 'triangle', freq: 1400, freqEnd: 900, t: t, dur: 0.05, gain: 0.12, attack: 0.002 });
      noise({ t: t, dur: 0.03, freq: 3500, q: 2, gain: 0.05, attack: 0.001 });
    },
    hover: function (t) {
      tone({ type: 'sine', freq: 2600, t: t, dur: 0.035, gain: 0.025, attack: 0.003 });
    },
    lock: function (t) {
      tone({ type: 'sine', freq: 140, freqEnd: 45, t: t, dur: 0.35, gain: 0.55, attack: 0.003 });
      tone({ type: 'triangle', freq: 90, freqEnd: 40, t: t, dur: 0.25, gain: 0.25, attack: 0.002 });
      noise({ t: t, dur: 0.12, ftype: 'lowpass', freq: 900, q: 0.7, gain: 0.35, attack: 0.001 });
      noise({ t: t, dur: 0.04, freq: 2500, q: 1, gain: 0.08, attack: 0.001 });
    },
    correct: function (t) {
      [329.63, 415.3, 493.88, 622.25, 830.61].forEach(function (f, i) {
        var tt = t + i * 0.07;
        tone({ type: 'sine', freq: f, t: tt, dur: 1.4, gain: 0.12, attack: 0.004, rev: 0.6 });
        tone({ type: 'sine', freq: f * 2.01, t: tt, dur: 0.6, gain: 0.03, attack: 0.002, rev: 0.4 });
      });
      [164.81, 246.94, 329.63].forEach(function (f) {
        tone({ type: 'triangle', freq: f, t: t, dur: 1.6, gain: 0.05, attack: 0.15, hold: 0.4, filter: { type: 'lowpass', freq: 1200 }, rev: 0.5 });
      });
    },
    wrong: function (t) {
      [110, 116.5, 155.6].forEach(function (f) {
        tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.85, glide: 0.6, t: t, dur: 0.7, gain: 0.12, attack: 0.01, hold: 0.2, filter: { type: 'lowpass', freq: 900, freqEnd: 300 } });
      });
      noise({ t: t, dur: 0.15, ftype: 'lowpass', freq: 400, gain: 0.15, attack: 0.002 });
    },
    tick: function (t) {
      tickFlip = !tickFlip;
      noise({ t: t, dur: 0.025, freq: tickFlip ? 3200 : 2400, q: 6, gain: 0.35, attack: 0.001 });
      tone({ type: 'sine', freq: tickFlip ? 1800 : 1400, t: t, dur: 0.03, gain: 0.04, attack: 0.001 });
    },
    tickUrgent: function (t) {
      noise({ t: t, dur: 0.03, freq: 3600, q: 5, gain: 0.45, attack: 0.001 });
      tone({ type: 'square', freq: 880, t: t, dur: 0.09, gain: 0.06, attack: 0.002, filter: { type: 'lowpass', freq: 2500 } });
      tone({ type: 'sine', freq: 55, t: t, dur: 0.2, gain: 0.25, attack: 0.002 });
    },
    reveal: function (t) {
      var f0 = 146.83;
      [[1, 0.35, 3.2], [2.0, 0.12, 2.4], [2.76, 0.12, 2.0], [5.4, 0.06, 1.2], [8.93, 0.03, 0.8]].forEach(function (p) {
        tone({ type: 'sine', freq: f0 * p[0], t: t, dur: p[2], gain: p[1], attack: 0.003, rev: 0.7 });
      });
      noise({ t: t, dur: 0.12, ftype: 'lowpass', freq: 600, gain: 0.2, attack: 0.001 });
    },
    thunder: function (t) {
      noise({ t: t, dur: 0.35, ftype: 'highpass', freq: 1500, q: 0.5, gain: 0.25, attack: 0.002, rev: 0.4 });
      for (var i = 0; i < 6; i++) {
        noise({ t: t + 0.05 + i * (0.25 + Math.random() * 0.3), dur: 1.2 + Math.random() * 1.2, ftype: 'lowpass', freq: 500 - i * 50, freqEnd: 120, q: 0.6,
          gain: 0.35 - i * 0.04, attack: 0.03 + Math.random() * 0.1, rev: 0.5 });
      }
      tone({ type: 'sine', freq: 48, freqEnd: 32, t: t, dur: 2.5, gain: 0.25, attack: 0.05 });
    },
    whoosh: function (t) {
      var f = noise({ t: t, dur: 0.7, freq: 300, q: 1.5, gain: 0.25, attack: 0.25 });
      f.frequency.exponentialRampToValueAtTime(2800, t + 0.35);
      f.frequency.exponentialRampToValueAtTime(400, t + 0.7);
    },
    pop: function (t) {
      tone({ type: 'sine', freq: 380, freqEnd: 980, glide: 0.07, t: t, dur: 0.14, gain: 0.25, attack: 0.002 });
      tone({ type: 'triangle', freq: 1960, t: t + 0.05, dur: 0.12, gain: 0.04, attack: 0.002, rev: 0.3 });
    },
    drumroll: function (t) {
      var dur = 1.5, tt = t;
      while (tt < t + dur) {
        var p = (tt - t) / dur;
        noise({ t: tt, dur: 0.06, freq: 1800 + Math.random() * 600, q: 0.8, gain: 0.06 + p * 0.16, attack: 0.001 });
        tone({ type: 'triangle', freq: 180 + Math.random() * 20, t: tt, dur: 0.05, gain: 0.03 + p * 0.05, attack: 0.001 });
        tt += 0.045 - p * 0.012 + Math.random() * 0.006;
      }
      noise({ t: t + dur, dur: 0.6, ftype: 'highpass', freq: 3000, q: 0.5, gain: 0.18, attack: 0.002, rev: 0.4 });
      tone({ type: 'sine', freq: 90, freqEnd: 45, t: t + dur, dur: 0.4, gain: 0.4, attack: 0.002 });
    },
    fanfare: function (t) {
      var chords = [
        [[146.83, 174.61, 220.0, 293.66], 0.55],
        [[116.54, 146.83, 174.61, 233.08], 0.55],
        [[110.0, 138.59, 164.81, 220.0], 0.6],
        [[146.83, 220.0, 293.66, 349.23, 440.0], 1.6]
      ];
      var tt = t;
      chords.forEach(function (c) {
        c[0].forEach(function (f) {
          organ(f, tt, c[1] + 0.08, 0.06);
          organ(f / 2, tt, c[1] + 0.08, 0.03);
        });
        tt += c[1];
      });
    },
    boom: function (t) {
      tone({ type: 'sine', freq: 55, freqEnd: 26, t: t, dur: 2.5, gain: 0.7, attack: 0.004, rev: 0.5 });
      noise({ t: t, dur: 1.2, ftype: 'lowpass', freq: 400, freqEnd: 80, gain: 0.4, attack: 0.002, rev: 0.6 });
    },
    scream: function (t) { scream(t, 2200, 0.5); },
    jumpscare: jumpscare,
    pickup: function (t) {
      rustle(t, 7);
      tone({ type: 'sine', freq: 1318.5, t: t + 0.18, dur: 1.0, gain: 0.07, attack: 0.005, rev: 0.6 });
      tone({ type: 'sine', freq: 1975.5, t: t + 0.24, dur: 0.8, gain: 0.04, attack: 0.005, rev: 0.6 });
    },
    type: function (t) {
      var v = Math.random();
      noise({ t: t, dur: 0.025, freq: 2200 + v * 1200, q: 3, gain: 0.18, attack: 0.001 });
      tone({ type: 'square', freq: 140 + v * 40, t: t, dur: 0.035, gain: 0.05, attack: 0.001, filter: { type: 'lowpass', freq: 600 } });
      noise({ t: t + 0.03 + v * 0.01, dur: 0.02, freq: 4000, q: 4, gain: 0.05, attack: 0.001 });
    },
    join: function (t) {
      for (var i = 0; i < 8; i++) {
        noise({ t: t + i * 0.045, dur: 0.035, freq: 900 + Math.random() * 400, q: 1.2, gain: 0.07 + 0.03 * Math.sin(i), attack: 0.004 });
      }
      tone({ type: 'sine', freq: 3200, freqEnd: 4200, glide: 0.05, t: t + 0.1, dur: 0.07, gain: 0.04, attack: 0.003 });
      tone({ type: 'sine', freq: 3600, freqEnd: 4600, glide: 0.05, t: t + 0.25, dur: 0.06, gain: 0.035, attack: 0.003 });
    },
    buzz: function (t) {
      tone({ type: 'square', freq: 92, t: t, dur: 0.2, gain: 0.1, attack: 0.003, hold: 0.12, filter: { type: 'lowpass', freq: 1400 } });
      tone({ type: 'square', freq: 97, t: t, dur: 0.2, gain: 0.08, attack: 0.003, hold: 0.12, filter: { type: 'lowpass', freq: 1400 } });
    },

    // --- Backrooms (Fallback, falls Samples fehlen) ---
    br_hum: function (t) {
      tone({ type: 'sawtooth', freq: 60, t: t, dur: 2, gain: 0.25, attack: 0.005, hold: 1.98, filter: { type: 'lowpass', freq: 420, q: 1.2 } });
      tone({ type: 'sine', freq: 120, t: t, dur: 2, gain: 0.15, attack: 0.005, hold: 1.98 });
      tone({ type: 'square', freq: 180, t: t, dur: 2, gain: 0.03, attack: 0.005, hold: 1.98, filter: { type: 'lowpass', freq: 900 } });
    },
    br_step: function (t) {
      noise({ t: t, dur: 0.09, ftype: 'lowpass', freq: 700 + Math.random() * 300, q: 0.7, gain: 0.3, attack: 0.004 });
      tone({ type: 'sine', freq: 90, freqEnd: 50, t: t, dur: 0.08, gain: 0.25, attack: 0.003 });
    },
    br_growl: function (t) {
      var e = E, ctx = e.ctx, dur = 1.7;
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(82, t);
      osc.frequency.linearRampToValueAtTime(64, t + dur);
      var wob = ctx.createOscillator();
      wob.type = 'square';
      wob.frequency.value = 13;
      var wobG = ctx.createGain();
      wobG.gain.value = 9;
      wob.connect(wobG);
      wobG.connect(osc.frequency);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 650;
      f.Q.value = 3;
      var g = envGain(ctx, t, dur, 0.45, 0.25, 0.9);
      osc.connect(f);
      f.connect(g);
      route(e, g, e.sfx, 0.3);
      noise({ t: t, dur: dur, freq: 380, q: 2, gain: 0.12, attack: 0.25, hold: 0.9 });
      osc.start(t);
      wob.start(t);
      osc.stop(t + dur + 0.05);
      wob.stop(t + dur + 0.05);
    },
    br_heartbeat: function (t) {
      thump(E, t + 0.02, E.sfx, 0.7);
      thump(E, t + 0.29, E.sfx, 0.5);
    },
    br_scream: function (t) { scream(t, 1600, 0.35); },
    br_paper: function (t) { rustle(t, 6); },
    br_static: function (t) {
      noise({ t: t, dur: 1, ftype: 'bandpass', freq: 3000, q: 0.3, gain: 0.3, attack: 0.005, hold: 0.98 });
    },
    br_jumpscare: jumpscare,
    br_breath: function (t) {
      noise({ t: t, dur: 1.0, freq: 900, freqEnd: 1300, q: 2.5, gain: 0.18, attack: 0.5 });
      noise({ t: t + 1.1, dur: 1.2, freq: 1100, freqEnd: 650, q: 2.5, gain: 0.22, attack: 0.15 });
    },
    br_whisper: function (t) {
      for (var i = 0; i < 9; i++) {
        var tt = t + i * 0.17 + Math.random() * 0.05;
        noise({ t: tt, dur: 0.12 + Math.random() * 0.1, freq: 1800 + Math.random() * 2200, q: 6, gain: 0.08 + Math.random() * 0.05, attack: 0.02, rev: 0.8 });
      }
    }
  };

  // ---------------------------------------------------------------- Synth-Hintergründe (Fallback)
  function ambShell(e, level) {
    var out = e.ctx.createGain();
    var t = e.ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 2.0);
    out.connect(e.amb);
    return out;
  }

  function ambHandle(e, out, nodes, timers) {
    var stopped = false;
    return {
      stop: function (fade) {
        if (stopped) return;
        stopped = true;
        fade = fade || 1.5;
        timers.forEach(function (id) { clearInterval(id); });
        var t = e.ctx.currentTime;
        try {
          out.gain.cancelScheduledValues(t);
          out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
          out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
        } catch (err) { /* ignorieren */ }
        setTimeout(function () {
          nodes.forEach(function (n) { try { n.stop(); } catch (err) { /* schon gestoppt */ } });
          try { out.disconnect(); } catch (err) { /* ignorieren */ }
        }, fade * 1000 + 100);
      }
    };
  }

  function windNode(e, dest, level) {
    var ctx = e.ctx;
    var src = ctx.createBufferSource();
    src.buffer = e.noise;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 450;
    f.Q.value = 0.9;
    var g = ctx.createGain();
    g.gain.value = level;
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    if (e.reverb) {
      var s = ctx.createGain();
      s.gain.value = 0.3;
      g.connect(s);
      s.connect(e.reverb);
    }
    src.start();
    return [src, lfo(ctx, 0.08, 260, f.frequency), lfo(ctx, 0.043, level * 0.85, g.gain)];
  }

  var AMB = {
    lobby: function (e) {
      var ctx = e.ctx, out = ambShell(e, 0.9), nodes = [], timers = [];
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      lp.Q.value = 0.6;
      lp.connect(out);
      [[73.42, 0.09, -3], [110.0, 0.05, 2], [146.83, 0.035, -1], [174.61, 0.018, 3]].forEach(function (p) {
        var o = ctx.createOscillator();
        o.setPeriodicWave(e.organ);
        o.frequency.value = p[0];
        o.detune.value = p[2];
        var g = ctx.createGain();
        g.gain.value = p[1];
        o.connect(g);
        g.connect(lp);
        o.start();
        nodes.push(o);
      });
      nodes.push(lfo(ctx, 0.05, 350, lp.frequency));
      nodes = nodes.concat(windNode(e, out, 0.05));
      timers.push(setInterval(function () {
        if (Math.random() < 0.4) distantBell(e, ctx.currentTime + 0.05, out);
      }, 9000));
      return ambHandle(e, out, nodes, timers);
    },
    board: function (e) {
      var ctx = e.ctx, out = ambShell(e, 0.8), nodes = [], timers = [];
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.connect(out);
      [[55, 'triangle', 0.08, 0], [55.35, 'sine', 0.07, 0], [82.41, 'triangle', 0.035, 4], [110.2, 'sine', 0.02, 0]].forEach(function (p) {
        var o = ctx.createOscillator();
        o.type = p[1];
        o.frequency.value = p[0];
        o.detune.value = p[3];
        var g = ctx.createGain();
        g.gain.value = p[2];
        o.connect(g);
        g.connect(lp);
        o.start();
        nodes.push(o);
      });
      var hi = ctx.createOscillator();
      hi.frequency.value = 880;
      var hg = ctx.createGain();
      hg.gain.value = 0;
      hi.connect(hg);
      hg.connect(out);
      if (e.reverb) {
        var hs = ctx.createGain();
        hs.gain.value = 0.6;
        hg.connect(hs);
        hs.connect(e.reverb);
      }
      hi.start();
      nodes.push(hi, lfo(ctx, 4.2, 5, hi.frequency));
      var notes = [880, 830.6, 932.3, 987.8, 739.99, 783.99];
      timers.push(setInterval(function () {
        var t = ctx.currentTime;
        hi.frequency.setTargetAtTime(notes[Math.floor(Math.random() * notes.length)], t, 1.2);
        hg.gain.cancelScheduledValues(t);
        hg.gain.setTargetAtTime(Math.random() < 0.5 ? 0.012 : 0, t, 1.5);
        if (Math.random() < 0.3) creak(e, t + Math.random() * 2, out);
      }, 6000));
      return ambHandle(e, out, nodes, timers);
    },
    tension: function (e) {
      var ctx = e.ctx, out = ambShell(e, 0.9), nodes = [], timers = [];
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      lp.Q.value = 2;
      lp.connect(out);
      var trem = ctx.createGain();
      trem.gain.value = 0.05;
      trem.connect(lp);
      [41.2, 41.5, 61.7].forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(trem);
        o.start();
        nodes.push(o);
      });
      nodes.push(lfo(ctx, 3.1, 0.02, trem.gain));
      var beat = 60 / 92, next = ctx.currentTime + 0.2;
      timers.push(setInterval(function () {
        var now = ctx.currentTime;
        if (next < now) next = now + 0.05;
        while (next < now + 0.35) {
          thump(e, next, out, 0.3);
          thump(e, next + 0.22, out, 0.18);
          next += beat;
        }
      }, 90));
      return ambHandle(e, out, nodes, timers);
    },
    backrooms: function (e) {
      var ctx = e.ctx, out = ambShell(e, 0.9), nodes = [], timers = [];
      var hum = ctx.createGain();
      hum.gain.value = 0.05;
      var hlp = ctx.createBiquadFilter();
      hlp.type = 'lowpass';
      hlp.frequency.value = 480;
      hlp.Q.value = 1.2;
      hum.connect(hlp);
      hlp.connect(out);
      [[60, 'sawtooth', 1], [120, 'sine', 0.6], [180, 'square', 0.25]].forEach(function (p) {
        var o = ctx.createOscillator();
        o.type = p[1];
        o.frequency.value = p[0];
        var g = ctx.createGain();
        g.gain.value = p[2];
        o.connect(g);
        g.connect(hum);
        o.start();
        nodes.push(o);
      });
      nodes.push(lfo(ctx, 0.23, 0.015, hum.gain));
      var whine = ctx.createOscillator();
      whine.frequency.value = 7800;
      var wg = ctx.createGain();
      wg.gain.value = 0.0015;
      whine.connect(wg);
      wg.connect(out);
      whine.start();
      nodes.push(whine);
      var rs = ctx.createBufferSource();
      rs.buffer = e.noise;
      rs.loop = true;
      var rf = ctx.createBiquadFilter();
      rf.type = 'lowpass';
      rf.frequency.value = 650;
      var rg = ctx.createGain();
      rg.gain.value = 0.03;
      rs.connect(rf);
      rf.connect(rg);
      rg.connect(out);
      rs.start();
      nodes.push(rs);
      timers.push(setInterval(function () {
        if (Math.random() >= 0.45) return;
        var t = ctx.currentTime + Math.random() * 0.5;
        var n = 2 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) {
          noise({ e: e, t: t + i * (0.03 + Math.random() * 0.05), dur: 0.02 + Math.random() * 0.03, ftype: 'highpass', freq: 2500, q: 0.7, gain: 0.03, attack: 0.001, dest: out });
        }
        hum.gain.setValueAtTime(0.05, t);
        hum.gain.linearRampToValueAtTime(0.02, t + 0.05);
        hum.gain.linearRampToValueAtTime(0.05, t + 0.2);
      }, 2500));
      return ambHandle(e, out, nodes, timers);
    }
  };

  // ---------------------------------------------------------------- Offline-Rendern (Messen, Fallback-Puffer)
  function renderOffline(name, seconds, channels, forceSynth) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    var rate = live ? live.ctx.sampleRate : 44100;
    var octx = new OAC(channels || 2, Math.ceil(rate * seconds), rate);
    var eng = makeEngine(octx, MASTER_VOL), saved = E, handle = null;
    E = eng;
    try {
      var sample = !forceSynth && buffers[name] && buffers[name].length;
      var info = manifest[name] || {};
      if (sample && info.loop) handle = sampleAmbient(eng, name);
      else if (sample) playSample(eng, name, 0.02);
      else if (SFX.hasOwnProperty(name)) SFX[name](0.02);
      else if (AMB.hasOwnProperty(name)) handle = AMB[name](eng);
      else return Promise.resolve(null);
    } finally {
      E = saved;
    }
    return octx.startRendering().then(function (buf) {
      if (handle) handle.stop(0.01);
      return buf;
    });
  }

  // Pegel messen (Testseite): { name, peak, rms, sample }
  function measure(name, seconds, forceSynth) {
    var sample = !forceSynth && !!(buffers[name] && buffers[name].length);
    return renderOffline(name, seconds || 3, 2, forceSynth).then(function (buf) {
      if (!buf) return { name: name, peak: 0, rms: 0, sample: sample };
      var p = 0, sum = 0, n = 0;
      for (var ch = 0; ch < buf.numberOfChannels; ch++) {
        var d = buf.getChannelData(ch);
        for (var i = 0; i < d.length; i++) {
          var v = Math.abs(d[i]);
          if (v > p) p = v;
          sum += d[i] * d[i];
          n++;
        }
      }
      return { name: name, peak: p, rms: Math.sqrt(sum / n), sample: sample };
    });
  }

  // Samples schon vor dem ersten Klick herunterladen (Dekodieren erst nach unlock)
  setTimeout(prefetch, 800);
})();
