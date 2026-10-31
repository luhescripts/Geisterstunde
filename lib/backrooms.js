'use strict';

/**
 * Backrooms-Minispiel: serverseitige Simulation.
 * Karte, Monster-KI, Zettel und Fang-Logik laufen hier; die Clients bewegen sich
 * lokal und schicken ihre Position ('br:pos'), der Server prüft grob und korrigiert.
 *
 * Events an die Clients (alle mit Präfix br:):
 *   br:init    – Antwort auf 'br:ready' (vom Room verschickt, Inhalt aus getInitFor)
 *   br:snap    – Zustand ~20 Hz: { t, ph, ce, ea, r, p: [[id,x,y,a,flags,notes]], m: [[id,x,y,a,state]] } (r = Wut 0–1)
 *   br:note    – { t: 'take', id, by, n, text } | { t: 'spawn', id, x, y }
 *   br:caught  – { pid, mid, lost, n, x, y }
 *   br:rage    – { lvl, r } das Monster wird eine Stufe wütender (lvl 1–5, r 0–1)
 *   br:join    – { p: { id, name, teamId, color, x, y, a, notes } }
 *   br:awake   – Countdown vorbei, die Monster sind wach
 *   br:correct – nur an einen Spieler: { x, y } (Position wurde abgelehnt)
 *   br:end     – { reason: 'time' | 'notes' | 'forced', results }
 */

const MAP_W = 41;
const MAP_H = 41;
const TICK_MS = 50;
const PLAYER_RADIUS = 0.22;
const MONSTER_RADIUS = 0.28;
const WALK_SPEED = 3.0;
const SPRINT_SPEED = 4.6;
const CATCH_DIST = 0.75;
const PICKUP_DIST = 0.6;
const STUN_MS = 6000;
const INVULN_MS = 4000;
const REST_MS = 3000;
const IDLE_MS = 3000;
const SIGHT_RANGE = 10;
const NOISE_RANGE = 14;
const MEMORY_MS = 4000;
// Wut: Jeder gefundene Zettel macht das Monster etwas schneller und aufmerksamer.
// Voll ausgereizt ist sie, wenn im Schnitt jeder Spieler RAGE_NOTES_PER_PLAYER Zettel gefunden hat.
const RAGE_NOTES_PER_PLAYER = 4;
const RAGE_LEVELS = 5;
const HUNT_MAX = 4.2; // bleibt unter SPRINT_SPEED, Wegrennen muss möglich bleiben

// Flags im Snapshot
const F_STUNNED = 1;
const F_INVULN = 2;
const F_SPRINT = 4;
const F_IDLE = 8;

const MONSTER_STATE = { sleep: 0, wander: 1, hunt: 2, rest: 3 };

const NOTE_TEXTS = [
  'Es hört dich, wenn du rennst.',
  'Level 0 hat keinen Ausgang.',
  'Wenn das Summen aufhört: lauf.',
  'Zähl nicht die Lampen. Sie zählen dich.',
  'Ich bin seit drei Tagen hier. Oder drei Jahren?',
  'Warum ist der Teppich nass?',
  'Folge nicht dem Lachen.',
  'Hinter dir.',
  'Die Wände sind gelb. Immer gelb. IMMER GELB.',
  'Es hat keine Augen. Nur Licht, wo Augen sein sollten.',
  'Ich habe den Ausgang gefunden. Er war eine Wand.',
  'Wer das liest, ist nicht allein.',
  'Bleib in Bewegung. Es mag keinen Stillstand.',
  'Mein Name war … ich weiß es nicht mehr.',
  'Die Neonröhren flüstern, wenn es näher kommt.',
  'Nicht schreien. Es liebt Schreie.',
  'Dieser Raum war gestern noch nicht da.',
  'Sammle die Zettel. Sie sind das Einzige, was echt ist.',
  'Ich höre Schritte. Meine eigenen sind es nicht.',
  'Du bist zu weit gegangen. Hier ist niemand.',
  'Es schläft nie. Es wartet nur.',
  'Klopf, klopf. Mach nicht auf.',
];

function mulberry32(seed) {
  let a = seed | 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function wrapAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * Level 0: Labyrinth (Backtracker) mit vielen entfernten Wandstücken (braided),
 * dazu offene Hallen mit Säulen und eine Spawn-Halle in der Mitte.
 * 1 = Wand, 0 = Boden. Unerreichbare Bodenzellen werden zu Wand.
 */
function generateMap(seed) {
  const rnd = mulberry32(seed);
  const W = MAP_W;
  const H = MAP_H;
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;

  // 1) Labyrinth auf den ungeraden Koordinaten
  const NX = (W - 1) / 2;
  const NY = (H - 1) / 2;
  const seen = new Uint8Array(NX * NY);
  const stack = [0];
  seen[0] = 1;
  grid[at(1, 1)] = 0;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % NX;
    const cy = (cur / NX) | 0;
    const opts = [];
    if (cx > 0 && !seen[cur - 1]) opts.push(cur - 1);
    if (cx < NX - 1 && !seen[cur + 1]) opts.push(cur + 1);
    if (cy > 0 && !seen[cur - NX]) opts.push(cur - NX);
    if (cy < NY - 1 && !seen[cur + NX]) opts.push(cur + NX);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const nxt = opts[(rnd() * opts.length) | 0];
    const nx = nxt % NX;
    const ny = (nxt / NX) | 0;
    seen[nxt] = 1;
    grid[at(cx + nx + 1, cy + ny + 1)] = 0;
    grid[at(2 * nx + 1, 2 * ny + 1)] = 0;
    stack.push(nxt);
  }

  // 2) Braiding: viele Wandstücke zwischen zwei Knoten entfernen -> Schleifen
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[at(x, y)] !== 1) continue;
      if ((x & 1) === (y & 1)) continue; // Knoten- oder Säulenposition
      if (rnd() < 0.38) grid[at(x, y)] = 0;
    }
  }

  // 3) Hallen mit Säulen
  const carve = (x0, y0, x1, y1, pillarChance) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[at(x, y)] = 0;
    if (pillarChance <= 0) return;
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = x0 + 1; x < x1; x++) {
        if ((x & 1) === 0 && (y & 1) === 0 && rnd() < pillarChance) grid[at(x, y)] = 1;
      }
    }
  };
  const c = (W - 1) / 2;
  for (let i = 0; i < 8; i++) {
    const rw = 5 + 2 * ((rnd() * 3) | 0);
    const rh = 5 + 2 * ((rnd() * 3) | 0);
    const x0 = 1 + 2 * ((rnd() * ((W - 1 - rw) / 2)) | 0);
    const y0 = 1 + 2 * ((rnd() * ((H - 1 - rh) / 2)) | 0);
    carve(x0, y0, x0 + rw - 1, y0 + rh - 1, 0.45);
  }
  carve(c - 3, c - 3, c + 3, c + 3, 0); // Spawn-Halle

  // 4) Rand
  for (let x = 0; x < W; x++) {
    grid[at(x, 0)] = 1;
    grid[at(x, H - 1)] = 1;
  }
  for (let y = 0; y < H; y++) {
    grid[at(0, y)] = 1;
    grid[at(W - 1, y)] = 1;
  }

  // 5) Sackgassen öffnen
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      if (grid[at(x, y)]) continue;
      const closed = [];
      let open = 0;
      const check = (nx, ny) => {
        if (!grid[at(nx, ny)]) open++;
        else if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) closed.push(at(nx, ny));
      };
      check(x - 1, y);
      check(x + 1, y);
      check(x, y - 1);
      check(x, y + 1);
      if (open <= 1 && closed.length) grid[closed[(rnd() * closed.length) | 0]] = 0;
    }
  }

  // 6) Zusammenhang sicherstellen
  const reach = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const start = at(c, c);
  reach[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    const x = cur % W;
    const nbs = [x > 0 ? cur - 1 : -1, x < W - 1 ? cur + 1 : -1, cur - W, cur + W];
    for (const n of nbs) {
      if (n < 0 || n >= W * H || reach[n] || grid[n]) continue;
      reach[n] = 1;
      queue[tail++] = n;
    }
  }
  for (let i = 0; i < W * H; i++) if (!grid[i] && !reach[i]) grid[i] = 1;

  return { grid, spawn: { x: c + 0.5, y: c + 0.5 } };
}

class BackroomsGame {
  constructor(opts = {}) {
    this.emit = typeof opts.emit === 'function' ? opts.emit : () => {};
    this.emitTo = typeof opts.emitTo === 'function' ? opts.emitTo : () => {};
    this.onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : () => {};
    this.durationSec = Number(opts.durationSec) > 0 ? Number(opts.durationSec) : 150;
    this.countdownSec = Number.isFinite(Number(opts.countdownSec)) ? Math.max(0, Number(opts.countdownSec)) : 5;
    this.seed = Number.isFinite(opts.seed) ? opts.seed | 0 : (Math.random() * 2147483647) | 0;
    this.rnd = mulberry32(this.seed ^ 0x5f3759df);

    const map = generateMap(this.seed);
    this.grid = map.grid;
    this.spawn = map.spawn;
    this.gridString = Array.from(this.grid, (v) => (v ? '#' : '.')).join('');
    this.floorCells = [];
    for (let i = 0; i < this.grid.length; i++) if (!this.grid[i]) this.floorCells.push(i);

    this._dist = new Int16Array(MAP_W * MAP_H);
    this._par = new Int32Array(MAP_W * MAP_H);
    this._queue = new Int32Array(MAP_W * MAP_H);

    // Distanzfeld ab Spawn (für Platzierung)
    this._bfs(this._cellIdx(this.spawn.x, this.spawn.y));
    this.spawnDist = Int16Array.from(this._dist);

    this.players = new Map();
    this.monsters = [];
    this.notes = new Map();
    this.noteSeq = 0;
    this.textDeck = [];
    this.phase = 'idle';
    this.ended = false;
    this.timer = null;
    this.countdownEnd = 0;
    this.endAt = 0;

    (opts.players || []).forEach((p) => this._createPlayer(p));
    this.totalNotes = Math.max(14, 2 * this.players.size + 8);
    this.collected = 0;
    this._placeNotes(this.totalNotes);
    this._placeMonsters(this.players.size <= 6 ? 1 : 2);
  }

  // ---------------------------------------------------------------- Lebenszyklus

  start() {
    if (this.phase !== 'idle') return;
    const now = Date.now();
    this.startedAt = now;
    this.countdownEnd = now + this.countdownSec * 1000;
    this.endAt = this.countdownEnd + this.durationSec * 1000;
    this.phase = this.countdownSec > 0 ? 'countdown' : 'running';
    if (this.phase === 'running') this._wakeMonsters();
    for (const p of this.players.values()) p.lastInputAt = now;
    this.lastTick = now;
    this.timer = setInterval(() => this._tick(), TICK_MS);
    this._broadcastSnap(now);
  }

  forceEnd() {
    if (this.ended) return;
    this._end('forced');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ended = true;
    this.phase = 'stopped';
  }

  addPlayer(p) {
    if (!p || p.id == null) return;
    const existing = this.players.get(p.id);
    if (existing) {
      if (p.name != null) existing.name = String(p.name);
      if (p.teamId != null) existing.teamId = p.teamId;
      if (p.color) existing.color = p.color;
      existing.lastInputAt = Date.now();
      return;
    }
    const pl = this._createPlayer(p);
    const now = Date.now();
    pl.lastInputAt = now;
    pl.invulnUntil = now + 3000;
    this.emit('br:join', { p: this._publicPlayer(pl) });
  }

  getInitFor(playerId) {
    const now = Date.now();
    const you = playerId != null && this.players.has(playerId) ? playerId : null;
    const countdownEnd = this.countdownEnd || now + this.countdownSec * 1000;
    return {
      you,
      spectator: you == null,
      w: MAP_W,
      h: MAP_H,
      seed: this.seed,
      grid: this.gridString,
      spawn: { x: this.spawn.x, y: this.spawn.y },
      players: [...this.players.values()].map((p) => this._publicPlayer(p, now)),
      monsters: this.monsters.map((m) => ({ id: m.id, x: r2(m.x), y: r2(m.y), a: r2(m.a), st: MONSTER_STATE[m.state] })),
      notes: [...this.notes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y })),
      phase: this.phase,
      now,
      countdownEnd,
      endAt: this.endAt || countdownEnd + this.durationSec * 1000,
      durationSec: this.durationSec,
      totalNotes: this.totalNotes,
      rage: r2(this._rage()),
      rules: {
        walk: WALK_SPEED,
        sprint: SPRINT_SPEED,
        radius: PLAYER_RADIUS,
        stunMs: STUN_MS,
        invulnMs: INVULN_MS,
        noteTeamPoints: 25,
        topBonusPerNote: 50,
      },
    };
  }

  input(playerId, d) {
    try {
      const p = this.players.get(playerId);
      if (!p || !d || typeof d !== 'object') return;
      if (this.phase !== 'countdown' && this.phase !== 'running') return;
      const now = Date.now();
      p.lastInputAt = now;
      const a = Number(d.a);
      if (Number.isFinite(a)) p.a = wrapAngle(a);
      p.sprint = !!d.s;
      const x = Number(d.x);
      const y = Number(d.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      if (this.phase !== 'running' || p.stunUntil > now) {
        p.sprint = false;
        if (Math.hypot(x - p.x, y - p.y) > 0.25) this.emitTo(p.id, 'br:correct', { x: r2(p.x), y: r2(p.y) });
        p.lastMoveAt = now;
        return;
      }

      const dtIn = clamp((now - (p.lastMoveAt || now - TICK_MS)) / 1000, 0.05, 1);
      const maxD = SPRINT_SPEED * 1.35 * dtIn + 0.35;
      const dist = Math.hypot(x - p.x, y - p.y);
      if (dist > maxD || this._blocked(x, y, PLAYER_RADIUS * 0.8) || !this._segmentClear(p.x, p.y, x, y)) {
        this.emitTo(p.id, 'br:correct', { x: r2(p.x), y: r2(p.y) });
        p.lastMoveAt = now;
        return;
      }
      p.x = x;
      p.y = y;
      p.lastMoveAt = now;
      this._checkPickupsFor(p, now);
    } catch (e) {
      console.error('[backrooms] input', e);
    }
  }

  // ---------------------------------------------------------------- Simulation

  _tick() {
    try {
      const now = Date.now();
      const dt = Math.min(0.1, (now - this.lastTick) / 1000);
      this.lastTick = now;
      if (this.phase === 'countdown' && now >= this.countdownEnd) {
        this.phase = 'running';
        this._wakeMonsters();
        this.emit('br:awake', {});
      }
      if (this.phase === 'running') {
        this._updateMonsters(now, dt);
        for (const p of this.players.values()) this._checkPickupsFor(p, now);
        if (this.notes.size === 0) return this._end('notes');
        if (now >= this.endAt) return this._end('time');
      }
      this._broadcastSnap(now);
    } catch (e) {
      console.error('[backrooms] tick', e);
    }
  }

  _end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const results = {
      players: [...this.players.values()]
        .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, notes: p.notes }))
        .sort((a, b) => b.notes - a.notes),
      totalNotes: this.totalNotes,
      reason,
    };
    this._broadcastSnap(Date.now());
    this.emit('br:end', { reason, results });
    try {
      this.onEnd(results);
    } catch (e) {
      console.error('[backrooms] onEnd', e);
    }
  }

  _broadcastSnap(now) {
    const p = [];
    for (const pl of this.players.values()) p.push([pl.id, r2(pl.x), r2(pl.y), r2(pl.a), this._flags(pl, now), pl.notes]);
    const m = this.monsters.map((mo) => [mo.id, r2(mo.x), r2(mo.y), r2(mo.a), MONSTER_STATE[mo.state]]);
    this.emit('br:snap', { t: now, ph: this.phase, ce: this.countdownEnd, ea: this.endAt, r: r2(this._rage()), p, m });
  }

  // ---------------------------------------------------------------- Schwierigkeit

  _rage() {
    return clamp(this.collected / Math.max(12, RAGE_NOTES_PER_PLAYER * this.players.size), 0, 1);
  }

  _rageLevel() {
    return Math.floor(this._rage() * RAGE_LEVELS + 1e-9);
  }

  // Steigt leicht mit der Zeit und vor allem mit jedem gefundenen Zettel.
  difficulty(now = Date.now()) {
    const progress = clamp((now - this.countdownEnd) / (this.durationSec * 1000), 0, 1);
    const rage = this._rage();
    return {
      rage,
      hunt: Math.min(HUNT_MAX, 2.5 + 0.5 * progress + 1.2 * rage),
      wander: 1.5 + 0.3 * progress + 0.7 * rage,
      sight: SIGHT_RANGE + 3 * rage,
      noise: NOISE_RANGE + 6 * rage,
      rest: REST_MS * (1 - 0.5 * rage),
    };
  }

  // Nachschub: Es liegen immer genug Zettel herum, damit es bis zum Schluss etwas zu holen gibt.
  _minNotes() {
    return Math.max(6, this.players.size + 3);
  }

  _flags(pl, now) {
    let f = 0;
    if (pl.stunUntil > now) f |= F_STUNNED;
    if (pl.invulnUntil > now) f |= F_INVULN;
    if (pl.sprint) f |= F_SPRINT;
    if (now - pl.lastInputAt > IDLE_MS) f |= F_IDLE;
    return f;
  }

  _wakeMonsters() {
    for (const m of this.monsters) {
      m.state = 'wander';
      m.goal = null;
    }
  }

  _updateMonsters(now, dt) {
    const diff = this.difficulty(now);
    const huntSpeed = diff.hunt;
    const wanderSpeed = diff.wander;
    const finalMinute = this.endAt - now <= 60000;
    const active = [];
    for (const p of this.players.values()) {
      if (p.stunUntil > now || p.invulnUntil > now || now - p.lastInputAt > IDLE_MS) continue;
      active.push(p);
    }

    for (const m of this.monsters) {
      const mc = this._cellIdx(m.x, m.y);
      this._bfs(mc);
      const resting = m.restUntil > now;

      let target = null;
      let targetSeen = false;
      let targetLoud = false;
      let best = Infinity;
      if (!resting) {
        for (const p of active) {
          const d = this._dist[this._cellIdx(p.x, p.y)];
          if (d < 0) continue;
          const eu = Math.hypot(p.x - m.x, p.y - m.y);
          const seen = eu <= diff.sight && d <= diff.sight + 4 && this._los(m.x, m.y, p.x, p.y);
          const loud = p.sprint && d <= diff.noise;
          const remembered = m.targetId === p.id && now - m.lastSeenAt < MEMORY_MS && d <= 20;
          if (!(seen || loud || finalMinute || remembered)) continue;
          const score = seen ? d : d * 1.15;
          if (score < best) {
            best = score;
            target = p;
            targetSeen = seen;
            targetLoud = loud;
          }
        }
      }

      if (target) {
        const fresh = targetSeen || targetLoud || finalMinute;
        if (fresh || m.targetId !== target.id) {
          m.lastSeenAt = now;
          m.lastKnown = { x: target.x, y: target.y };
        }
        m.targetId = target.id;
        m.state = 'hunt';
        const gx = fresh ? target.x : m.lastKnown.x;
        const gy = fresh ? target.y : m.lastKnown.y;
        const eu = Math.hypot(target.x - m.x, target.y - m.y);
        const direct = targetSeen && eu < 7 && this._fatLos(m.x, m.y, target.x, target.y, 0.24);
        this._moveMonster(m, gx, gy, huntSpeed, dt, direct);
        if (!fresh && Math.hypot(gx - m.x, gy - m.y) < 0.5) m.targetId = null;
      } else {
        m.targetId = null;
        m.state = resting ? 'rest' : 'wander';
        const reached = m.goal && Math.hypot(m.goal.x - m.x, m.goal.y - m.y) < 0.6;
        if (!m.goal || reached || now > m.goalUntil || this._dist[this._cellIdx(m.goal.x, m.goal.y)] < 0) {
          m.goal = this._pickWanderGoal();
          m.goalUntil = now + 10000;
        }
        this._moveMonster(m, m.goal.x, m.goal.y, resting ? wanderSpeed * 0.85 : wanderSpeed, dt, false);
      }

      if (!resting) {
        for (const p of active) {
          if (p.stunUntil > now || p.invulnUntil > now) continue;
          if (Math.hypot(p.x - m.x, p.y - m.y) < CATCH_DIST) {
            this._catch(m, p, now);
            break;
          }
        }
      }
    }
  }

  _pickWanderGoal() {
    const cand = [];
    for (let tries = 0; tries < 60; tries++) {
      const c = this.floorCells[(this.rnd() * this.floorCells.length) | 0];
      const d = this._dist[c];
      if (d >= 8 && d <= 22) return { x: (c % MAP_W) + 0.5, y: ((c / MAP_W) | 0) + 0.5 };
      if (d > 0) cand.push(c);
    }
    const c = cand.length ? cand[(this.rnd() * cand.length) | 0] : this.floorCells[0];
    return { x: (c % MAP_W) + 0.5, y: ((c / MAP_W) | 0) + 0.5 };
  }

  _moveMonster(m, gx, gy, speed, dt, direct) {
    let tx = gx;
    let ty = gy;
    if (!direct) {
      const gc = this._cellIdx(gx, gy);
      const mc = this._cellIdx(m.x, m.y);
      if (this._dist[gc] < 0) return;
      if (gc !== mc) {
        let c = gc;
        let prev = gc;
        let guard = 0;
        while (c !== mc && c >= 0 && guard++ < 5000) {
          prev = c;
          c = this._par[c];
        }
        // Abkürzung: wenn die übernächste Zelle frei sichtbar ist, direkt dorthin
        let next = prev;
        const after = this._nextAfter(gc, prev, mc);
        if (after >= 0) {
          const ax = (after % MAP_W) + 0.5;
          const ay = ((after / MAP_W) | 0) + 0.5;
          if (this._fatLos(m.x, m.y, ax, ay, MONSTER_RADIUS)) next = after;
        }
        tx = (next % MAP_W) + 0.5;
        ty = ((next / MAP_W) | 0) + 0.5;
      }
    }
    const dx = tx - m.x;
    const dy = ty - m.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const step = Math.min(len, speed * dt);
    const sx = (dx / len) * step;
    const sy = (dy / len) * step;
    const ox = m.x;
    const oy = m.y;
    this._moveCollide(m, sx, sy, MONSTER_RADIUS);
    // An Ecken hängengeblieben: Richtung Zellmitte schieben
    if (Math.abs(m.x - ox) + Math.abs(m.y - oy) < step * 0.3) {
      const cx = Math.floor(m.x) + 0.5;
      const cy = Math.floor(m.y) + 0.5;
      this._moveCollide(m, clamp(cx - m.x, -step, step), clamp(cy - m.y, -step, step), MONSTER_RADIUS);
    }
    m.a = Math.atan2(dy, dx);
  }

  // Zelle nach "first" auf dem Pfad vom Monster (mc) zum Ziel (gc)
  _nextAfter(gc, first, mc) {
    if (first === gc) return -1;
    let c = gc;
    let prev = -1;
    let guard = 0;
    while (c !== first && c >= 0 && guard++ < 5000) {
      prev = c;
      c = this._par[c];
    }
    return c === first ? prev : -1;
  }

  _catch(m, p, now) {
    p.stunUntil = now + STUN_MS;
    p.invulnUntil = now + STUN_MS + INVULN_MS;
    p.sprint = false;
    let lost = false;
    if (p.notes > 0) {
      p.notes--;
      lost = true;
    }
    m.restUntil = now + this.difficulty(now).rest;
    m.targetId = null;
    m.goal = null;
    m.state = 'rest';
    this.emit('br:caught', { pid: p.id, mid: m.id, lost, n: p.notes, x: r2(p.x), y: r2(p.y) });
    if (lost) this._spawnNote();
  }

  _checkPickupsFor(p, now) {
    if (this.phase !== 'running' || p.stunUntil > now) return;
    let took = 0;
    for (const n of this.notes.values()) {
      if (Math.abs(n.x - p.x) > PICKUP_DIST || Math.abs(n.y - p.y) > PICKUP_DIST) continue;
      if (Math.hypot(n.x - p.x, n.y - p.y) > PICKUP_DIST) continue;
      this.notes.delete(n.id);
      p.notes++;
      took++;
      this.emit('br:note', { t: 'take', id: n.id, by: p.id, n: p.notes, text: this._nextText() });
    }
    if (!took) return;
    const lvl = this._rageLevel();
    this.collected += took;
    if (this._rageLevel() > lvl) this.emit('br:rage', { lvl: this._rageLevel(), r: r2(this._rage()) });
    while (this.notes.size < this._minNotes()) this._spawnNote();
  }

  _nextText() {
    if (!this.textDeck.length) this.textDeck = shuffle(NOTE_TEXTS.slice(), this.rnd);
    return this.textDeck.pop();
  }

  // ---------------------------------------------------------------- Platzierung

  _createPlayer(p) {
    const i = this.players.size;
    const ang = i * 2.399963;
    const rad = 0.8 + 0.35 * (i % 4);
    let x = this.spawn.x + Math.cos(ang) * rad;
    let y = this.spawn.y + Math.sin(ang) * rad;
    if (this._blocked(x, y, PLAYER_RADIUS)) {
      x = this.spawn.x;
      y = this.spawn.y;
    }
    const pl = {
      id: p.id,
      name: String(p.name ?? 'Spieler'),
      teamId: p.teamId,
      color: p.color || '#efe6d8',
      x,
      y,
      a: wrapAngle(ang),
      sprint: false,
      notes: 0,
      stunUntil: 0,
      invulnUntil: 0,
      lastInputAt: Date.now(),
      lastMoveAt: 0,
    };
    this.players.set(pl.id, pl);
    return pl;
  }

  _publicPlayer(p, now = Date.now()) {
    return {
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      color: p.color,
      x: r2(p.x),
      y: r2(p.y),
      a: r2(p.a),
      notes: p.notes,
      f: this._flags(p, now),
    };
  }

  _placeNotes(n) {
    const cand = shuffle(
      this.floorCells.filter((c) => this.spawnDist[c] >= 6),
      this.rnd,
    );
    const picked = [];
    for (const minD of [3.2, 2.2, 1.2, 0]) {
      for (const c of cand) {
        if (picked.length >= n) break;
        const x = (c % MAP_W) + 0.5;
        const y = ((c / MAP_W) | 0) + 0.5;
        if (picked.some((q) => q.c === c || Math.hypot(q.x - x, q.y - y) < minD)) continue;
        picked.push({ c, x, y });
      }
      if (picked.length >= n) break;
    }
    for (const q of picked) this._addNote(q.x + (this.rnd() - 0.5) * 0.3, q.y + (this.rnd() - 0.5) * 0.3);
  }

  _addNote(x, y) {
    const note = { id: ++this.noteSeq, x: r2(x), y: r2(y) };
    this.notes.set(note.id, note);
    return note;
  }

  _spawnNote() {
    const players = [...this.players.values()];
    const notes = [...this.notes.values()];
    let cell = -1;
    for (let tries = 0; tries < 300; tries++) {
      const c = this.floorCells[(this.rnd() * this.floorCells.length) | 0];
      const x = (c % MAP_W) + 0.5;
      const y = ((c / MAP_W) | 0) + 0.5;
      const minP = tries < 200 ? 6 : 3;
      if (players.some((p) => Math.hypot(p.x - x, p.y - y) < minP)) continue;
      if (notes.some((q) => Math.hypot(q.x - x, q.y - y) < 2.5)) continue;
      cell = c;
      break;
    }
    if (cell < 0) cell = this.floorCells[(this.rnd() * this.floorCells.length) | 0];
    const note = this._addNote((cell % MAP_W) + 0.5, ((cell / MAP_W) | 0) + 0.5);
    this.emit('br:note', { t: 'spawn', id: note.id, x: note.x, y: note.y });
  }

  _placeMonsters(count) {
    const cells = this.floorCells.filter((c) => this.spawnDist[c] > 0).sort((a, b) => this.spawnDist[b] - this.spawnDist[a]);
    const pos = (c) => ({ x: (c % MAP_W) + 0.5, y: ((c / MAP_W) | 0) + 0.5 });
    const chosen = [cells[0]];
    if (count > 1) {
      const top = cells.slice(0, Math.max(10, Math.floor(cells.length * 0.3)));
      let bestC = top[top.length - 1];
      let bestD = -1;
      const p0 = pos(chosen[0]);
      for (const c of top) {
        const p = pos(c);
        const d = Math.hypot(p.x - p0.x, p.y - p0.y);
        if (d > bestD) {
          bestD = d;
          bestC = c;
        }
      }
      chosen.push(bestC);
    }
    this.monsters = chosen.map((c, i) => {
      const p = pos(c);
      return {
        id: 'm' + (i + 1),
        x: p.x,
        y: p.y,
        a: Math.atan2(this.spawn.y - p.y, this.spawn.x - p.x),
        state: 'sleep',
        targetId: null,
        lastSeenAt: 0,
        lastKnown: null,
        restUntil: 0,
        goal: null,
        goalUntil: 0,
      };
    });
  }

  // ---------------------------------------------------------------- Raster-Helfer

  _cellIdx(x, y) {
    const cx = clamp(Math.floor(x), 0, MAP_W - 1);
    const cy = clamp(Math.floor(y), 0, MAP_H - 1);
    return cy * MAP_W + cx;
  }

  _wallAt(x, y) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return true;
    return this.grid[cy * MAP_W + cx] === 1;
  }

  _blocked(x, y, r) {
    return this._wallAt(x - r, y - r) || this._wallAt(x + r, y - r) || this._wallAt(x - r, y + r) || this._wallAt(x + r, y + r);
  }

  _moveCollide(e, dx, dy, r) {
    const nx = e.x + dx;
    if (!this._blocked(nx, e.y, r)) e.x = nx;
    const ny = e.y + dy;
    if (!this._blocked(e.x, ny, r)) e.y = ny;
  }

  _segmentClear(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(len / 0.2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this._wallAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  _los(x0, y0, x1, y1) {
    return this._segmentClear(x0, y0, x1, y1);
  }

  _fatLos(x0, y0, x1, y1, r) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-3) return true;
    const nx = (-(y1 - y0) / len) * r;
    const ny = ((x1 - x0) / len) * r;
    return (
      this._segmentClear(x0, y0, x1, y1) &&
      this._segmentClear(x0 + nx, y0 + ny, x1 + nx, y1 + ny) &&
      this._segmentClear(x0 - nx, y0 - ny, x1 - nx, y1 - ny)
    );
  }

  _bfs(start) {
    const dist = this._dist;
    const par = this._par;
    const q = this._queue;
    const g = this.grid;
    const N = MAP_W * MAP_H;
    dist.fill(-1);
    let head = 0;
    let tail = 0;
    dist[start] = 0;
    par[start] = -1;
    q[tail++] = start;
    while (head < tail) {
      const c = q[head++];
      const d = dist[c] + 1;
      const x = c % MAP_W;
      let n = c - 1;
      if (x > 0 && !g[n] && dist[n] < 0) {
        dist[n] = d;
        par[n] = c;
        q[tail++] = n;
      }
      n = c + 1;
      if (x < MAP_W - 1 && !g[n] && dist[n] < 0) {
        dist[n] = d;
        par[n] = c;
        q[tail++] = n;
      }
      n = c - MAP_W;
      if (n >= 0 && !g[n] && dist[n] < 0) {
        dist[n] = d;
        par[n] = c;
        q[tail++] = n;
      }
      n = c + MAP_W;
      if (n < N && !g[n] && dist[n] < 0) {
        dist[n] = d;
        par[n] = c;
        q[tail++] = n;
      }
    }
  }
}

module.exports = { BackroomsGame, generateMap, MAP_W, MAP_H };
