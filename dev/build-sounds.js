// Baut public/sounds/ aus ausgewählten Einzeldateien der Sound-Bibliothek (nur lesen!).
// Ohne ffmpeg: WAV wird direkt in JS gelesen, ausgeschnitten, auf Mono gemischt,
// heruntergerechnet und als 16-Bit-WAV geschrieben. Kenney-OGGs werden 1:1 kopiert.
//
//   node dev/build-sounds.js              → alles bauen + sounds.json schreiben
//   node dev/build-sounds.js --only a,b   → nur diese Klänge bauen, Rest des Manifests bleibt
//   node dev/build-sounds.js --scan FILE [maxSek]  → Format + Lautstärkeverlauf anzeigen
//
// Lizenzen: Sonniss GDC 2026 Bundle (lizenzfrei, keine Namensnennung nötig), Kenney (CC0).
const fs = require('fs');
const path = require('path');

const LIB = 'C:/Users/luish/Desktop/PlateupClone/Godot3dModelsPaid';
const OUT = path.resolve(__dirname, '..', 'public', 'sounds');

const B1 = LIB + '/Sonniss.com-GDC2026-GameAudioBundle1of5';
const B2 = LIB + '/Sonniss.com-GDC2026-GameAudioBundle2of5';
const B3 = LIB + '/Sonniss.com-GDC2026-GameAudioBundle3of5';
const B5 = LIB + '/Sonniss.com-GDC2026-GameAudioBundle5of5';
const KEN = LIB + '/Kenney Game Assets All-in-1 3.7.0/Audio';

// ---------- WAV lesen ----------
function openWav(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    fs.closeSync(fd);
    throw new Error('Keine WAV-Datei: ' + file);
  }
  let pos = 12, fmt = null, dataOff = 0, dataLen = 0;
  const ch = Buffer.alloc(8);
  while (pos + 8 <= size && (!fmt || !dataOff)) {
    fs.readSync(fd, ch, 0, 8, pos);
    const id = ch.toString('ascii', 0, 4);
    const len = ch.readUInt32LE(4);
    if (id === 'fmt ') {
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, pos + 8);
      let tag = b.readUInt16LE(0);
      if (tag === 0xfffe && len >= 26) tag = b.readUInt16LE(24);
      fmt = { tag, channels: b.readUInt16LE(2), rate: b.readUInt32LE(4), blockAlign: b.readUInt16LE(12), bits: b.readUInt16LE(14) };
    } else if (id === 'data') {
      dataOff = pos + 8;
      dataLen = Math.min(len, size - dataOff);
    }
    pos += 8 + len + (len & 1);
  }
  if (!fmt || !dataOff) {
    fs.closeSync(fd);
    throw new Error('Unvollständige WAV-Datei: ' + file);
  }
  const frames = Math.floor(dataLen / fmt.blockAlign);
  return { fd, fmt, dataOff, frames, duration: frames / fmt.rate };
}

// Liest [startSek, startSek+durSek) als Mono-Float32 (Kanalmittel)
function readMono(w, startSec, durSec) {
  const { fmt } = w;
  const start = Math.max(0, Math.floor(startSec * fmt.rate));
  const n = Math.max(0, Math.min(w.frames - start, Math.floor(durSec * fmt.rate)));
  const out = new Float32Array(n);
  const CHUNK = 65536;
  const bps = fmt.bits / 8;
  for (let done = 0; done < n; done += CHUNK) {
    const cnt = Math.min(CHUNK, n - done);
    const buf = Buffer.alloc(cnt * fmt.blockAlign);
    fs.readSync(w.fd, buf, 0, buf.length, w.dataOff + (start + done) * fmt.blockAlign);
    for (let i = 0; i < cnt; i++) {
      let sum = 0;
      for (let c = 0; c < fmt.channels; c++) {
        const o = i * fmt.blockAlign + c * bps;
        let v;
        if (fmt.tag === 3) v = fmt.bits === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o);
        else if (fmt.bits === 16) v = buf.readInt16LE(o) / 32768;
        else if (fmt.bits === 24) v = buf.readIntLE(o, 3) / 8388608;
        else if (fmt.bits === 32) v = buf.readInt32LE(o) / 2147483648;
        else if (fmt.bits === 8) v = (buf[o] - 128) / 128;
        else throw new Error('Nicht unterstütztes Format: ' + fmt.bits + ' Bit');
        sum += v;
      }
      out[done + i] = sum / fmt.channels;
    }
  }
  return out;
}

// ---------- Signalverarbeitung ----------
function resample(x, inRate, outRate) {
  if (inRate === outRate) return x;
  const ratio = inRate / outRate;
  const outLen = Math.floor(x.length / ratio);
  const y = new Float32Array(outLen);
  const fc = Math.min(1, outRate / inRate) * 0.94;
  const width = Math.ceil(16 / fc);
  for (let i = 0; i < outLen; i++) {
    const t = i * ratio;
    const c = Math.floor(t);
    let sum = 0, wsum = 0;
    const k0 = Math.max(0, c - width + 1), k1 = Math.min(x.length - 1, c + width);
    for (let k = k0; k <= k1; k++) {
      const dt = t - k;
      const d = dt * fc;
      const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const v = s * (0.5 + 0.5 * Math.cos((Math.PI * dt) / width));
      sum += x[k] * v;
      wsum += v;
    }
    y[i] = wsum ? sum / wsum : 0;
  }
  return y;
}

function lowpass(x, rate, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / rate);
  let y = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(x, rate, fc) {
  const lp = lowpass(x, rate, fc);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - lp[i];
  return out;
}

function peak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > p) p = v;
  }
  return p;
}

function fades(x, rate, fin, fout) {
  const ni = Math.min(x.length, Math.floor(fin * rate));
  const no = Math.min(x.length, Math.floor(fout * rate));
  for (let i = 0; i < ni; i++) x[i] *= i / ni;
  for (let i = 0; i < no; i++) x[x.length - 1 - i] *= i / no;
  return x;
}

// Nahtlose Schleife: Länge L, Ende wird per Equal-Power in den Anfang überblendet
function makeLoop(seg, rate, loopSec, xfadeSec) {
  const L = Math.min(Math.floor(loopSec * rate), seg.length - Math.floor(xfadeSec * rate));
  const X = Math.floor(xfadeSec * rate);
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = seg[i];
  for (let i = 0; i < X; i++) {
    const a = i / X;
    out[i] = seg[i] * Math.sqrt(a) + seg[L + i] * Math.sqrt(1 - a);
  }
  return out;
}

function writeWav(file, x, rate) {
  const n = x.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const dither = (Math.random() - Math.random()) / 32768;
    const v = Math.max(-1, Math.min(1, x[i] + dither));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

// ---------- Scan ----------
function scan(file, maxSec) {
  const w = openWav(file);
  console.log(path.basename(file));
  console.log(`  ${w.fmt.rate} Hz, ${w.fmt.channels} Kanäle, ${w.fmt.bits} Bit (Tag ${w.fmt.tag}), ${w.duration.toFixed(2)} s`);
  const dur = Math.min(w.duration, maxSec || 60);
  const x = readMono(w, 0, dur);
  const win = Math.floor(w.fmt.rate * 0.05);
  const env = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let p = 0;
    for (let k = i; k < i + win; k++) p = Math.max(p, Math.abs(x[k]));
    env.push(p);
  }
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
  // Übersicht pro Sekunde: Spitzenpegel
  const perSec = [];
  for (let s = 0; s < env.length; s += 20) perSec.push(Math.round(db(Math.max(...env.slice(s, s + 20)))));
  console.log('  Pegel je Sekunde (dBFS):', perSec.join(' '));
  // Einsätze: Fenster deutlich lauter als das vorherige
  const on = [];
  for (let i = 1; i < env.length; i++) {
    if (db(env[i]) > -40 && db(env[i]) - db(env[i - 1]) > 9) on.push(`${(i * 0.05).toFixed(2)}s(${Math.round(db(env[i]))})`);
  }
  console.log('  Einsätze:', on.slice(0, 60).join(' ') || '-');
  fs.closeSync(w.fd);
}

// ---------- Auswahl ----------
// src: Datei, start/dur in Sekunden, gain, at = Versatz im Ergebnis (Sekunden)
const ONE = 32000; // Abtastrate für Einzelklänge
const AMB = 22050; // Abtastrate für Schleifen und tiefe Klänge

const F = {
  growl: B2 + '/Epic Stock Media - Halloween Game - Haunted House and Horror Audio Scare Kit/CREABeast_Creature Werewolf Growl Menacing Monstrous 06_ESM_HALG.wav',
  whisperScare: B2 + '/Epic Stock Media - Halloween Game - Haunted House and Horror Audio Scare Kit/DSGNEthr_Jumpscare Vocal Aggressive Whisper Harsh Distortion 02_ESM_HALG.wav',
  goreHit: B2 + '/Epic Stock Media - Halloween Game - Haunted House and Horror Audio Scare Kit/GORESplt_Gore Designed Transient Heavy Impact Smash 01_ESM_HALG.wav',
  seaBeast: B2 + '/Epic Stock Media - Humanoid Creatures Vol 4 - Monstrous and Undead Creature Vocalization Sound Sets/CREAMnstr_Designed Sea Beast Creature Pain Intense Yell Long 04_ESM_HC4.wav',
  insectAttack: B5 + '/SoundBits - Vox Bestiae - Source Elements/CREAInsc_Insectoid Creature Tremble Attack Long 1_SNDBTS_VB-SE.wav',
  paperA4: B2 + '/Cinematic Sound Design - Paper Foley/A4 Printing Paper Rattle Page Turn Tail.wav',
  pageTurn: B2 + '/Cinematic Sound Design - Paper Foley/Encyclopedia Glossy Page Turn Muted.wav',
  coins: B2 + '/Cinematic Sound Design - UI Interaction Elements/Ting Coins.wav',
  roomtone: B2 + '/Cinematic Sound Design - Sci-Fi Drones/Roomtone Space Ship Interior Muted.wav',
  industrial: B2 + '/Cinematic Sound Design - Sci-Fi Drones/Dark Industrial Ambience.wav',
  mystic: B2 + '/Epic Stock Media - Strange Game Ambient Loops 3/DSGNSynth_Dark Loop Mystic Forest Tonal Steady Synth_ESM_SGA3.wav',
  shimmer: B2 + '/Epic Stock Media - Strange Game Ambient Loops 3/MAGShim_Shimmer Loop Small Bell Metal Taps_ESM_SGA3.wav',
  boom: B2 + '/Federico Soler - Effective Trailer Booms Vol. 2/EffectiveTrailer_Booms_Vol2_075.wav',
  evilSpell: B1 + '/344 Audio - Ghostly Presences Vol. 1/AMBDsgn_Evil Spell Ambience_344 Audio_Ghostly Presences.wav',
  breathing: B1 + '/344 Audio - Haunting Ambiences Vol. 5/HMNBrth_Respirator, Specimen Breathing, Mad Scientist Lab_344 Audio_Haunting Ambiences Vol 5.wav',
  woodHit: B1 + "/344 Audio - Haunting Ambiences Vol. 3/WOODImpt_Wooden Hit, Dark, Heavy Hit, Vampire's Prison_344 Audio_Haunting Ambiences Vol 3.wav",
  typeKey: B1 + '/344 Audio - Antique Typewriter/COMType_Typewriter Space Key, Typewriter 05_344 Audio_Antiques - Typewriter.wav',
  clock: B1 + '/344 Audio - Antique Clocks/CLOCKTick_Crooked Antique Clock_344 Audio_Antique Clocks.wav',
  bassDrop: B1 + '/344 Audio - Bass Drops & Downers Vol. 1/DSGNBass_Bass Drop & Downer Fast 16_344 Audio_Bass Drops & Downers.wav',
  whistleDry: B3 + '/InMotionAudio - The Death Whistle/CREAEthr_Aztec Death Whistle DryPitch12_IMA_Death Whistle Samples.wav',
  whistleDist: B3 + '/InMotionAudio - The Death Whistle/CREAEthr_Aztec Death Whistle Distortion_02_IMA_Death Whistle Samples.wav',
  nailScratch: B3 + '/InMotionAudio - Sinister Textures 5/GOREMisc_Cladding_NailScratch19_InMotionAudio_SinisterTextures5.wav',
  fridgeHum: B3 + '/Jake Fielding - Fridge Hums Vol.2/MACHAppl_Deep Fridge Hum, Buzz, Electric Tone, Deep_Jake Fielding_Fridge Hums Pt2.wav',
  thunder: B3 + '/Jake Fielding - Interior Wind Rain and Storms/THUN_Interior Thunder Rumble_JF_INT Storm_01.wav',
  braam: B3 + '/Jake Fielding - Cinematic Horn Braams/DSGNBram____Cinematic Horn Braam, Epic, Cinematic, Dark, Instrument, Huge-67.wav',
  bell: B3 + '/Ivo Vicic - Church Bells/04 Church Bells, Near Distance, In Church Tower-3 Different Bell 02.wav',
  laugh: B5 + '/SoundBits - Vox Hominis - Human Effort Voices/VOXLaff_Laughing Female 02 06_SNDBTS_VH.wav',
  glitch: B5 + '/The Noisery - Rich Glitch/UIGlitch_User interface_Glitch_High_Electronic_The Noisery_Rich Glitch_05.wav',
};

const SAMPLES = [
  // --- Oberfläche ---
  { name: 'click', volume: 1, out: 'click.ogg', copy: KEN + '/UI Audio/Audio/click1.ogg' },
  { name: 'hover', volume: 0.35, out: 'hover.ogg', copy: KEN + '/UI Audio/Audio/rollover2.ogg' },
  { name: 'whoosh', volume: 0.5, out: 'whoosh.ogg', copy: KEN + '/Foley Sounds/Audio/Woosh/woosh2.ogg' },
  { name: 'lock', volume: 0.55, out: 'lock.wav', dur: 1.9, fadeOut: 0.7, src: [{ file: F.woodHit, start: 20.8 }] },
  { name: 'correct', volume: 0.45, out: 'correct.wav', dur: 1.5, fadeIn: 0.01, fadeOut: 0.8, src: [{ file: F.shimmer, start: 33.8 }] },
  { name: 'wrong', volume: 0.22, out: 'wrong.wav', dur: 1.9, fadeOut: 0.3, src: [{ file: F.bassDrop, start: 0.1 }] },
  { name: 'tick', volume: 0.3, out: 'tick.wav', dur: 0.3, fadeIn: 0.002, fadeOut: 0.08, src: [{ file: F.clock, start: 0.98 }] },
  { name: 'tickUrgent', volume: 0.5, rate: 1.12, out: 'tick-urgent.wav', dur: 0.3, fadeIn: 0.002, fadeOut: 0.08, src: [{ file: F.clock, start: 4.02 }] },
  { name: 'reveal', volume: 0.4, out: 'reveal.wav', dur: 3.4, fadeIn: 0.01, fadeOut: 1.5, src: [{ file: F.bell, start: 15.15 }] },
  { name: 'pop', volume: 0.35, out: 'pop.wav', dur: 1.05, fadeOut: 0.2, src: [{ file: F.coins, start: 0 }] },
  { name: 'type', volume: 0.3, jitter: 0.08, out: 'type.wav', dur: 0.37, fadeIn: 0.002, fadeOut: 0.1, src: [{ file: F.typeKey, start: 0.03 }] },
  { name: 'buzz', volume: 0.35, out: 'buzz.wav', dur: 0.55, fadeOut: 0.2, src: [{ file: F.nailScratch, start: 0 }] },
  { name: 'join', volume: 0.45, rate: 0.82, reverb: 0.4, out: 'join.wav', dur: 0.62, fadeOut: 0.1, src: [{ file: F.laugh, start: 0.08 }] },
  { name: 'pickup', volume: 0.6, out: 'pickup.wav', dur: 1.0, fadeOut: 0.3, src: [{ file: F.paperA4, start: 0.05 }] },
  // --- Effekte ---
  { name: 'thunder', volume: 0.7, out: 'thunder.wav', rate: AMB, dur: 9, fadeIn: 0.4, fadeOut: 3, src: [{ file: F.thunder, start: 3.0 }] },
  { name: 'fanfare', volume: 0.55, out: 'fanfare.wav', rate: AMB, dur: 8, fadeOut: 1.5, src: [{ file: F.braam, start: 0 }] },
  { name: 'boom', volume: 0.6, out: 'boom.wav', rate: AMB, dur: 3.2, fadeOut: 1.5, src: [{ file: F.boom, start: 0.2 }] },
  { name: 'scream', volume: 0.35, reverb: 0.5, out: 'scream.wav', dur: 1.6, lowpass: 5000, fadeOut: 0.3, src: [{ file: F.whistleDry, start: 0 }] },
  { name: 'jumpscare', volume: 0.9, out: 'jumpscare.wav', dur: 2.65, fadeOut: 0.4,
    src: [{ file: F.goreHit, start: 0, dur: 1.8, gain: 0.9 }, { file: F.whisperScare, start: 0.05, dur: 2.6, at: 0.02 }] },
  // --- Hintergrund-Schleifen ---
  { name: 'lobby', volume: 0.2, loop: true, out: 'amb-lobby.wav', src: [{ file: F.mystic, start: 10 }], xfade: 2, loopSec: 20 },
  { name: 'board', volume: 0.22, loop: true, out: 'amb-board.wav', src: [{ file: F.evilSpell, start: 8 }], xfade: 2, loopSec: 24 },
  { name: 'tension', volume: 0.18, loop: true, out: 'amb-tension.wav', src: [{ file: F.industrial, start: 2 }], xfade: 1.5, loopSec: 18 },
  { name: 'backrooms', volume: 0.2, loop: true, out: 'amb-backrooms.wav', xfade: 1, loopSec: 16,
    src: [{ file: F.roomtone, start: 20 }, { file: F.fridgeHum, start: 60, gain: 0.6 }] },
  // --- Backrooms-Minispiel ---
  { name: 'br_hum', volume: 0.3, loop: true, out: 'br-hum.wav', src: [{ file: F.fridgeHum, start: 30 }], xfade: 1, loopSec: 10 },
  { name: 'br_step', volume: 0.5, jitter: 0.08, variants: [0, 1, 2, 3, 4].map((i) => ({ out: `br-step-${i}.ogg`, copy: `${KEN}/Impact Sounds/Audio/footstep_carpet_00${i}.ogg` })) },
  { name: 'br_growl', volume: 0.8, out: 'br-growl.wav', dur: 3.4, fadeOut: 0.8, src: [{ file: F.growl, start: 0.12 }] },
  { name: 'br_heartbeat', volume: 0.8, out: 'br-heartbeat.wav', rate: AMB, synth: 'heartbeat', dur: 0.9 },
  { name: 'br_scream', volume: 0.3, reverb: 0.5, out: 'br-scream.wav', dur: 1.72, lowpass: 2200, fadeOut: 0.3, src: [{ file: F.whistleDist, start: 0 }] },
  { name: 'br_paper', volume: 0.7, out: 'br-paper.wav', dur: 0.45, fadeOut: 0.1, src: [{ file: F.pageTurn, start: 0.1 }] },
  { name: 'br_static', volume: 0.5, loop: true, out: 'br-static.wav', rate: ONE, src: [{ file: F.glitch, start: 8 }], xfade: 0.4, loopSec: 3 },
  { name: 'br_jumpscare', volume: 0.9, out: 'br-jumpscare.wav', dur: 2.45, fadeOut: 0.4,
    src: [{ file: F.seaBeast, start: 0.08, dur: 2.4 }, { file: F.goreHit, start: 0, dur: 1.8, gain: 0.7 }] },
  { name: 'br_breath', volume: 0.6, loop: true, out: 'br-breath.wav', src: [{ file: F.breathing, start: 3.1 }], xfade: 1, loopSec: 8 },
  // Wut-Schrei, wenn das Monster eine Stufe wütender wird: fern und verhallt, damit er nicht nach Jumpscare klingt
  { name: 'br_rage', volume: 0.7, reverb: 0.6, out: 'br-rage.wav', dur: 3.2, lowpass: 2600, fadeIn: 0.05, fadeOut: 0.9,
    src: [{ file: F.seaBeast, start: 1.5, dur: 3.2 }, { file: F.insectAttack, start: 0.5, dur: 1.9, gain: 0.45, at: 0.15 }] },
  { name: 'br_whisper', volume: 0.3, reverb: 0.5, out: 'br-whisper.wav', dur: 2.0, lowpass: 3200, fadeIn: 0.15, fadeOut: 0.5, src: [{ file: F.whisperScare, start: 0.1 }] },
];

// Herzschlag gibt es in der Bibliothek nicht → zwei tiefe Schläge synthetisieren
function synthHeartbeat(rate, dur) {
  const x = new Float32Array(Math.floor(rate * dur));
  const beat = (t0, amp) => {
    for (let i = Math.floor(t0 * rate); i < x.length; i++) {
      const t = i / rate - t0;
      if (t > 0.35) break;
      const f = 38 + 34 * Math.exp(-t * 18);
      const env = Math.min(1, t / 0.006) * Math.exp(-t * 14);
      x[i] += amp * env * Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * 9 * t) * 0.3);
    }
  };
  beat(0.02, 1);
  beat(0.29, 0.72);
  return x;
}

function build(only) {
  fs.mkdirSync(OUT, { recursive: true });
  const manifestFile = path.join(OUT, 'sounds.json');
  const manifest = only && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  let total = 0;
  for (const s of SAMPLES) {
    if (only && !only.includes(s.name)) continue;
    const files = [];
    for (const v of s.variants || [s]) {
      const outName = v.out;
      if (v.copy) {
        fs.copyFileSync(v.copy, path.join(OUT, outName));
        total += fs.statSync(path.join(OUT, outName)).size;
        files.push(outName);
        continue;
      }
      const rate = typeof v.rate === 'number' && v.rate > 1000 ? v.rate : s.loop ? AMB : ONE;
      const len = v.loopSec ? v.loopSec + (v.xfade || 1) : v.dur;
      let mix = new Float32Array(Math.ceil((len + 0.01) * rate));
      if (v.synth === 'heartbeat') mix = synthHeartbeat(rate, len);
      for (const src of v.src || []) {
        const w = openWav(src.file);
        let x = readMono(w, src.start || 0, src.dur || len);
        fs.closeSync(w.fd);
        x = resample(x, w.fmt.rate, rate);
        const at = Math.floor((src.at || 0) * rate);
        const g = src.gain == null ? 1 : src.gain;
        for (let i = 0; i < x.length && at + i < mix.length; i++) mix[at + i] += x[i] * g;
      }
      if (v.highpass) mix = highpass(mix, rate, v.highpass);
      if (v.lowpass) mix = lowpass(mix, rate, v.lowpass);
      if (v.loopSec) mix = makeLoop(mix, rate, v.loopSec, v.xfade || 1);
      else fades(mix, rate, v.fadeIn == null ? 0.004 : v.fadeIn, v.fadeOut == null ? 0.05 : v.fadeOut);
      const p = peak(mix);
      const target = v.norm == null ? 0.89 : v.norm;
      if (p > 0) for (let i = 0; i < mix.length; i++) mix[i] *= target / p;
      total += writeWav(path.join(OUT, outName), mix, rate);
      files.push(outName);
    }
    const entry = { file: files.length === 1 ? files[0] : files, volume: s.volume };
    if (s.loop) entry.loop = true;
    if (s.rate && s.rate < 10) entry.rate = s.rate; // Wiedergabetempo (nicht Abtastrate)
    if (s.reverb) entry.reverb = s.reverb;
    if (s.jitter) entry.jitter = s.jitter;
    manifest[s.name] = entry;
    console.log('  ✓', s.name.padEnd(14), files.join(', '));
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Fertig: ${Object.keys(manifest).length} Klänge, ${(total / 1024 / 1024).toFixed(2)} MB`);
}

if (process.argv[2] === '--scan') {
  scan(process.argv[3], Number(process.argv[4]) || 60);
} else if (process.argv[2] === '--only') {
  build(String(process.argv[3] || '').split(','));
} else {
  build();
}
