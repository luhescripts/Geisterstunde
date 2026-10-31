'use strict';

// Jede Kategorie-Art ("type" in questions.json) ist eine Battle-Mechanik.
// input bestimmt, wie Teams antworten:
//   draft        gemeinsamer Entwurf, jeder darf ändern, Kapitän legt fest
//   vote         jeder stimmt ab, Kapitän legt fest (bei Zeitablauf: Mehrheit)
//   teamGuess    das Team hat genau einen Versuch, wer zuerst abschickt, legt fest
//   race         alle tippen so oft sie wollen, schnellstes richtiges Team gewinnt
//   draw         eine Person malt, der Rest rät
//   puzzle       alle tauschen Teile, schnellstes Team gewinnt
//   hl           mehrere Runden höher/tiefer

const { matches } = require('./text');

const RACE = [1, 0.75, 0.5, 0.25];
const RANK = [1, 0.5, 0.25, 0];
const CLUE_FACTORS = [1, 0.8, 0.6, 0.4, 0.25];

const round5 = x => Math.round(x / 5) * 5;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffledIndices(n, avoidIdentity = true) {
  const base = [...Array(n).keys()];
  if (n < 2) return base;
  for (let tries = 0; tries < 50; tries++) {
    const s = shuffle(base);
    const fixed = s.filter((v, i) => v === i).length;
    if (!avoidIdentity || fixed <= Math.floor(n / 4)) return s;
  }
  return base.slice(1).concat(base[0]);
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Ränge mit Gleichstand: [{key}] -> rank 0 = bester (kleinster key)
function assignRanks(entries, key) {
  const sorted = entries.slice().sort((a, b) => key(a) - key(b));
  sorted.forEach((e, i) => {
    e.rank = i > 0 && key(e) === key(sorted[i - 1]) ? sorted[i - 1].rank : i;
  });
  return entries;
}

const fmt = (n, digits = 0) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits });
const fmtKm = km => (km < 1 ? 'unter 1 km' : `${fmt(Math.round(km))} km`);
const withUnit = (v, unit) => (unit ? `${fmt(v, 2)} ${unit}` : fmt(v, 2));
const pct = x => `${Math.round(x * 100)} %`;

function noAnswer(teamId, text = 'Keine Antwort') {
  return { teamId, text, detail: '', points: 0, correct: false };
}

// Schnellstes Team zuerst, nur wer gelöst hat, bekommt Punkte.
function raceResults(q, teams, label) {
  const solved = teams
    .filter(t => q.teams[t.id].solvedAt)
    .sort((a, b) => q.teams[a.id].solvedAt - q.teams[b.id].solvedAt);
  return teams.map(t => {
    const ts = q.teams[t.id];
    const rank = solved.indexOf(t);
    if (rank < 0) return noAnswer(t.id, label ? label(ts, false) : 'Nicht geschafft');
    const secs = ((ts.solvedAt - q.startedAt) / 1000).toFixed(1).replace('.', ',');
    return {
      teamId: t.id,
      text: label ? label(ts, true) : 'Geschafft',
      detail: `${secs} s · Platz ${rank + 1}`,
      points: round5(q.value * (RACE[rank] || 0.25)),
      correct: true,
      rank,
    };
  });
}

function qualityResults(q, teams, evaluate) {
  const evals = teams.map(t => {
    const ts = q.teams[t.id];
    if (ts.answer == null) return { t, ev: null };
    return { t, ev: evaluate(ts.answer), at: ts.lockedAt || Infinity };
  });
  const perfect = evals.filter(e => e.ev && e.ev.quality >= 1).sort((a, b) => a.at - b.at)[0];
  return evals.map(({ t, ev }) => {
    if (!ev) return noAnswer(t.id);
    const bonus = perfect && perfect.t === t ? round5(q.value * 0.25) : 0;
    return {
      teamId: t.id,
      text: ev.text,
      detail: `${pct(ev.quality)} richtig${bonus ? ' · schnellstes fehlerfreies Team +25 %' : ''}`,
      points: round5(q.value * ev.quality) + bonus,
      correct: ev.quality >= 1,
    };
  });
}

const MECH = {
  map: {
    label: 'Karten-Pin',
    icon: '📍',
    rule: 'Setzt eure Team-Nadel auf die Karte, euer Kapitän legt fest. Am nächsten dran: 100 %, Platz 2: 50 %, Platz 3: 25 %. Volltreffer im Umkreis: +100.',
    input: 'draft',
    time: q => q.data.time || 50,
    publicData: q => ({ prompt: q.data.prompt }),
    sanitizeDraft(q, d) {
      const lat = Number(d && d.lat);
      const lng = Number(d && d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) return undefined;
      const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
      return { lat: +lat.toFixed(4), lng: +wrapped.toFixed(4) };
    },
    resolve(q, teams) {
      const target = { lat: q.data.lat, lng: q.data.lng };
      const radius = q.data.radiusKm || 25;
      const placed = teams
        .filter(t => q.teams[t.id].answer)
        .map(t => ({ teamId: t.id, ans: q.teams[t.id].answer, km: haversineKm(q.teams[t.id].answer, target) }));
      assignRanks(placed, e => Math.round(e.km));
      const results = teams.map(t => {
        const p = placed.find(x => x.teamId === t.id);
        if (!p) return noAnswer(t.id, 'Keine Nadel gesetzt');
        const bull = p.km <= radius;
        return {
          teamId: t.id,
          text: fmtKm(p.km),
          detail: `Platz ${p.rank + 1}${bull ? ' · Volltreffer +100' : ''}`,
          points: round5(q.value * (RANK[p.rank] || 0)) + (bull ? 100 : 0),
          correct: p.rank === 0,
          rank: p.rank,
        };
      });
      return {
        answerText: q.data.label,
        results,
        extra: {
          target: { ...target, label: q.data.label },
          radiusKm: radius,
          pins: placed.map(p => ({ teamId: p.teamId, lat: p.ans.lat, lng: p.ans.lng, km: Math.round(p.km) })),
        },
      };
    },
    cheat: q => q.data.label,
  },

  estimate: {
    label: 'Schätz-Duell',
    icon: '⚖️',
    rule: 'Schätzt gemeinsam, euer Kapitän legt fest. Am nächsten dran: 100 %, Platz 2: 50 %, Platz 3: 25 %. Punktlandung: +100.',
    input: 'draft',
    time: q => q.data.time || 40,
    publicData: q => ({
      prompt: q.data.prompt,
      unit: q.data.unit || '',
      min: q.data.min,
      max: q.data.max,
      step: q.data.step || 1,
      scale: q.data.scale || 'linear',
      start: q.data.start != null ? q.data.start : q.data.scale === 'log' ? Math.round(Math.sqrt(q.data.min * q.data.max)) : Math.round((q.data.min + q.data.max) / 2),
    }),
    sanitizeDraft(q, d) {
      const v = Number(d);
      if (!Number.isFinite(v)) return undefined;
      return Math.min(q.data.max, Math.max(q.data.min, v));
    },
    resolve(q, teams) {
      const ans = q.data.answer;
      const log = q.data.scale === 'log';
      const diff = v => (log ? Math.abs(Math.log(Math.max(v, 1e-9) / ans)) : Math.abs(v - ans));
      const guessed = teams
        .filter(t => q.teams[t.id].answer != null)
        .map(t => ({ teamId: t.id, v: q.teams[t.id].answer, d: diff(q.teams[t.id].answer) }));
      assignRanks(guessed, e => Math.round(e.d * 1e6));
      const tol = q.data.tolerance || 0;
      const results = teams.map(t => {
        const g = guessed.find(x => x.teamId === t.id);
        if (!g) return noAnswer(t.id);
        const bull = Math.abs(g.v - ans) <= tol;
        const off = log
          ? g.v === ans ? 'exakt' : `Faktor ${fmt(Math.max(g.v / ans, ans / g.v), 1)} daneben`
          : g.v === ans ? 'exakt' : `${fmt(Math.abs(g.v - ans), 2)} daneben`;
        return {
          teamId: t.id,
          text: withUnit(g.v, q.data.unit),
          detail: `${off} · Platz ${g.rank + 1}${bull ? ' · Punktlandung +100' : ''}`,
          points: round5(q.value * (RANK[g.rank] || 0)) + (bull ? 100 : 0),
          correct: g.rank === 0,
          rank: g.rank,
        };
      });
      return { answerText: withUnit(ans, q.data.unit), results };
    },
    cheat: q => withUnit(q.data.answer, q.data.unit),
  },

  sort: {
    label: 'Sortieren',
    icon: '⏳',
    rule: 'Bringt alles in die richtige Reihenfolge, euer Kapitän legt fest. Punkte je nach Richtigkeit, das schnellste fehlerfreie Team bekommt +25 %.',
    input: 'draft',
    needsTouch: true,
    time: q => q.data.time || 55,
    setup(q) {
      q.order = shuffledIndices(q.data.items.length);
    },
    initDraft: q => q.order.slice(),
    publicData: q => ({
      prompt: q.data.prompt,
      top: q.data.top || 'Zuerst',
      bottom: q.data.bottom || 'Zuletzt',
      items: q.order.map(i => ({ id: i, label: q.data.items[i].label })),
    }),
    sanitizeDraft(q, d) {
      const n = q.data.items.length;
      if (!Array.isArray(d) || d.length !== n) return undefined;
      const arr = d.map(Number);
      if (new Set(arr).size !== n || arr.some(x => !Number.isInteger(x) || x < 0 || x >= n)) return undefined;
      return arr;
    },
    correctOrder(q) {
      const dir = q.data.order === 'desc' ? -1 : 1;
      return q.data.items.map((_, i) => i).sort((a, b) => dir * (q.data.items[a].value - q.data.items[b].value));
    },
    resolve(q, teams) {
      const correct = MECH.sort.correctOrder(q);
      const pos = new Map(correct.map((id, i) => [id, i]));
      const n = correct.length;
      const results = qualityResults(q, teams, order => {
        let good = 0;
        let total = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            total++;
            if (pos.get(order[i]) < pos.get(order[j])) good++;
          }
        }
        const exact = order.filter((id, i) => correct[i] === id).length;
        return { quality: total ? good / total : 0, text: `${exact} von ${n} Plätzen exakt` };
      });
      return {
        answerText: correct.map(i => q.data.items[i].label).join(' → '),
        results,
        extra: {
          correct: correct.map(i => ({ id: i, label: q.data.items[i].label, display: q.data.items[i].display || String(q.data.items[i].value) })),
          answers: Object.fromEntries(teams.map(t => [t.id, q.teams[t.id].answer || null])),
        },
      };
    },
    cheat: q => MECH.sort.correctOrder(q).map(i => q.data.items[i].label).join(' → '),
  },

  match: {
    label: 'Zuordnen',
    icon: '🔗',
    rule: 'Verbindet links und rechts (erst links antippen, dann rechts), euer Kapitän legt fest. Punkte je richtigem Paar, das schnellste fehlerfreie Team bekommt +25 %.',
    input: 'draft',
    time: q => q.data.time || 55,
    setup(q) {
      q.rightOrder = shuffledIndices(q.data.pairs.length);
    },
    initDraft: () => ({}),
    publicData: q => ({
      prompt: q.data.prompt,
      left: q.data.pairs.map((p, i) => ({ id: i, label: p.left })),
      right: q.rightOrder.map(i => ({ id: i, label: q.data.pairs[i].right })),
    }),
    sanitizeDraft(q, d) {
      const n = q.data.pairs.length;
      if (!d || typeof d !== 'object') return undefined;
      const out = {};
      const usedRight = new Set();
      for (const [k, v] of Object.entries(d)) {
        const l = Number(k);
        const r = Number(v);
        if (!Number.isInteger(l) || !Number.isInteger(r) || l < 0 || l >= n || r < 0 || r >= n || usedRight.has(r)) continue;
        usedRight.add(r);
        out[l] = r;
      }
      return out;
    },
    resolve(q, teams) {
      const n = q.data.pairs.length;
      const results = qualityResults(q, teams, m => {
        const good = Object.entries(m).filter(([l, r]) => Number(l) === r).length;
        return { quality: good / n, text: `${good} von ${n} Paaren richtig` };
      });
      return {
        answerText: q.data.pairs.map(p => `${p.left} ↔ ${p.right}`).join(' · '),
        results,
        extra: {
          pairs: q.data.pairs,
          answers: Object.fromEntries(teams.map(t => [t.id, q.teams[t.id].answer || null])),
        },
      };
    },
    cheat: q => q.data.pairs.map(p => `${p.left} = ${p.right}`).join(', '),
  },

  choice: {
    label: 'Schnellwahl',
    icon: '🎯',
    rule: 'Stimmt im Team ab, euer Kapitän legt fest. Richtig und am schnellsten: 100 %, danach 75 / 50 / 25 %. Falsch: 0.',
    input: 'vote',
    time: q => q.data.time || 30,
    publicData: q => ({ prompt: q.data.prompt, options: q.data.options }),
    validVote: (q, v) => Number.isInteger(v) && v >= 0 && v < q.data.options.length,
    resolve(q, teams) {
      const right = teams
        .filter(t => q.teams[t.id].answer === q.data.correct)
        .sort((a, b) => q.teams[a.id].lockedAt - q.teams[b.id].lockedAt);
      const results = teams.map(t => {
        const ans = q.teams[t.id].answer;
        if (ans == null) return noAnswer(t.id);
        const rank = right.indexOf(t);
        return {
          teamId: t.id,
          text: q.data.options[ans],
          detail: rank >= 0 ? `Richtig · Platz ${rank + 1}` : 'Falsch',
          points: rank >= 0 ? round5(q.value * (RACE[rank] || 0.25)) : 0,
          correct: rank >= 0,
        };
      });
      return { answerText: q.data.options[q.data.correct], results };
    },
    cheat: q => q.data.options[q.data.correct],
  },

  bet: {
    label: 'Lügendetektor',
    icon: '🤥',
    rule: 'Wahr oder gelogen? Stimmt ab und wählt euren Einsatz (25–100 % der Punkte), euer Kapitän legt fest. Richtig: Einsatz gewonnen. Falsch: die Hälfte des Einsatzes ist weg.',
    input: 'vote',
    time: q => q.data.time || 35,
    initDraft: () => 50,
    publicData: q => ({ statement: q.data.statement }),
    validVote: (q, v) => v === true || v === false,
    sanitizeDraft(q, d) {
      const w = Number(d);
      return [25, 50, 75, 100].includes(w) ? w : undefined;
    },
    lockAnswer: (q, ts, choice) => ({ choice, wager: ts.draft || 50 }),
    resolve(q, teams) {
      const results = teams.map(t => {
        const a = q.teams[t.id].answer;
        if (!a || a.choice == null) return noAnswer(t.id);
        const ok = a.choice === q.data.correct;
        const stake = q.value * (a.wager / 100);
        return {
          teamId: t.id,
          text: `${a.choice ? 'Wahr' : 'Gelogen'} · Einsatz ${a.wager} %`,
          detail: ok ? 'Richtig' : 'Falsch',
          points: ok ? round5(stake) : -round5(stake / 2),
          correct: ok,
        };
      });
      return { answerText: q.data.correct ? 'WAHR' : 'GELOGEN', results };
    },
    cheat: q => (q.data.correct ? 'WAHR' : 'GELOGEN'),
  },

  hl: {
    label: 'Höher oder Tiefer',
    icon: '⚡',
    rule: 'Mehrere Runden: Ist der nächste Wert höher oder tiefer? Stimmt ab, euer Kapitän legt fest. Jede richtige Runde bringt einen Anteil der Punkte.',
    input: 'hl',
    roundTime: q => q.data.roundTime || 13,
    showTime: 4200,
    rounds: q => q.data.items.length - 1,
    time: q => MECH.hl.rounds(q) * (MECH.hl.roundTime(q) + 4.2),
    publicData(q) {
      const r = q.round || 0;
      const shown = q.roundPhase === 'show' ? r + 1 : r;
      return {
        prompt: q.data.prompt,
        metric: q.data.metric,
        unit: q.data.unit || '',
        round: r,
        rounds: MECH.hl.rounds(q),
        roundPhase: q.roundPhase,
        items: q.data.items.map((it, i) => ({
          label: it.label,
          display: i <= shown ? it.display || fmt(it.value) : null,
          value: i <= shown ? it.value : null,
        })),
        history: q.hlRounds || [],
      };
    },
    validVote: (q, v) => v === 'up' || v === 'down',
    resolve(q, teams) {
      const rounds = MECH.hl.rounds(q);
      const results = teams.map(t => {
        const answers = q.teams[t.id].hlAnswers;
        const good = (q.hlRounds || []).filter((r, i) => answers[i] === r.correct).length;
        return {
          teamId: t.id,
          text: `${good} von ${rounds} Runden richtig`,
          detail: pct(good / rounds),
          points: round5((q.value * good) / rounds),
          correct: good === rounds,
        };
      });
      return {
        answerText: q.data.items.map(it => `${it.label} (${it.display || fmt(it.value)})`).join(' · '),
        results,
        extra: { items: q.data.items, history: q.hlRounds || [] },
      };
    },
    cheat: q => q.data.items.map(it => `${it.label}: ${it.display || fmt(it.value)}`).join(', '),
  },

  clues: {
    label: 'Hinweis-Jagd',
    icon: '🔎',
    rule: 'Alle paar Sekunden kommt ein neuer Hinweis. Euer Team hat GENAU EINEN Versuch – wer zuerst abschickt, legt fest. Bei Hinweis 1 gibt es 100 %, dann 80 / 60 / 40 / 25 %.',
    input: 'teamGuess',
    interval: q => q.data.interval || 7,
    time: q => q.data.clues.length * MECH.clues.interval(q) + 10,
    visible(q, now) {
      if (!q.startedAt) return 0;
      const n = 1 + Math.floor((now - q.startedAt) / (MECH.clues.interval(q) * 1000));
      return Math.max(1, Math.min(q.data.clues.length, n));
    },
    publicData(q, now) {
      const n = MECH.clues.visible(q, now);
      const interval = MECH.clues.interval(q) * 1000;
      return {
        prompt: q.data.prompt || 'Wer bin ich?',
        clues: q.data.clues.slice(0, n),
        total: q.data.clues.length,
        factors: CLUE_FACTORS,
        nextAt: n < q.data.clues.length && q.startedAt ? q.startedAt + n * interval : null,
      };
    },
    check: (q, text) => matches(text, q.data.answers),
    resolve(q, teams) {
      const results = teams.map(t => {
        const a = q.teams[t.id].answer;
        if (!a) return noAnswer(t.id, 'Kein Versuch');
        const f = CLUE_FACTORS[a.clue - 1] || 0.25;
        return {
          teamId: t.id,
          text: `„${a.text}“`,
          detail: `bei Hinweis ${a.clue} · ${a.ok ? `${pct(f)} der Punkte` : 'Falsch'}`,
          points: a.ok ? round5(q.value * f) : 0,
          correct: a.ok,
        };
      });
      return { answerText: q.data.answers[0], results, extra: { clues: q.data.clues } };
    },
    cheat: q => q.data.answers[0],
  },

  type: {
    label: 'Tipp-Rennen',
    icon: '⌨️',
    rule: 'Alle im Team dürfen tippen, so oft ihr wollt. Wer zuerst richtig liegt: 100 %, danach 75 / 50 / 25 %.',
    input: 'race',
    time: q => q.data.time || 45,
    publicData: q => ({ prompt: q.data.prompt, emoji: q.data.emoji || null }),
    check: (q, text) => matches(text, q.data.answers),
    resolve(q, teams) {
      return {
        answerText: q.data.answers[0],
        results: raceResults(q, teams, (ts, ok) => (ok ? `gelöst von ${ts.solvedBy}` : 'Nicht geschafft')),
      };
    },
    cheat: q => q.data.answers[0],
  },

  code: {
    label: 'Code knacken',
    icon: '🔐',
    rule: 'Löst das Rätsel und tippt den Zahlencode ins Schloss. Alle dürfen probieren, falsche Codes sperren euer Team kurz. Schnellstes Team: 100 %, danach 75 / 50 / 25 %.',
    input: 'race',
    time: q => q.data.time || 100,
    hintAt: q => q.startedAt + (MECH.code.time(q) * 1000) / 2,
    publicData: (q, now) => ({
      prompt: q.data.prompt,
      lines: q.data.lines || [],
      digits: String(q.data.code).length,
      hint: q.data.hint && q.startedAt && now >= MECH.code.hintAt(q) ? q.data.hint : null,
      hintAt: q.data.hint && q.startedAt ? MECH.code.hintAt(q) : null,
    }),
    check: (q, text) => String(text).replace(/\D/g, '') === String(q.data.code),
    resolve(q, teams) {
      return {
        answerText: `Code ${q.data.code}`,
        results: raceResults(q, teams, (ts, ok) => (ok ? `geknackt von ${ts.solvedBy}` : 'Tür blieb zu')),
        extra: { explain: q.data.explain || null },
      };
    },
    cheat: q => String(q.data.code),
  },

  draw: {
    label: 'Montagsmaler',
    icon: '🎨',
    rule: 'Pro Team malt eine Person den geheimen Begriff, alle anderen raten per Tippen. Wer zuerst errät: 100 %, danach 75 / 50 / 25 %. Keine Buchstaben malen!',
    input: 'draw',
    time: q => q.data.time || 80,
    publicData: q => ({ letters: q.data.word.length }),
    check: (q, text) => matches(text, [q.data.word, ...(q.data.answers || [])]),
    resolve(q, teams) {
      return {
        answerText: q.data.word,
        results: raceResults(q, teams, (ts, ok) => (ok ? `erraten von ${ts.solvedBy}` : 'Nicht erraten')),
      };
    },
    cheat: q => q.data.word,
  },

  puzzle: {
    label: 'Puzzle-Rennen',
    icon: '🧩',
    rule: 'Tauscht die Teile (erst ein Teil antippen, dann das Ziel), bis das Bild stimmt. Alle im Team puzzeln mit. Schnellstes Team: 100 %, danach 75 / 50 / 25 %. Bonus +25 %, wenn ihr danach den Film erratet.',
    input: 'puzzle',
    time: q => q.data.time || { 3: 90, 4: 150, 5: 210 }[q.data.grid] || 150,
    setup(q) {
      q.basePerm = shuffledIndices(q.data.grid * q.data.grid);
    },
    publicData: q => ({
      scene: q.data.scene,
      grid: q.data.grid,
      bonusQuestion: q.data.bonus ? q.data.bonus.question : null,
    }),
    checkBonus: (q, text) => !!q.data.bonus && matches(text, q.data.bonus.answers),
    resolve(q, teams) {
      const base = raceResults(q, teams, (ts, ok) => {
        if (ok) return `fertig (${ts.solvedBy} setzte das letzte Teil)`;
        const good = (ts.perm || []).filter((v, i) => v === i).length;
        return `${good} von ${q.data.grid * q.data.grid} Teilen richtig`;
      });
      const results = base.map(r => {
        const ts = q.teams[r.teamId];
        if (ts.bonus && ts.bonus.ok) {
          return { ...r, points: r.points + round5(q.value * 0.25), detail: `${r.detail} · Film erraten +25 %` };
        }
        return r;
      });
      return {
        answerText: q.data.bonus ? q.data.bonus.answers[0] : 'Bild komplett',
        results,
        extra: { scene: q.data.scene, grid: q.data.grid },
      };
    },
    cheat: q => (q.data.bonus ? `Film: ${q.data.bonus.answers[0]}` : ''),
  },
};

// ---------- Kaufbare Hinweise ----------
// Vorschläge für den Spielleiter. bet und hl haben keinen automatischen Hinweis,
// map nur über "buyHint" in questions.json – dort schreibt der Spielleiter sonst selbst.

function mask(s) {
  return String(s)
    .split(/\s+/)
    .map(word => {
      let first = true;
      return [...word]
        .map(ch => {
          if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
          if (first) {
            first = false;
            return ch;
          }
          return '·';
        })
        .join('');
    })
    .join('  ');
}

function niceRound(x) {
  const ax = Math.abs(x);
  if (ax < 100) return Math.round(x);
  const mag = Math.pow(10, Math.floor(Math.log10(ax)) - 1);
  return Math.round(x / mag) * mag;
}

const HINTS = {
  map: () => null,
  bet: () => null,
  hl: () => null,
  type: q => `So sieht die Lösung aus: ${mask(q.data.answers[0])}`,
  clues: q => `So sieht die Lösung aus: ${mask(q.data.answers[0])}`,
  draw: q => `Der Begriff sieht so aus: ${mask(q.data.word)}`,
  sort: q => `Ganz nach oben gehört: „${q.data.items[MECH.sort.correctOrder(q)[0]].label}“.`,
  match(q, ts) {
    const draft = ts.draft || {};
    const open = q.data.pairs.map((_, i) => i).filter(i => Number(draft[i]) !== i);
    const i = open.length ? open[Math.floor(Math.random() * open.length)] : 0;
    return `„${q.data.pairs[i].left}“ gehört zu „${q.data.pairs[i].right}“.`;
  },
  choice(q) {
    const n = q.data.options.length;
    const wrong = shuffle(q.data.options.map((_, i) => i).filter(i => i !== q.data.correct))
      .slice(0, Math.max(1, n - 2))
      .sort((a, b) => a - b);
    return `Ihr könnt streichen: ${wrong.map(i => `${'ABCDEFGH'[i]} („${q.data.options[i]}“)`).join(' und ')}.`;
  },
  estimate(q) {
    const d = q.data;
    const a = d.answer;
    const step = d.step || 1;
    let lo;
    let hi;
    if (d.scale === 'log') {
      lo = a / (1.8 + Math.random() * 1.2);
      hi = a * (1.8 + Math.random() * 1.2);
    } else {
      const span = Math.max(Math.abs(a) * 0.3, step * 4);
      lo = a - span * (0.35 + Math.random() * 0.65);
      hi = a + span * (0.35 + Math.random() * 0.65);
    }
    lo = Math.max(d.min, niceRound(lo));
    hi = Math.min(d.max, niceRound(hi));
    if (lo >= a) lo = Math.max(d.min, a - step);
    if (hi <= a) hi = Math.min(d.max, a + step);
    return `Die Antwort liegt zwischen ${fmt(lo)} und ${fmt(hi)}${d.unit ? ` ${d.unit}` : ''}.`;
  },
  code(q) {
    const c = String(q.data.code);
    return `Die letzte Ziffer ist eine ${c[c.length - 1]}.`;
  },
  puzzle: () => 'Wir legen bis zu 3 Teile für euch an die richtige Stelle.',
};

// Legt bis zu 3 Teile richtig, ohne das Puzzle komplett zu lösen.
function applyPuzzleHint(ts) {
  const perm = ts.perm;
  let fixed = 0;
  for (let i = 0; i < perm.length && fixed < 3; i++) {
    if (perm[i] === i) continue;
    if (perm.filter((v, k) => v !== k).length <= 3) break;
    const j = perm.indexOf(i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
    fixed++;
  }
  return fixed;
}

module.exports = { MECH, HINTS, applyPuzzleHint, shuffle, round5, haversineKm };
