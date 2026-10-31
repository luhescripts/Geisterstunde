'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MECH, HINTS, applyPuzzleHint, shuffle } = require('./mechanics');
const { cleanName, cleanText } = require('./text');

const VALUES = [200, 300, 400, 600, 800];
const TEAM_COLORS = ['#7cfc5a', '#ff8c1a', '#b26bff', '#5ac8ff', '#ff5c8a', '#ffd24a', '#2ee6c5', '#e8e4f0'];
const TEAM_SIZE = 2;
const TEAM_NAMES = [
  'Die Untoten', 'Kürbisköpfe', 'Hexenzirkel', 'Werwolfrudel', 'Blutsauger',
  'Geisterbahn', 'Die Verfluchten', 'Sensenmänner', 'Gruftis', 'Mitternachtsmeute',
];
const AVATARS = ['🎃', '👻', '💀', '🧛', '🧟', '🦇', '🕷️', '🧙', '🐺', '🤡', '👹', '🕸️', '🧌', '👁️', '🦉', '🐈‍⬛', '⚰️', '🔮', '🩸', '🪦'];
const INTRO_MS = 7000;
const MAX_PLAYERS = 16;
const BR_PER_NOTE = 25;
const BR_KING_PER_NOTE = 50;
const HINT_COST = 200;
const HINTS_PER_TEAM = 3;
const DUEL_STEAL = 300;
const DUEL_MS = { challenge: 30000, fighters: 30000, question: 40000 };

const token = (n = 12) => crypto.randomBytes(n).toString('hex');

class Room {
  constructor({ code, io, questions, saveDir, getPublicUrl }) {
    this.code = code;
    this.io = io;
    this.questions = questions;
    this.saveDir = saveDir;
    this.getPublicUrl = getPublicUrl || (() => null);
    this.hostToken = token(12);
    this.hostSockets = new Set();
    this.players = new Map();
    this.teams = [];
    this.teamCount = 2;
    this.phase = 'lobby';
    this.pageIdx = 0;
    this.resetBoard();
    this.q = null;
    this.qCounter = 0;
    this.pickingTeamId = null;
    this.br = null;
    this.brResults = null;
    this.duelTiles = [];
    this.duelUsed = [];
    this.duel = null;
    this.duelCounter = 0;
    this.log = [];
    this.createdAt = Date.now();
    this.timer = null;
    this.ticker = null;
    this.flushTimer = null;
    this.saveTimer = null;
    this.dirtyAll = false;
    this.dirtyTeams = new Set();
  }

  get pages() {
    return this.questions.pages;
  }

  resetBoard() {
    this.used = this.pages.map(p => p.categories.map(c => c.questions.map(() => false)));
  }

  team(id) {
    return this.teams.find(t => t.id === id) || null;
  }

  membersOf(teamId) {
    return [...this.players.values()].filter(p => p.teamId === teamId).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  activeTeams() {
    return this.teams.filter(t => this.membersOf(t.id).some(p => p.connected));
  }

  // ---------- Verbindungen ----------

  attachHost(socket) {
    this.hostSockets.add(socket.id);
    socket.data.room = this;
    socket.data.role = 'host';
    socket.join(this.code);
    socket.join(`${this.code}:host`);
    socket.emit('chat:hostHistory', this.hostChatHistory());
  }

  join(socket, d) {
    const name = cleanName(d && d.name);
    let p = null;
    if (d && d.playerId && d.secret) {
      const known = this.players.get(d.playerId);
      if (known && known.secret === d.secret) p = known;
    }
    if (!p) {
      if (!name) return { error: 'Bitte gib einen Namen ein.' };
      const same = [...this.players.values()].find(x => x.name.toLowerCase() === name.toLowerCase());
      if (same && !same.connected) p = same;
      else if (same) return { error: 'Der Name ist schon vergeben – nimm einen anderen.' };
      else {
        if (this.players.size >= MAX_PLAYERS) return { error: 'Der Raum ist voll.' };
        p = this.addPlayer(name);
        this.toast(`${p.avatar} ${p.name} ist beigetreten`, null, 'join');
      }
    }
    this.attachPlayer(socket, p);
    this.markDirty();
    return { playerId: p.id, secret: p.secret, code: this.code, name: p.name };
  }

  addPlayer(name) {
    const used = new Set([...this.players.values()].map(p => p.avatar));
    const free = AVATARS.filter(a => !used.has(a));
    const p = {
      id: token(6),
      secret: token(12),
      name,
      avatar: (free.length ? free : AVATARS)[Math.floor(Math.random() * (free.length || AVATARS.length))],
      teamId: null,
      connected: false,
      sockets: new Set(),
      joinedAt: Date.now(),
      lastChat: 0,
    };
    this.players.set(p.id, p);
    if (this.teams.length) this.assignLate(p);
    return p;
  }

  // Nachzügler füllen zuerst ein Einzelteam auf. Vor Spielbeginn bekommen sie sonst ein eigenes Team,
  // im laufenden Spiel kommen sie ins kleinste Team (neue Teams mitten im Spiel wären unfair).
  assignLate(p) {
    const sizes = this.teams.map(t => ({ t, n: this.membersOf(t.id).filter(m => m !== p).length }));
    const min = Math.min(...sizes.map(s => s.n));
    if (min >= TEAM_SIZE && this.phase === 'teams' && this.teams.length < TEAM_COLORS.length) {
      const team = this.newTeam(this.teams.length, this.freeTeamName());
      this.teams.push(team);
      p.teamId = team.id;
      return;
    }
    const pick = shuffle(sizes.filter(s => s.n === min))[0];
    p.teamId = pick.t.id;
    if (this.q && this.q.teams[p.teamId] && !this.q.captains[p.teamId]) this.q.captains[p.teamId] = p.id;
  }

  freeTeamName() {
    const used = new Set(this.teams.map(t => t.name));
    return shuffle(TEAM_NAMES).find(n => !used.has(n)) || `Team ${this.teams.length + 1}`;
  }

  newTeam(i, name, chat = []) {
    return {
      id: `t${i}`,
      name,
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      score: 0,
      captainRot: 0,
      drawerRot: 0,
      lastPick: Math.random(),
      hintsLeft: HINTS_PER_TEAM,
      chat,
    };
  }

  attachPlayer(socket, p) {
    p.sockets.add(socket.id);
    p.connected = true;
    socket.data.room = this;
    socket.data.role = 'player';
    socket.data.playerId = p.id;
    socket.join(this.code);
    socket.join(`p:${p.id}`);
    this.syncTeamRooms(p);
    const t = this.team(p.teamId);
    socket.emit('chat:history', t ? t.chat : []);
    if (this.phase === 'backrooms' && this.br && p.teamId) {
      try {
        this.br.addPlayer({ id: p.id, name: p.name, teamId: p.teamId, color: t.color });
      } catch (e) {
        console.error('[backrooms] addPlayer', e);
      }
    }
  }

  syncTeamRooms(p) {
    for (const sid of p.sockets) {
      const s = this.io.sockets.sockets.get(sid);
      if (!s) continue;
      for (const r of s.rooms) if (r.startsWith(`${this.code}:t:`)) s.leave(r);
      if (p.teamId) s.join(`${this.code}:t:${p.teamId}`);
    }
  }

  detach(socket) {
    if (socket.data.role === 'host') {
      this.hostSockets.delete(socket.id);
    } else {
      const p = this.players.get(socket.data.playerId);
      if (p) {
        p.sockets.delete(socket.id);
        if (!p.sockets.size) p.connected = false;
      }
    }
    this.markDirty();
    // Wenn ein Team komplett weg ist, nicht ewig auf es warten.
    setTimeout(() => this.checkDone(), 50);
  }

  // ---------- Teams ----------

  // Immer Zweierteams; bei ungerader Spielerzahl spielt eine Person allein.
  teamOptions() {
    return [Math.min(TEAM_COLORS.length, Math.max(2, Math.ceil(this.players.size / TEAM_SIZE)))];
  }

  shuffleTeams() {
    this.teamCount = this.teamOptions()[0];
    // Neue Paare fangen mit einem leeren Chat an – alte Absprachen gehören zu anderen Leuten.
    const names = shuffle(TEAM_NAMES).slice(0, this.teamCount);
    this.teams = names.map((name, i) => this.newTeam(i, name));
    // Paare bilden; wer übrig bleibt, landet im letzten Team allein (bei 2 Spielern spielt jeder allein).
    const players = shuffle([...this.players.values()]);
    const perTeam = Math.ceil(players.length / this.teams.length);
    players.forEach((p, i) => {
      p.teamId = this.teams[Math.min(Math.floor(i / perTeam), this.teams.length - 1)].id;
    });
    for (const p of this.players.values()) this.syncTeamRooms(p);
    this.sendChatState();
  }

  // Malen lohnt nur, wenn im Team gerade noch jemand zum Mitraten verbunden ist.
  canDraw(teamId) {
    return this.membersOf(teamId).filter(m => m.connected).length >= TEAM_SIZE;
  }

  pickRotating(team, key) {
    const members = this.membersOf(team.id);
    if (!members.length) return null;
    const connected = members.filter(m => m.connected);
    const pool = connected.length ? connected : members;
    const p = pool[team[key] % pool.length];
    team[key]++;
    return p.id;
  }

  // Kapitän/Maler fallen auf ein verbundenes Teammitglied zurück.
  roleHolder(map, teamId) {
    if (!this.q) return null;
    const cur = map[teamId] && this.players.get(map[teamId]);
    if (cur && cur.connected && cur.teamId === teamId) return cur.id;
    const next = this.membersOf(teamId).find(m => m.connected);
    if (next) map[teamId] = next.id;
    return next ? next.id : map[teamId] || null;
  }

  captainId(teamId) {
    return this.q ? this.roleHolder(this.q.captains, teamId) : null;
  }

  // Teams ohne Maler (allein oder Partner offline) raten beim Montagsmaler bei einem anderen Team mit.
  // Wer malt, steht beim Aufdecken des Feldes fest – wer später zurückkommt, rät ebenfalls mit.
  drawerId(teamId) {
    if (!this.q || this.q.type !== 'draw' || !this.q.drawers[teamId]) return null;
    return this.roleHolder(this.q.drawers, teamId);
  }

  watchedTeam(teamId) {
    const q = this.q;
    return q && q.type === 'draw' && q.soloWatch ? q.soloWatch[teamId] || null : null;
  }

  // ---------- Ablauf ----------

  startGame() {
    for (const t of this.teams) {
      t.score = 0;
      t.hintsLeft = HINTS_PER_TEAM;
    }
    this.pageIdx = 0;
    this.resetBoard();
    this.pickDuelTiles();
    this.duel = null;
    this.duelUsed = [];
    this.log = [];
    this.brResults = null;
    this.toBoard();
  }

  // Pro Seite ist ein zufälliges Feld heimlich das Duell-Feld.
  pickDuelTiles() {
    const pool = this.questions.duel || [];
    this.duelTiles = pool.length
      ? this.pages.map(p => {
          const cat = Math.floor(Math.random() * p.categories.length);
          return { cat, idx: Math.floor(Math.random() * p.categories[cat].questions.length) };
        })
      : [];
  }

  isDuelTile(page, cat, idx) {
    const d = this.duelTiles[page];
    return !!d && d.cat === cat && d.idx === idx;
  }

  toBoard() {
    this.clearTimer();
    this.stopTicker();
    this.q = null;
    this.phase = 'board';
    this.computePicking();
    this.markDirty();
  }

  computePicking() {
    if (!this.teams.length) return;
    const min = Math.min(...this.teams.map(t => t.score));
    const cands = this.teams.filter(t => t.score === min).sort((a, b) => a.lastPick - b.lastPick);
    this.pickingTeamId = cands[0].id;
  }

  pickTile(cat, idx) {
    if (this.phase !== 'board') return { error: 'Gerade kann kein Feld gewählt werden.' };
    const page = this.pages[this.pageIdx];
    const category = page && page.categories[cat];
    const data = category && category.questions[idx];
    const mech = category && MECH[category.type];
    if (!data || !mech) return { error: 'Unbekanntes Feld.' };
    if (this.used[this.pageIdx][cat][idx]) return { error: 'Das Feld ist schon weg.' };
    this.used[this.pageIdx][cat][idx] = true;
    const picker = this.team(this.pickingTeamId);
    if (picker) picker.lastPick = Date.now();

    const now = Date.now();
    const q = {
      id: ++this.qCounter,
      type: category.type,
      data,
      value: data.value || VALUES[idx],
      page: this.pageIdx,
      cat,
      idx,
      catName: category.name,
      catIcon: category.icon,
      status: 'intro',
      introEndsAt: now + INTRO_MS,
      startedAt: null,
      endsAt: null,
      teams: {},
      captains: {},
      drawers: {},
      reveal: null,
      isDuel: this.isDuelTile(this.pageIdx, cat, idx),
      duelWinner: null,
    };
    if (mech.setup) mech.setup(q);
    for (const t of this.teams) {
      q.teams[t.id] = {
        draft: mech.initDraft ? mech.initDraft(q) : null,
        draftBy: null,
        votes: {},
        locked: false,
        lockedAt: null,
        answer: null,
        solvedAt: null,
        solvedBy: null,
        feed: [],
        cooldownUntil: 0,
        guessTimes: {},
        perm: q.basePerm ? q.basePerm.slice() : null,
        bonus: null,
        strokes: [],
        hlVotes: {},
        hlLocked: false,
        hlAnswers: [],
        hint: null,
        hintPending: null,
        hintSuggestion: undefined,
      };
      q.captains[t.id] = this.pickRotating(t, 'captainRot');
      if (q.type === 'draw' && this.canDraw(t.id)) q.drawers[t.id] = this.pickRotating(t, 'drawerRot');
    }
    if (q.type === 'draw') {
      // Jedes Team ohne Maler rät bei der Zeichnung eines zufälligen Teams mit Maler mit.
      const withDrawer = Object.keys(q.drawers);
      q.soloWatch = {};
      for (const t of this.teams) {
        if (!q.drawers[t.id] && withDrawer.length) q.soloWatch[t.id] = shuffle(withDrawer)[0];
      }
    }
    this.q = q;
    this.phase = 'intro';
    this.schedule(INTRO_MS, () => this.beginQuestion());
    this.markDirty();
    return { ok: true };
  }

  beginQuestion() {
    const q = this.q;
    if (!q || q.status !== 'intro') return;
    const mech = MECH[q.type];
    q.status = 'active';
    this.phase = 'question';
    q.startedAt = Date.now();
    if (q.type === 'hl') {
      this.startHlRound(0);
      return;
    }
    q.endsAt = q.startedAt + mech.time(q) * 1000;
    this.schedule(q.endsAt - Date.now(), () => this.timeUp());
    if (q.type === 'clues') {
      const interval = mech.interval(q) * 1000;
      this.startTicker(() => this.markDirty(), interval);
    } else if (q.type === 'code' && q.data.hint) {
      const at = mech.hintAt(q);
      setTimeout(() => {
        if (this.q === q && q.status === 'active') this.markDirty();
      }, at - Date.now() + 50);
    }
    this.markDirty();
  }

  timeUp() {
    const q = this.q;
    if (!q || q.status !== 'active') return;
    if (q.type === 'hl') {
      this.endHlRound();
      return;
    }
    const mech = MECH[q.type];
    for (const t of this.teams) this.autoLock(t, q, mech);
    this.resolve();
  }

  autoLock(t, q, mech) {
    const ts = q.teams[t.id];
    if (!ts || ts.locked) return;
    const now = Date.now();
    if (mech.input === 'draft') {
      const empty = ts.draft == null || (typeof ts.draft === 'object' && !Array.isArray(ts.draft) && !Object.keys(ts.draft).length);
      // Eine nie angefasste Zufallsreihenfolge soll keine Zufallspunkte bringen.
      const untouched = mech.needsTouch && !ts.draftPid;
      if (!empty && !untouched) Object.assign(ts, { answer: ts.draft, locked: true, lockedAt: now, auto: true });
    } else if (mech.input === 'vote') {
      const choice = this.teamChoice(t.id, ts.votes);
      if (choice != null) {
        Object.assign(ts, { answer: mech.lockAnswer ? mech.lockAnswer(q, ts, choice) : choice, locked: true, lockedAt: now, auto: true });
      }
    }
  }

  // Mehrheit im Team, bei Gleichstand zählt der Kapitän.
  teamChoice(teamId, votes) {
    const counts = new Map();
    for (const [pid, v] of Object.entries(votes || {})) {
      const p = this.players.get(pid);
      if (!p || p.teamId !== teamId) continue;
      const k = JSON.stringify(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!counts.size) return null;
    const max = Math.max(...counts.values());
    const top = [...counts.entries()].filter(([, n]) => n === max).map(([k]) => k);
    const cap = this.captainId(teamId);
    const capKey = cap && votes[cap] !== undefined ? JSON.stringify(votes[cap]) : null;
    return JSON.parse(capKey && top.includes(capKey) ? capKey : top[0]);
  }

  checkDone() {
    const q = this.q;
    if (!q || q.status !== 'active' || q.resolving) return;
    const mech = MECH[q.type];
    const active = this.activeTeams();
    if (!active.length) return;
    const all = f => active.every(t => q.teams[t.id] && f(q.teams[t.id]));
    let done = false;
    switch (mech.input) {
      case 'draft':
      case 'vote':
      case 'teamGuess':
        done = all(ts => ts.locked);
        break;
      case 'race':
      case 'draw':
        done = all(ts => ts.solvedAt);
        break;
      case 'puzzle':
        if (all(ts => ts.solvedAt)) {
          done = !q.data.bonus || all(ts => ts.bonus);
          if (!done && q.endsAt > Date.now() + 15000) {
            q.endsAt = Date.now() + 15000;
            this.schedule(15000, () => this.timeUp());
            this.markDirty();
          }
        }
        break;
      case 'hl':
        if (q.roundPhase === 'choose' && !q.hlEnding && all(ts => ts.hlLocked)) {
          q.hlEnding = true;
          this.schedule(700, () => this.endHlRound());
        }
        return;
      default:
        break;
    }
    if (done) {
      q.resolving = true;
      this.schedule(1100, () => this.resolve());
    }
  }

  startHlRound(r) {
    const q = this.q;
    const ms = MECH.hl.roundTime(q) * 1000;
    q.round = r;
    q.roundPhase = 'choose';
    q.hlEnding = false;
    q.endsAt = Date.now() + ms;
    for (const t of this.teams) {
      const ts = q.teams[t.id];
      ts.hlVotes = {};
      ts.hlLocked = false;
    }
    this.schedule(ms, () => this.endHlRound());
    this.markDirty();
  }

  endHlRound() {
    const q = this.q;
    if (!q || q.status !== 'active' || q.roundPhase !== 'choose') return;
    const r = q.round;
    const items = q.data.items;
    const correct = items[r + 1].value > items[r].value ? 'up' : 'down';
    const results = {};
    for (const t of this.teams) {
      const ts = q.teams[t.id];
      if (!ts.hlLocked) ts.hlAnswers[r] = this.teamChoice(t.id, ts.hlVotes);
      const choice = ts.hlAnswers[r] == null ? null : ts.hlAnswers[r];
      results[t.id] = { choice, ok: choice === correct };
    }
    q.hlRounds = q.hlRounds || [];
    q.hlRounds[r] = { correct, results };
    q.roundPhase = 'show';
    q.endsAt = Date.now() + MECH.hl.showTime;
    this.schedule(MECH.hl.showTime, () => {
      if (r + 1 < MECH.hl.rounds(q)) this.startHlRound(r + 1);
      else this.resolve();
    });
    this.markDirty();
  }

  resolve() {
    const q = this.q;
    if (!q || q.status !== 'active') return;
    this.clearTimer();
    this.stopTicker();
    const mech = MECH[q.type];
    let res;
    try {
      res = mech.resolve(q, this.teams);
    } catch (e) {
      console.error('[resolve]', e);
      res = { answerText: '?', results: this.teams.map(t => ({ teamId: t.id, text: '–', detail: 'Fehler bei der Auswertung', points: 0 })) };
    }
    for (const r of res.results) {
      const t = this.team(r.teamId);
      if (t) t.score += r.points;
      const ts = q.teams[r.teamId];
      if (ts && ts.hint) r.detail = `${r.detail ? `${r.detail} · ` : ''}💡 mit gekauftem Hinweis`;
    }
    if (q.isDuel) q.duelWinner = this.duelWinnerOf(q, res.results);
    q.reveal = {
      answerText: res.answerText,
      info: q.data.info || null,
      results: res.results,
      extra: res.extra || null,
      duel: q.isDuel ? { winnerId: q.duelWinner } : null,
    };
    q.status = 'reveal';
    this.phase = 'reveal';
    this.log.push({ at: Date.now(), page: q.page, cat: q.cat, idx: q.idx, points: Object.fromEntries(res.results.map(r => [r.teamId, r.points])) });
    this.markDirty();
    if (q.type === 'draw') this.io.to(this.code).emit('draw:gallery', this.drawGallery());
  }

  drawGallery() {
    const q = this.q;
    return { qid: q.id, teams: this.teams.map(t => ({ teamId: t.id, strokes: (q.teams[t.id] && q.teams[t.id].strokes) || [] })) };
  }

  next() {
    const pageDone = this.used[this.pageIdx].every(c => c.every(Boolean));
    if (this.phase === 'reveal') {
      const q = this.q;
      if (q && q.isDuel && q.duelWinner && this.teams.length >= 2) {
        this.startDuel(q.duelWinner, pageDone);
        return;
      }
      this.q = null;
      if (pageDone) this.endPage();
      else this.toBoard();
    } else if (this.phase === 'duel' && this.duel && this.duel.step === 'reveal') {
      this.finishDuel();
    }
  }

  // Wer die Frage auf dem Duell-Feld gewinnt (meiste Punkte, bei Gleichstand der Schnellere), fordert heraus.
  duelWinnerOf(q, results) {
    const best = Math.max(...results.map(r => r.points));
    if (!(best > 0)) return null;
    const time = tid => {
      const ts = q.teams[tid];
      return Math.min(ts.solvedAt || Infinity, ts.lockedAt || Infinity);
    };
    const top = results.filter(r => r.points === best).map(r => r.teamId);
    top.sort((a, b) => time(a) - time(b));
    return top[0];
  }

  // ---------- Duell ----------

  startDuel(challengerId, pageDone) {
    this.clearTimer();
    this.stopTicker();
    this.q = null;
    const pool = this.questions.duel;
    let free = pool.map((_, i) => i).filter(i => !this.duelUsed.includes(i));
    if (!free.length) {
      this.duelUsed = [];
      free = pool.map((_, i) => i);
    }
    const qi = free[Math.floor(Math.random() * free.length)];
    this.duelUsed.push(qi);
    this.duel = {
      id: ++this.duelCounter,
      step: 'challenge',
      challengerId,
      defenderId: null,
      fighters: {},
      qi,
      guesses: {},
      endsAt: null,
      result: null,
      after: pageDone ? 'endPage' : 'board',
    };
    this.phase = 'duel';
    const others = this.teams.filter(t => t.id !== challengerId);
    if (others.length === 1) this.setDuelDefender(others[0].id);
    else this.duelTimer(DUEL_MS.challenge, () => this.setDuelDefender(shuffle(others)[0].id));
    this.markDirty();
  }

  duelTimer(ms, fn) {
    this.duel.endsAt = Date.now() + ms;
    this.schedule(ms, fn);
  }

  setDuelDefender(teamId) {
    const d = this.duel;
    if (!d || d.step !== 'challenge' || teamId === d.challengerId || !this.team(teamId)) return { error: 'Dieses Team kann nicht herausgefordert werden.' };
    d.defenderId = teamId;
    d.step = 'fighters';
    const c = this.team(d.challengerId);
    this.toast(`⚔️ ${c.name} fordert ${this.team(teamId).name} heraus!`, c.color);
    // Einzelkämpfer müssen sich nicht erst melden
    for (const tid of [d.challengerId, teamId]) {
      const members = this.membersOf(tid);
      if (members.length === 1) d.fighters[tid] = members[0].id;
    }
    if (d.fighters[d.challengerId] && d.fighters[teamId]) {
      this.startDuelQuestion();
      return { ok: true };
    }
    this.duelTimer(DUEL_MS.fighters, () => this.autoFighters());
    this.markDirty();
    return { ok: true };
  }

  volunteer(p) {
    const d = this.duel;
    if (!d || d.step !== 'fighters') return { error: 'Gerade werden keine Kämpfer gesucht.' };
    if (p.teamId !== d.challengerId && p.teamId !== d.defenderId) return { error: 'Euer Team kämpft nicht mit.' };
    if (d.fighters[p.teamId]) return { error: 'Für euer Team kämpft schon jemand.' };
    d.fighters[p.teamId] = p.id;
    if (d.fighters[d.challengerId] && d.fighters[d.defenderId]) this.startDuelQuestion();
    else this.markDirty();
    return { ok: true };
  }

  autoFighters() {
    const d = this.duel;
    if (!d || d.step !== 'fighters') return;
    for (const tid of [d.challengerId, d.defenderId]) {
      if (d.fighters[tid]) continue;
      const members = this.membersOf(tid);
      const online = members.filter(m => m.connected);
      const pool = online.length ? online : members;
      if (pool.length) d.fighters[tid] = pool[Math.floor(Math.random() * pool.length)].id;
    }
    if (d.fighters[d.challengerId] && d.fighters[d.defenderId]) this.startDuelQuestion();
    else this.resolveDuel();
  }

  startDuelQuestion() {
    this.duel.step = 'question';
    this.duelTimer(DUEL_MS.question, () => this.resolveDuel());
    this.markDirty();
  }

  duelLock(p, v) {
    const d = this.duel;
    if (!d || d.step !== 'question') return { error: 'Gerade läuft keine Duellfrage.' };
    if (d.fighters[p.teamId] !== p.id) return { error: 'Nur die Kämpfer dürfen antworten.' };
    if (d.guesses[p.teamId] != null) return { error: 'Du hast schon festgelegt.' };
    const dq = this.questions.duel[d.qi];
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: 'Bitte eine Zahl eingeben.' };
    d.guesses[p.teamId] = Math.min(dq.max, Math.max(dq.min, n));
    if (d.guesses[d.challengerId] != null && d.guesses[d.defenderId] != null) this.schedule(900, () => this.resolveDuel());
    this.markDirty();
    return { ok: true };
  }

  resolveDuel() {
    const d = this.duel;
    if (!d || d.step === 'reveal') return;
    this.clearTimer();
    const dq = this.questions.duel[d.qi];
    const diff = v => (v == null ? Infinity : dq.scale === 'log' ? Math.abs(Math.log(Math.max(v, 1e-9) / dq.answer)) : Math.abs(v - dq.answer));
    const dc = diff(d.guesses[d.challengerId]);
    const dd = diff(d.guesses[d.defenderId]);
    const winner = dc < dd ? 'challenger' : dd < dc ? 'defender' : 'tie';
    let stolen = 0;
    if (winner === 'challenger') {
      stolen = DUEL_STEAL;
      this.team(d.challengerId).score += stolen;
      this.team(d.defenderId).score -= stolen;
    }
    d.result = { winner, stolen, answer: dq.answer, display: dq.display || null, info: dq.info || null };
    d.step = 'reveal';
    d.endsAt = null;
    this.log.push({ at: Date.now(), duel: { challengerId: d.challengerId, defenderId: d.defenderId, winner, stolen } });
    this.markDirty();
  }

  finishDuel() {
    const after = this.duel ? this.duel.after : 'board';
    this.clearTimer();
    this.duel = null;
    if (after === 'endPage') this.endPage();
    else this.toBoard();
  }

  publicDuel() {
    const d = this.duel;
    const dq = this.questions.duel[d.qi];
    const fighter = tid => {
      const p = tid && this.players.get(d.fighters[tid]);
      return p ? { id: p.id, name: p.name, avatar: p.avatar } : null;
    };
    const showQ = d.step === 'question' || d.step === 'reveal';
    return {
      id: d.id,
      step: d.step,
      endsAt: d.endsAt,
      steal: DUEL_STEAL,
      challengerId: d.challengerId,
      defenderId: d.defenderId,
      fighters: { challenger: fighter(d.challengerId), defender: fighter(d.defenderId) },
      locked: { challenger: d.guesses[d.challengerId] != null, defender: d.defenderId ? d.guesses[d.defenderId] != null : false },
      question: showQ
        ? {
            prompt: dq.prompt,
            unit: dq.unit || '',
            min: dq.min,
            max: dq.max,
            step: dq.step || 1,
            scale: dq.scale || 'linear',
            start: dq.start != null ? dq.start : Math.round((dq.min + dq.max) / 2),
          }
        : null,
      result: d.step === 'reveal' ? { ...d.result, guesses: { challenger: d.guesses[d.challengerId], defender: d.guesses[d.defenderId] } } : null,
    };
  }

  // ---------- Hinweise kaufen ----------

  hintSuggestion(q, ts) {
    if (ts.hintSuggestion === undefined) {
      let text = q.data.buyHint || null;
      if (!text && HINTS[q.type]) {
        try {
          text = HINTS[q.type](q, ts);
        } catch (e) {
          console.error('[hint]', e);
        }
      }
      ts.hintSuggestion = text || '';
    }
    return ts.hintSuggestion;
  }

  requestHint(p) {
    const c = this.teamQ(p);
    if (!c) return { error: 'Hinweise gibt es nur während einer Frage.' };
    const t = this.team(p.teamId);
    if (c.ts.hint) return { error: 'Ihr habt für diese Frage schon einen Hinweis.' };
    if (c.ts.hintPending) return { error: 'Eure Anfrage liegt schon beim Spielleiter.' };
    if (t.hintsLeft <= 0) return { error: 'Ihr habt keine Hinweise mehr.' };
    if (t.score < HINT_COST) return { error: `Ein Hinweis kostet ${HINT_COST} Punkte – so viele habt ihr nicht.` };
    if (c.ts.locked || c.ts.solvedAt) return { error: 'Ihr seid bei dieser Frage schon fertig.' };
    c.ts.hintPending = { by: p.name, at: Date.now() };
    this.hintSuggestion(c.q, c.ts);
    this.io.to(`${this.code}:host`).emit('toast', { text: `💡 ${t.name} möchte einen Hinweis kaufen`, color: t.color, sfx: 'join' });
    this.markDirty();
    return { ok: true };
  }

  unlockHint(teamId, text) {
    const q = this.q;
    const ts = q && q.status === 'active' && q.teams[teamId];
    const t = this.team(teamId);
    if (!ts || !t || !ts.hintPending || ts.hint) return { error: 'Keine offene Anfrage von diesem Team.' };
    if (t.hintsLeft <= 0 || t.score < HINT_COST) {
      ts.hintPending = null;
      this.markDirty();
      return { error: 'Das Team hat keine Hinweise oder Punkte mehr.' };
    }
    let final = cleanText(text, 220) || this.hintSuggestion(q, ts);
    if (q.type === 'puzzle' && ts.perm && !ts.solvedAt) {
      const fixed = applyPuzzleHint(ts);
      final = fixed ? `${fixed} ${fixed === 1 ? 'Teil liegt' : 'Teile liegen'} jetzt richtig.${cleanText(text, 220) ? ` ${cleanText(text, 220)}` : ''}` : final;
    }
    if (!final) return { error: 'Bitte einen Hinweistext eingeben.' };
    t.score -= HINT_COST;
    t.hintsLeft--;
    ts.hint = { text: final, at: Date.now() };
    ts.hintPending = null;
    this.log.push({ at: Date.now(), hint: { teamId, cost: HINT_COST } });
    this.io.to(`${this.code}:t:${teamId}`).emit('toast', { text: '💡 Euer Hinweis ist freigeschaltet!', color: t.color, sfx: 'solved' });
    this.markDirty();
    return { ok: true };
  }

  declineHint(teamId) {
    const q = this.q;
    const ts = q && q.teams[teamId];
    if (!ts || !ts.hintPending) return { ok: true };
    ts.hintPending = null;
    this.io.to(`${this.code}:t:${teamId}`).emit('toast', { text: 'Der Spielleiter hat euren Hinweis abgelehnt – es kostet nichts.', color: '#9b8f9e' });
    this.markDirty();
    return { ok: true };
  }

  cancelQuestion() {
    const q = this.q;
    if (!q || (q.status !== 'intro' && q.status !== 'active')) return;
    this.used[q.page][q.cat][q.idx] = false;
    this.toBoard();
  }

  addTime(sec) {
    const q = this.q;
    if (!q || q.status !== 'active') return;
    if (q.type === 'hl' && q.roundPhase !== 'choose') return;
    q.endsAt += sec * 1000;
    const fn = q.type === 'hl' ? () => this.endHlRound() : () => this.timeUp();
    this.schedule(q.endsAt - Date.now(), fn);
    this.markDirty();
  }

  endPage() {
    this.clearTimer();
    this.stopTicker();
    this.q = null;
    this.phase = this.pageIdx === 0 && this.pages.length > 1 ? 'brIntro' : 'final';
    this.markDirty();
  }

  // ---------- Backrooms ----------

  startBackrooms() {
    if (this.phase !== 'brIntro') return;
    let BackroomsGame;
    try {
      ({ BackroomsGame } = require('./backrooms'));
    } catch (e) {
      console.error('[backrooms] Modul nicht verfügbar', e);
      this.toast('Das Backrooms-Spiel ist nicht verfügbar – weiter geht es mit Seite 2.');
      this.phase = 'backrooms';
      this.afterBackrooms({ players: [] });
      return;
    }
    const players = [...this.players.values()]
      .filter(p => p.teamId && p.connected)
      .map(p => ({ id: p.id, name: p.name, teamId: p.teamId, color: this.team(p.teamId).color }));
    this.br = new BackroomsGame({
      players,
      durationSec: Number(process.env.GS_BR_SECONDS) || 150,
      countdownSec: 5,
      emit: (ev, data) => this.io.to(this.code).emit(ev, data),
      emitTo: (pid, ev, data) => this.io.to(`p:${pid}`).emit(ev, data),
      onEnd: res => setImmediate(() => this.afterBackrooms(res)),
    });
    this.phase = 'backrooms';
    this.br.start();
    this.markDirty();
  }

  afterBackrooms(res) {
    if (this.phase !== 'backrooms') return;
    if (this.br) {
      try {
        this.br.stop();
      } catch (e) {
        console.error('[backrooms] stop', e);
      }
      this.br = null;
    }
    const list = ((res && res.players) || []).map(r => {
      const p = this.players.get(r.id);
      return {
        id: r.id,
        name: (p && p.name) || r.name,
        avatar: p ? p.avatar : '👤',
        teamId: (p && p.teamId) || r.teamId,
        notes: Math.max(0, Number(r.notes) || 0),
      };
    }).sort((a, b) => b.notes - a.notes);
    const top = list.length ? list[0].notes : 0;
    const teamPoints = {};
    for (const e of list) {
      e.king = top > 0 && e.notes === top;
      e.points = e.notes * BR_PER_NOTE + (e.king ? e.notes * BR_KING_PER_NOTE : 0);
      teamPoints[e.teamId] = (teamPoints[e.teamId] || 0) + e.points;
    }
    for (const t of this.teams) t.score += teamPoints[t.id] || 0;
    this.brResults = { players: list, teamPoints, perNote: BR_PER_NOTE, kingPerNote: BR_KING_PER_NOTE };
    this.phase = 'brResults';
    this.markDirty();
  }

  onBrReady(socket) {
    if (this.phase !== 'backrooms' || !this.br) return;
    const pid = socket.data.role === 'player' ? socket.data.playerId : null;
    try {
      socket.emit('br:init', this.br.getInitFor(pid));
    } catch (e) {
      console.error('[backrooms] init', e);
    }
  }

  onBrPos(socket, d) {
    if (this.phase !== 'backrooms' || !this.br || socket.data.role !== 'player') return;
    try {
      this.br.input(socket.data.playerId, d);
    } catch (e) {
      console.error('[backrooms] input', e);
    }
  }

  // ---------- Aktionen der Spieler ----------

  playerAction(socket, d) {
    const p = this.players.get(socket.data.playerId);
    if (!p) return { error: 'Du bist nicht mehr im Raum.' };
    switch (d.a) {
      case 'avatar': {
        const used = new Set([...this.players.values()].map(x => x.avatar));
        const free = AVATARS.filter(a => !used.has(a));
        const pool = free.length ? free : AVATARS;
        p.avatar = pool[Math.floor(Math.random() * pool.length)];
        this.markDirty();
        return { ok: true };
      }
      case 'pick':
        if (p.teamId !== this.pickingTeamId) return { error: 'Ein anderes Team ist mit Wählen dran.' };
        return this.pickTile(d.cat | 0, d.idx | 0);
      case 'draft':
        return this.setDraft(p, d.v, d.seq);
      case 'vote':
        return this.vote(p, d.v);
      case 'lock':
        return this.lock(p, d);
      case 'guess':
        return this.guess(p, d.text);
      case 'swap':
        return this.swap(p, d.x | 0, d.y | 0);
      case 'bonus':
        return this.bonus(p, d.text);
      case 'clear':
        return this.clearDrawing(socket, p);
      case 'sync':
        return this.drawSync(p);
      case 'chat':
        return this.chat(p, d.text);
      case 'hint':
        return this.requestHint(p);
      case 'duelChallenge':
        if (!this.duel || p.teamId !== this.duel.challengerId) return { error: 'Nur das Team mit dem Duell-Feld darf herausfordern.' };
        return this.setDuelDefender(d.teamId);
      case 'duelVolunteer':
        return this.volunteer(p);
      case 'duelLock':
        return this.duelLock(p, d.v);
      default:
        return { error: 'Unbekannte Aktion.' };
    }
  }

  teamQ(p) {
    const q = this.q;
    if (!q || q.status !== 'active' || !p.teamId) return null;
    const ts = q.teams[p.teamId];
    return ts ? { q, ts, mech: MECH[q.type] } : null;
  }

  setDraft(p, v, seq) {
    const c = this.teamQ(p);
    if (!c || c.ts.locked || !c.mech.sanitizeDraft) return;
    if (c.mech.input !== 'draft' && c.mech.input !== 'vote') return;
    const val = c.mech.sanitizeDraft(c.q, v);
    if (val === undefined) return;
    c.ts.draft = val;
    c.ts.draftBy = p.name;
    c.ts.draftPid = p.id;
    c.ts.draftSeq = Number(seq) || 0;
    this.markDirty(p.teamId);
    return { ok: true };
  }

  vote(p, v) {
    const c = this.teamQ(p);
    if (!c) return;
    if (c.mech.input === 'hl') {
      if (c.q.roundPhase !== 'choose' || c.ts.hlLocked || !c.mech.validVote(c.q, v)) return;
      c.ts.hlVotes[p.id] = v;
    } else if (c.mech.input === 'vote') {
      if (c.ts.locked || !c.mech.validVote(c.q, v)) return;
      c.ts.votes[p.id] = v;
    } else return;
    this.markDirty(p.teamId);
    return { ok: true };
  }

  lock(p, d) {
    const c = this.teamQ(p);
    if (!c) return;
    const { q, ts, mech } = c;
    if (this.captainId(p.teamId) !== p.id) return { error: 'Nur euer Kapitän kann festlegen.' };
    const now = Date.now();
    if (mech.input === 'hl') {
      if (q.roundPhase !== 'choose' || ts.hlLocked) return;
      const v = ts.hlVotes[p.id];
      if (v === undefined) return { error: 'Wähle zuerst höher oder tiefer.' };
      ts.hlAnswers[q.round] = v;
      ts.hlLocked = true;
    } else {
      if (ts.locked) return;
      if (mech.input === 'draft') {
        if (d && d.draft !== undefined) {
          const val = mech.sanitizeDraft(q, d.draft);
          if (val !== undefined) ts.draft = val;
        }
        const empty = ts.draft == null || (typeof ts.draft === 'object' && !Array.isArray(ts.draft) && !Object.keys(ts.draft).length);
        if (empty) return { error: 'Erst eine Antwort wählen.' };
        ts.answer = ts.draft;
      } else if (mech.input === 'vote') {
        if (d && d.wager !== undefined && mech.sanitizeDraft) {
          const w = mech.sanitizeDraft(q, d.wager);
          if (w !== undefined) ts.draft = w;
        }
        const choice = ts.votes[p.id];
        if (choice === undefined) return { error: 'Wähle zuerst eine Antwort.' };
        ts.answer = mech.lockAnswer ? mech.lockAnswer(q, ts, choice) : choice;
      } else return;
      ts.locked = true;
      ts.lockedAt = now;
    }
    this.markDirty();
    this.checkDone();
    return { ok: true };
  }

  guess(p, raw) {
    const c = this.teamQ(p);
    if (!c) return;
    const { q, ts, mech } = c;
    const text = cleanText(raw, 80);
    if (!text) return;
    const now = Date.now();
    if (mech.input === 'teamGuess') {
      // Jeder im Team darf den einen gemeinsamen Versuch abgeben – wer zuerst abschickt, legt fest.
      if (ts.locked) return { error: 'Euer Team hat schon geantwortet.' };
      ts.answer = { text, clue: MECH.clues.visible(q, now), ok: mech.check(q, text), by: p.name };
      ts.locked = true;
      ts.lockedAt = now;
      this.markDirty();
      this.checkDone();
      return { ok: true };
    }
    if (mech.input !== 'race' && mech.input !== 'draw') return;
    if (ts.solvedAt) return;
    if (mech.input === 'draw' && this.drawerId(p.teamId) === p.id) return { error: 'Du malst – raten dürfen die anderen.' };
    if (now < ts.cooldownUntil) return { error: 'Das Schloss ist kurz blockiert…' };
    if (now - (ts.guessTimes[p.id] || 0) < 500) return;
    ts.guessTimes[p.id] = now;
    const ok = mech.check(q, text);
    const shown = q.type === 'code' ? text.replace(/\D/g, '').slice(0, 8) : text;
    ts.feed.push({ name: p.name, text: shown, ok, at: now });
    if (ts.feed.length > 25) ts.feed.shift();
    if (ok) {
      ts.solvedAt = now;
      ts.solvedBy = p.name;
      const t = this.team(p.teamId);
      this.toast(`${t.name} ${q.type === 'code' ? 'hat das Schloss geknackt' : 'hat es gelöst'}!`, t.color, 'solved');
      this.markDirty();
      this.checkDone();
    } else {
      if (q.type === 'code') ts.cooldownUntil = now + 2500;
      this.markDirty(p.teamId);
    }
    return { ok: true, correct: ok };
  }

  swap(p, x, y) {
    const c = this.teamQ(p);
    if (!c || c.q.type !== 'puzzle' || c.ts.solvedAt) return;
    const perm = c.ts.perm;
    if (x === y || x < 0 || y < 0 || x >= perm.length || y >= perm.length) return;
    [perm[x], perm[y]] = [perm[y], perm[x]];
    if (perm.every((v, i) => v === i)) {
      c.ts.solvedAt = Date.now();
      c.ts.solvedBy = p.name;
      const t = this.team(p.teamId);
      this.toast(`${t.name} hat das Puzzle fertig!`, t.color, 'solved');
      this.markDirty();
      this.checkDone();
    } else {
      this.markDirty(p.teamId);
    }
    return { ok: true };
  }

  bonus(p, raw) {
    const c = this.teamQ(p);
    if (!c || c.q.type !== 'puzzle' || !c.ts.solvedAt || c.ts.bonus) return;
    const text = cleanText(raw, 60);
    if (!text) return;
    c.ts.bonus = { text, ok: MECH.puzzle.checkBonus(c.q, text), by: p.name };
    this.markDirty(p.teamId);
    this.checkDone();
    return { ok: true, correct: c.ts.bonus.ok };
  }

  onStroke(socket, d) {
    const p = this.players.get(socket.data.playerId);
    if (!p) return;
    const c = this.teamQ(p);
    if (!c || c.q.type !== 'draw' || this.drawerId(p.teamId) !== p.id) return;
    const segs = Array.isArray(d && d.s) ? d.s.slice(0, 300) : [];
    const clean = [];
    for (const s of segs) {
      if (!Array.isArray(s) || s.length !== 6) continue;
      const v = s.map(n => Math.round(Number(n)));
      if (v.slice(0, 4).some(n => !(n >= 0 && n <= 1000))) continue;
      v[4] = Math.max(0, Math.min(9, v[4] || 0));
      v[5] = Math.max(1, Math.min(80, v[5] || 4));
      clean.push(v);
    }
    if (!clean.length || c.ts.strokes.length > 8000) return;
    c.ts.strokes.push(...clean);
    socket.to(this.drawRooms(p.teamId)).emit('draw:stroke', { teamId: p.teamId, s: clean });
  }

  clearDrawing(socket, p) {
    const c = this.teamQ(p);
    if (!c || c.q.type !== 'draw' || this.drawerId(p.teamId) !== p.id) return;
    c.ts.strokes = [];
    socket.to(this.drawRooms(p.teamId)).emit('draw:clear', { teamId: p.teamId });
    return { ok: true };
  }

  // Wer eine Zeichnung sehen darf: das eigene Team, der Host und Einzelteams, die hier mitraten.
  drawRooms(teamId) {
    const rooms = [`${this.code}:t:${teamId}`, `${this.code}:host`];
    for (const [solo, watched] of Object.entries((this.q && this.q.soloWatch) || {})) {
      if (watched === teamId) rooms.push(`${this.code}:t:${solo}`);
    }
    return rooms;
  }

  drawSync(p) {
    const q = this.q;
    if (!q || q.type !== 'draw') return { teams: [] };
    if (q.status === 'reveal') return this.drawGallery();
    if (p) {
      const tid = this.watchedTeam(p.teamId) || p.teamId;
      const ts = q.teams[tid];
      return { qid: q.id, teams: ts ? [{ teamId: tid, strokes: ts.strokes }] : [] };
    }
    return this.drawGallery();
  }

  // Team-Chat: Spieler sehen nur ihr eigenes Team, der Spielleiter liest alle Teams mit.
  chat(p, raw) {
    const text = cleanText(raw, 200);
    const t = this.team(p.teamId);
    if (!text || !t) return;
    const now = Date.now();
    if (now - p.lastChat < 300) return { error: 'Nicht so schnell – die Nachricht ist noch nicht raus.' };
    p.lastChat = now;
    const msg = { pid: p.id, name: p.name, avatar: p.avatar, text, at: now };
    t.chat.push(msg);
    if (t.chat.length > 60) t.chat.shift();
    this.io.to(`${this.code}:t:${t.id}`).emit('chat', msg);
    this.io.to(`${this.code}:host`).emit('chat:host', { ...msg, teamId: t.id });
    return { ok: true };
  }

  hostChatHistory() {
    return this.teams.map(t => ({ teamId: t.id, chat: t.chat }));
  }

  // Nach neuen Teams bekommt jeder den Verlauf seines (neuen) Teams, der Spielleiter alle.
  sendChatState() {
    for (const p of this.players.values()) {
      const t = this.team(p.teamId);
      this.io.to(`p:${p.id}`).emit('chat:history', t ? t.chat : []);
    }
    this.io.to(`${this.code}:host`).emit('chat:hostHistory', this.hostChatHistory());
  }

  // ---------- Aktionen des Hosts ----------

  hostAction(socket, d) {
    switch (d.a) {
      case 'teamCount': {
        const n = d.n | 0;
        if (n >= 2 && n <= 4) this.teamCount = n;
        this.markDirty();
        return { ok: true };
      }
      case 'shuffle':
        if (this.players.size < 2) return { error: 'Es braucht mindestens 2 Spieler.' };
        if (this.phase !== 'lobby' && this.phase !== 'teams') return;
        this.shuffleTeams();
        this.phase = 'teams';
        this.markDirty();
        return { ok: true };
      case 'toLobby':
        if (this.phase === 'teams') {
          this.phase = 'lobby';
          this.markDirty();
        }
        return { ok: true };
      case 'start':
        if (this.phase !== 'teams') return;
        this.startGame();
        return { ok: true };
      case 'pick':
        return this.pickTile(d.cat | 0, d.idx | 0);
      case 'skipIntro':
        if (this.q && this.q.status === 'intro') {
          this.clearTimer();
          this.beginQuestion();
        }
        return { ok: true };
      case 'resolve':
        this.timeUp();
        return { ok: true };
      case 'cancel':
        this.cancelQuestion();
        return { ok: true };
      case 'addTime':
        this.addTime(15);
        return { ok: true };
      case 'next':
        this.next();
        return { ok: true };
      case 'adjust': {
        const t = this.team(d.teamId);
        const delta = Math.max(-1000, Math.min(1000, Number(d.delta) || 0));
        if (t && delta) {
          t.score += delta;
          this.log.push({ at: Date.now(), adjust: { teamId: t.id, delta } });
          this.markDirty();
        }
        return { ok: true };
      }
      case 'endPage':
        if (this.phase === 'board' || this.phase === 'reveal') this.endPage();
        return { ok: true };
      case 'brStart':
        this.startBackrooms();
        return { ok: true };
      case 'brEnd':
        if (this.br) this.br.forceEnd();
        return { ok: true };
      case 'brNext':
        if (this.phase === 'brResults') {
          this.pageIdx = Math.min(this.pageIdx + 1, this.pages.length - 1);
          this.toBoard();
        }
        return { ok: true };
      case 'final':
        this.clearTimer();
        this.stopTicker();
        this.q = null;
        this.phase = 'final';
        this.markDirty();
        return { ok: true };
      case 'reset':
        this.resetGame();
        return { ok: true };
      case 'kick':
        this.kick(d.playerId);
        return { ok: true };
      case 'move': {
        const p = this.players.get(d.playerId);
        if (p && this.team(d.teamId)) {
          p.teamId = d.teamId;
          this.syncTeamRooms(p);
          this.io.to(`p:${p.id}`).emit('chat:history', this.team(d.teamId).chat);
          this.markDirty();
        }
        return { ok: true };
      }
      case 'sync':
        return this.drawSync(null);
      case 'hintUnlock':
        return this.unlockHint(d.teamId, d.text);
      case 'hintDecline':
        return this.declineHint(d.teamId);
      case 'duelChallenge':
        return this.setDuelDefender(d.teamId);
      case 'duelFighters':
        this.autoFighters();
        return { ok: true };
      case 'duelResolve':
        if (this.duel && this.duel.step === 'question') this.resolveDuel();
        return { ok: true };
      case 'duelTime':
        if (this.duel && this.duel.step === 'question') {
          const left = Math.max(0, this.duel.endsAt - Date.now()) + 15000;
          this.duelTimer(left, () => this.resolveDuel());
          this.markDirty();
        }
        return { ok: true };
      case 'duelSkip':
        if (this.phase === 'duel') this.finishDuel();
        return { ok: true };
      default:
        return { error: 'Unbekannte Aktion.' };
    }
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    for (const sid of p.sockets) {
      const s = this.io.sockets.sockets.get(sid);
      if (!s) continue;
      s.emit('kicked');
      for (const r of [...s.rooms]) if (r !== s.id) s.leave(r);
      s.data.room = null;
    }
    this.players.delete(playerId);
    this.markDirty();
    this.checkDone();
  }

  resetGame() {
    this.clearTimer();
    this.stopTicker();
    if (this.br) {
      try {
        this.br.stop();
      } catch (e) {
        console.error(e);
      }
      this.br = null;
    }
    this.q = null;
    this.teams = [];
    for (const p of this.players.values()) {
      p.teamId = null;
      this.syncTeamRooms(p);
    }
    this.pageIdx = 0;
    this.resetBoard();
    this.brResults = null;
    this.duel = null;
    this.duelTiles = [];
    this.log = [];
    this.phase = 'lobby';
    this.sendChatState();
    this.markDirty();
  }

  // ---------- Zustand an die Clients ----------

  toast(text, color = null, sfx = null) {
    this.io.to(this.code).emit('toast', { text, color, sfx });
  }

  publicState() {
    const now = Date.now();
    const page = this.pages[this.pageIdx];
    return {
      now,
      code: this.code,
      phase: this.phase,
      publicUrl: this.getPublicUrl(),
      teamCount: this.teamCount,
      teamOptions: this.teamOptions(),
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, teamId: p.teamId, connected: p.connected })),
      teams: this.teams.map(t => ({ id: t.id, name: t.name, color: t.color, score: t.score, hintsLeft: t.hintsLeft == null ? HINTS_PER_TEAM : t.hintsLeft })),
      hintCost: HINT_COST,
      hintsPerTeam: HINTS_PER_TEAM,
      duel: this.phase === 'duel' && this.duel ? this.publicDuel() : null,
      page: this.pageIdx,
      pageCount: this.pages.length,
      pageTitle: page ? page.title : '',
      pageSubtitle: page ? page.subtitle || '' : '',
      board: page
        ? {
            values: VALUES,
            categories: page.categories.map(c => ({ name: c.name, icon: c.icon, type: c.type, mech: MECH[c.type] ? MECH[c.type].label : c.type })),
            used: this.used[this.pageIdx],
          }
        : null,
      pickingTeamId: this.pickingTeamId,
      q: this.q ? this.publicQuestion(now) : null,
      brResults: this.phase === 'brResults' || this.phase === 'final' ? this.brResults : null,
      hostOnline: this.hostSockets.size > 0,
    };
  }

  publicQuestion(now) {
    const q = this.q;
    const mech = MECH[q.type];
    const teams = {};
    for (const t of this.teams) {
      const ts = q.teams[t.id];
      if (!ts) continue;
      teams[t.id] = {
        locked: !!ts.locked,
        solved: !!ts.solvedAt,
        solvedMs: ts.solvedAt ? ts.solvedAt - q.startedAt : null,
        hlLocked: !!ts.hlLocked,
        bonusDone: !!ts.bonus,
        captainId: this.captainId(t.id),
        drawerId: this.drawerId(t.id),
        watch: this.watchedTeam(t.id),
        size: this.membersOf(t.id).length,
      };
    }
    return {
      id: q.id,
      type: q.type,
      input: mech.input,
      value: q.value,
      page: q.page,
      cat: q.cat,
      idx: q.idx,
      catName: q.catName,
      catIcon: q.catIcon,
      mech: { label: mech.label, icon: mech.icon, rule: mech.rule },
      status: q.status,
      introEndsAt: q.introEndsAt,
      startedAt: q.startedAt,
      endsAt: q.endsAt,
      data: q.status === 'intro' ? null : mech.publicData(q, now),
      teams,
      reveal: q.status === 'reveal' ? q.reveal : null,
    };
  }

  teamState(team) {
    const q = this.q;
    const ts = q && q.teams[team.id];
    if (!ts) return { teamId: team.id, qid: null };
    let answer = ts.answer;
    if (q.type === 'clues' && answer && q.status !== 'reveal') answer = { text: answer.text, clue: answer.clue, by: answer.by };
    return {
      teamId: team.id,
      qid: q.id,
      draft: ts.draft,
      draftBy: ts.draftBy,
      draftPid: ts.draftPid || null,
      draftSeq: ts.draftSeq || 0,
      votes: ts.votes,
      locked: ts.locked,
      lockedAt: ts.lockedAt,
      answer,
      solvedAt: ts.solvedAt,
      solvedBy: ts.solvedBy,
      feed: ts.feed,
      cooldownUntil: ts.cooldownUntil,
      perm: ts.perm,
      bonus: ts.bonus,
      hlVotes: ts.hlVotes,
      hlLocked: ts.hlLocked,
      hlAnswers: ts.hlAnswers,
      hint: ts.hint,
      hintPending: !!ts.hintPending,
    };
  }

  meState(p) {
    const q = this.q;
    const isCaptain = !!(q && p.teamId && q.status !== 'reveal' && this.captainId(p.teamId) === p.id);
    const isDrawer = !!(q && p.teamId && q.type === 'draw' && q.status !== 'reveal' && this.drawerId(p.teamId) === p.id);
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      teamId: p.teamId,
      isCaptain,
      isDrawer,
      word: isDrawer ? q.data.word : null,
      isFighter: !!(this.phase === 'duel' && this.duel && p.teamId && this.duel.fighters[p.teamId] === p.id),
    };
  }

  hostState() {
    const q = this.q;
    const mech = q && MECH[q.type];
    const hintRequests = [];
    if (q && q.status === 'active') {
      for (const t of this.teams) {
        const ts = q.teams[t.id];
        if (!ts || !ts.hintPending || ts.hint) continue;
        hintRequests.push({ teamId: t.id, by: ts.hintPending.by, suggestion: this.hintSuggestion(q, ts), hintsLeft: t.hintsLeft, score: t.score });
      }
    }
    let cheat = q && q.status !== 'reveal' && mech.cheat ? mech.cheat(q) : null;
    if (this.phase === 'duel' && this.duel && this.duel.step !== 'reveal') cheat = `Duell: ${this.questions.duel[this.duel.qi].answer}`;
    return { cheat, hintRequests, duelTiles: this.duelTiles };
  }

  markDirty(teamId = null) {
    if (teamId == null) this.dirtyAll = true;
    else this.dirtyTeams.add(teamId);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 20);
  }

  flush() {
    this.flushTimer = null;
    const all = this.dirtyAll;
    const teamIds = all ? this.teams.map(t => t.id) : [...this.dirtyTeams];
    this.dirtyAll = false;
    this.dirtyTeams.clear();
    try {
      if (all) {
        this.io.to(this.code).emit('state', this.publicState());
        this.io.to(`${this.code}:host`).emit('host', this.hostState());
        for (const p of this.players.values()) {
          if (p.connected) this.io.to(`p:${p.id}`).emit('me', this.meState(p));
        }
      }
      for (const id of teamIds) {
        const t = this.team(id);
        if (t) this.io.to(`${this.code}:t:${id}`).emit('team', this.teamState(t));
      }
    } catch (e) {
      console.error('[flush]', e);
    }
    if (all) this.saveSoon();
  }

  // ---------- Timer ----------

  schedule(ms, fn) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (e) {
        console.error('[timer]', e);
      }
    }, Math.max(0, ms));
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  startTicker(fn, ms) {
    this.stopTicker();
    this.ticker = setInterval(fn, ms);
  }

  stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  // ---------- Speichern (Absturzsicherung) ----------

  toJSON() {
    return {
      v: 1,
      code: this.code,
      hostToken: this.hostToken,
      createdAt: this.createdAt,
      savedAt: Date.now(),
      teamCount: this.teamCount,
      phase: this.phase,
      pageIdx: this.pageIdx,
      used: this.used,
      teams: this.teams,
      players: [...this.players.values()].map(p => ({ id: p.id, secret: p.secret, name: p.name, avatar: p.avatar, teamId: p.teamId, joinedAt: p.joinedAt })),
      brResults: this.brResults,
      duelTiles: this.duelTiles,
      duelUsed: this.duelUsed,
      log: this.log.slice(-200),
    };
  }

  static restore(data, deps) {
    const r = new Room({ ...deps, code: data.code });
    r.hostToken = data.hostToken;
    r.createdAt = data.createdAt || Date.now();
    r.teamCount = data.teamCount || 2;
    r.pageIdx = Math.min(data.pageIdx || 0, r.pages.length - 1);
    r.used = r.pages.map((p, pi) => p.categories.map((c, ci) => c.questions.map((_, qi) => !!(data.used && data.used[pi] && data.used[pi][ci] && data.used[pi][ci][qi]))));
    r.teams = (data.teams || []).map(t => ({ ...t, chat: t.chat || [], hintsLeft: t.hintsLeft == null ? HINTS_PER_TEAM : t.hintsLeft }));
    for (const p of data.players || []) {
      r.players.set(p.id, { ...p, connected: false, sockets: new Set(), lastChat: 0 });
    }
    r.brResults = data.brResults || null;
    r.duelTiles = Array.isArray(data.duelTiles) ? data.duelTiles : [];
    r.duelUsed = Array.isArray(data.duelUsed) ? data.duelUsed : [];
    r.log = data.log || [];
    const keep = ['lobby', 'teams', 'board', 'brIntro', 'brResults', 'final'];
    r.phase = keep.includes(data.phase) ? data.phase : data.phase === 'backrooms' ? 'brIntro' : 'board';
    if (r.phase === 'board') r.computePicking();
    return r;
  }

  saveSoon() {
    if (!this.saveDir || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 1000);
  }

  saveNow() {
    try {
      fs.mkdirSync(this.saveDir, { recursive: true });
      const file = path.join(this.saveDir, `room-${this.code}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.toJSON()));
      fs.renameSync(`${file}.tmp`, file);
    } catch (e) {
      console.error('[save]', e.message);
    }
  }
}

module.exports = { Room, VALUES };
