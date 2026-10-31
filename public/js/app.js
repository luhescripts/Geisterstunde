(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: d });

  const snd = name => {
    try {
      if (window.Sound) window.Sound.play(name);
    } catch (e) {
      /* Ton ist optional */
    }
  };

  const store = {
    get(k, def = null, session = false) {
      try {
        const v = (session ? sessionStorage : localStorage).getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v, session = false) {
      try {
        (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v));
      } catch (e) {
        /* privater Modus */
      }
    },
    del(k, session = false) {
      try {
        (session ? sessionStorage : localStorage).removeItem(k);
      } catch (e) {
        /* egal */
      }
    },
  };

  const socket = io();

  const S = {
    role: null,
    code: null,
    hostToken: null,
    player: null,
    prefillCode: '',
    pub: null,
    team: null,
    me: null,
    host: null,
    offset: null,
    chat: [],
    chatOpen: null,
    unread: 0,
    chatAll: [],
    chatExpanded: new Set(),
    chatUnread: {},
    cheat: false,
    floats: [],
    lastScores: {},
    lastTickSec: null,
    drawGallery: null,
    timerTotals: {},
  };

  const serverNow = () => Date.now() + (S.offset || 0);
  const playerById = id => (S.pub && S.pub.players.find(p => p.id === id)) || null;
  const teamById = id => (S.pub && S.pub.teams.find(t => t.id === id)) || null;
  const myTeamId = () => (S.role === 'player' && S.me ? S.me.teamId : null);

  const CAPTAIN_INPUTS = ['draft', 'vote', 'hl'];
  const AMBIENT = { lobby: 'lobby', teams: 'lobby', board: 'board', intro: 'tension', question: 'tension', reveal: 'board', duel: 'tension', brIntro: 'lobby', backrooms: null, brResults: 'lobby', final: 'lobby' };

  // ---------- Hilfen ----------

  function toast(text, color) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    if (color) el.style.setProperty('--c', color);
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 3900);
  }

  function flash() {
    const f = $('#fx-flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  function send(a, payload = {}) {
    return new Promise(resolve => {
      socket.emit('p', { a, ...payload }, r => {
        if (r && r.error) toast(r.error, '#d0142c');
        resolve(r || {});
      });
    });
  }

  function hostSend(a, payload = {}) {
    return new Promise(resolve => {
      socket.emit('host', { a, ...payload }, r => {
        if (r && r.error) toast(r.error, '#d0142c');
        resolve(r || {});
      });
    });
  }

  function ctx() {
    const pub = S.pub;
    const q = pub && pub.q;
    const me = S.role === 'player' ? S.me : null;
    const myTeam = me ? teamById(me.teamId) : null;
    const ts = S.team && q && S.team.qid === q.id ? S.team : null;
    const capId = myTeam && q && q.teams[myTeam.id] ? q.teams[myTeam.id].captainId : null;
    const drawId = myTeam && q && q.teams[myTeam.id] ? q.teams[myTeam.id].drawerId : null;
    return {
      pub,
      q,
      data: q && q.data,
      me,
      isHost: S.role === 'host',
      myTeam,
      ts,
      isCaptain: !!(me && me.isCaptain),
      isDrawer: !!(me && me.isDrawer),
      captain: playerById(capId),
      drawer: playerById(drawId),
      send,
      hostSend,
      serverNow,
      playerById,
      teamById,
      snd,
      toast,
      esc,
      fmt,
      socket,
      gallery: () => S.drawGallery,
    };
  }

  function unlockSound() {
    try {
      if (window.Sound) window.Sound.unlock();
    } catch (e) {
      /* egal */
    }
  }

  window.addEventListener('pointerdown', unlockSound, true);
  window.addEventListener('keydown', unlockSound, true);

  // ---------- Verbindung & Sitzung ----------

  function boot() {
    const params = new URLSearchParams(location.search);
    const hostCode = (params.get('host') || '').toUpperCase();
    const joinCode = (params.get('r') || '').toUpperCase();
    if (hostCode) {
      const saved = store.get('gs-host');
      const key = params.get('key');
      if (key) {
        // Spielleiter-Link aus dem Server-Fenster: Der Schlüssel bleibt nicht in der Adresszeile stehen.
        history.replaceState(null, '', `/?host=${hostCode}`);
        S.role = 'host';
        S.code = hostCode;
        S.hostToken = key;
      } else if (saved && saved.code === hostCode) {
        S.role = 'host';
        S.code = saved.code;
        S.hostToken = saved.token;
      }
    } else if (joinCode) {
      const saved = store.get(`gs-player-${joinCode}`, null, true);
      if (saved) {
        S.role = 'player';
        S.code = joinCode;
        S.player = saved;
      } else {
        S.prefillCode = joinCode;
      }
    }
    render();
  }

  function resume() {
    if (S.role === 'host' && S.hostToken) {
      socket.emit('host:resume', { code: S.code, token: S.hostToken }, res => {
        if (res && res.error) {
          toast('Dieses Spiel gibt es nicht mehr oder der Spielleiter-Link stimmt nicht.', '#d0142c');
          const saved = store.get('gs-host');
          if (saved && saved.token === S.hostToken) store.del('gs-host');
          leaveToLanding();
        } else {
          store.set('gs-host', { code: S.code, token: S.hostToken });
        }
      });
    } else if (S.role === 'player' && S.player) {
      socket.emit('player:join', { code: S.code, playerId: S.player.playerId, secret: S.player.secret, name: S.player.name }, res => {
        if (res && res.error) {
          toast(res.error, '#d0142c');
          store.del(`gs-player-${S.code}`, true);
          S.prefillCode = S.code;
          leaveToLanding();
        }
      });
    }
  }

  function leaveToLanding() {
    S.role = null;
    S.pub = null;
    S.team = null;
    S.me = null;
    S.host = null;
    history.replaceState(null, '', S.prefillCode ? `/?r=${S.prefillCode}` : '/');
    render();
  }

  function createGame(errEl) {
    unlockSound();
    socket.emit('host:create', {}, res => {
      if (!res || res.error) {
        errEl.textContent = (res && res.error) || 'Keine Verbindung zum Server.';
        return;
      }
      S.role = 'host';
      S.code = res.code;
      S.hostToken = res.token;
      store.set('gs-host', { code: res.code, token: res.token });
      history.replaceState(null, '', `/?host=${res.code}`);
      render();
    });
  }

  function joinGame(code, name, errEl) {
    unlockSound();
    code = String(code || '').trim().toUpperCase();
    name = String(name || '').trim();
    if (code.length !== 4) {
      errEl.textContent = 'Der Raumcode hat 4 Buchstaben.';
      return;
    }
    if (!name) {
      errEl.textContent = 'Bitte gib deinen Namen ein.';
      return;
    }
    socket.emit('player:join', { code, name }, res => {
      if (!res || res.error) {
        errEl.textContent = (res && res.error) || 'Keine Verbindung zum Server.';
        return;
      }
      S.role = 'player';
      S.code = res.code;
      S.player = { playerId: res.playerId, secret: res.secret, name: res.name };
      store.set(`gs-player-${res.code}`, S.player, true);
      store.set('gs-name', res.name);
      history.replaceState(null, '', `/?r=${res.code}`);
      render();
    });
  }

  socket.on('connect', () => {
    $('#conn').classList.add('hidden');
    resume();
  });

  socket.on('disconnect', () => {
    if (S.role) $('#conn').classList.remove('hidden');
  });

  socket.on('state', pub => {
    const est = pub.now - Date.now();
    S.offset = S.offset == null ? est : S.offset * 0.7 + est * 0.3;
    const prev = S.pub;
    S.pub = pub;
    transitions(prev, pub);
    render();
  });

  socket.on('team', t => {
    S.team = t;
    render();
  });

  socket.on('me', m => {
    S.me = m;
    render();
  });

  socket.on('host', h => {
    S.host = h;
    render();
  });

  socket.on('toast', t => {
    toast(t.text, t.color);
    if (t.sfx === 'join') snd('join');
    else if (t.sfx === 'solved') snd('pop');
  });

  socket.on('chat', m => {
    S.chat.push(m);
    if (S.chat.length > 80) S.chat.shift();
    if (!S.chatOpen) {
      S.unread++;
      snd('click');
      if (!S.me || m.pid !== S.me.id) showChatPreview(m);
    }
    renderChat(true);
  });

  socket.on('chat:history', list => {
    S.chat = list || [];
    renderChat(true);
  });

  // Spielleiter: liest alle Team-Chats mit
  socket.on('chat:host', m => {
    S.chatAll.push(m);
    if (S.chatAll.length > 400) S.chatAll.shift();
    if (!S.chatOpen || !S.chatExpanded.has(m.teamId)) S.chatUnread[m.teamId] = (S.chatUnread[m.teamId] || 0) + 1;
    renderChat(true);
  });

  socket.on('chat:hostHistory', list => {
    S.chatAll = (list || []).flatMap(t => (t.chat || []).map(m => ({ ...m, teamId: t.teamId }))).sort((a, b) => a.at - b.at);
    S.chatUnread = {};
    renderChat(true);
  });

  socket.on('kicked', () => {
    store.del(`gs-player-${S.code}`, true);
    toast('Du wurdest vom Host entfernt.', '#d0142c');
    S.prefillCode = '';
    leaveToLanding();
  });

  socket.on('draw:stroke', d => current.inst && current.inst.onStroke && current.inst.onStroke(d));
  socket.on('draw:clear', d => current.inst && current.inst.onClear && current.inst.onClear(d));
  socket.on('draw:gallery', g => {
    S.drawGallery = g;
    if (current.onGallery) current.onGallery(g);
  });

  function transitions(prev, pub) {
    const was = prev ? prev.phase : null;
    if (was !== pub.phase) {
      if (pub.phase === 'intro' || pub.phase === 'brIntro' || pub.phase === 'duel') {
        snd('thunder');
        flash();
      } else if (pub.phase === 'reveal') snd('reveal');
      else if (pub.phase === 'final') snd('fanfare');
      else if (pub.phase === 'teams') snd('drumroll');
      else if (pub.phase === 'board' && (was === 'teams' || was === 'brResults')) snd('whoosh');
      if (pub.phase === 'reveal' && pub.q && pub.q.type !== 'draw') S.drawGallery = null;
      try {
        if (window.Sound) window.Sound.ambient(AMBIENT[pub.phase] === undefined ? null : AMBIENT[pub.phase]);
      } catch (e) {
        /* egal */
      }
    }
    if (prev && prev.q && pub.q && prev.q.id === pub.q.id) {
      for (const [tid, st] of Object.entries(pub.q.teams)) {
        const before = prev.q.teams[tid];
        if (!before) continue;
        const mine = tid === myTeamId();
        if ((!before.locked && st.locked) || (!before.hlLocked && st.hlLocked)) snd(mine ? 'lock' : 'click');
      }
    }
    for (const t of pub.teams) {
      const before = S.lastScores[t.id];
      if (before != null && before !== t.score) S.floats.push({ teamId: t.id, delta: t.score - before });
      S.lastScores[t.id] = t.score;
    }
  }

  // ---------- Takt (Countdowns) ----------

  setInterval(() => {
    const now = serverNow();
    for (const el of $$('[data-ends]')) {
      const ends = Number(el.dataset.ends);
      if (!ends) continue;
      const left = Math.max(0, ends - now);
      if (el.classList.contains('secs') || el.classList.contains('cd')) {
        const s = Math.ceil(left / 1000);
        if (el.textContent !== String(s)) el.textContent = s;
        if (el.classList.contains('secs')) el.classList.toggle('urgent', s <= 5 && left > 0);
      }
      if (el.classList.contains('bar')) {
        const total = Number(el.dataset.total) || 1;
        const i = el.firstElementChild;
        if (i) i.style.transform = `scaleX(${Math.max(0, Math.min(1, left / total))})`;
        el.classList.toggle('urgent', left < 5000);
      }
    }
    const pub = S.pub;
    const q = pub && pub.q;
    if (pub && pub.phase === 'question' && q && q.endsAt && !(q.type === 'hl' && q.data && q.data.roundPhase !== 'choose')) {
      const s = Math.ceil((q.endsAt - now) / 1000);
      if (s !== S.lastTickSec) {
        if (s > 0 && s <= 5) snd('tickUrgent');
        else if (s > 5 && s <= 10) snd('tick');
        S.lastTickSec = s;
      }
    }
    if (current.inst && current.inst.tick) current.inst.tick(ctx(), now);
  }, 100);

  function timerTotal(endsAt) {
    if (!endsAt) return 1;
    if (!S.timerTotals[endsAt]) S.timerTotals[endsAt] = Math.max(1000, endsAt - serverNow());
    return S.timerTotals[endsAt];
  }

  // ---------- Rendern ----------

  let current = { key: null };

  function screenKey() {
    if (!S.role) return 'landing';
    if (!S.pub || (S.role === 'player' && !S.me)) return 'loading';
    const ph = S.pub.phase;
    const q = S.pub.q;
    if ((ph === 'intro' || ph === 'question' || ph === 'reveal') && q) return `${ph}:${q.id}`;
    if (ph === 'duel' && S.pub.duel) return `duel:${S.pub.duel.id}:${S.pub.duel.step}:${S.me && S.me.isFighter ? 'f' : ''}`;
    return ph;
  }

  // Spieler erfahren, wenn der Spielleiter weg ist – erst nach ein paar Sekunden, damit Neuladen nicht aufblinkt.
  let hostAwayTimer = null;
  function renderHostAway() {
    const box = $('#hostaway');
    // In den Backrooms braucht es den Spielleiter erst am Ende – dort nicht übers Bild legen.
    const away = () => S.role === 'player' && !!S.pub && !S.pub.hostOnline && S.pub.phase !== 'backrooms';
    if (!away()) {
      clearTimeout(hostAwayTimer);
      hostAwayTimer = null;
      box.classList.add('hidden');
    } else if (box.classList.contains('hidden') && !hostAwayTimer) {
      hostAwayTimer = setTimeout(() => {
        hostAwayTimer = null;
        if (away()) box.classList.remove('hidden');
      }, 5000);
    }
  }

  function render() {
    const phase = S.pub && S.role ? S.pub.phase : null;
    document.body.classList.toggle('phase-backrooms', phase === 'backrooms');
    renderTopbar();
    renderDock();
    renderHostAway();
    renderChat();
    const key = screenKey();
    if (key !== current.key) {
      try {
        if (current.unmount) current.unmount();
      } catch (e) {
        console.error(e);
      }
      const stage = $('#stage');
      stage.innerHTML = '';
      window.scrollTo(0, 0);
      const make = SCREENS[key.split(':')[0]] || SCREENS.loading;
      current = make() || {};
      current.key = key;
      try {
        if (current.mount) current.mount(stage);
      } catch (e) {
        console.error(e);
        stage.innerHTML = `<div class="card">Fehler beim Anzeigen: ${esc(e.message)}</div>`;
      }
    }
    try {
      if (current.update) current.update();
    } catch (e) {
      console.error(e);
    }
  }

  function renderTopbar() {
    const tb = $('#topbar');
    const pub = S.pub;
    let chips = '';
    if (S.role && pub && pub.teams.length) {
      chips = pub.teams
        .map(t => {
          const cls = ['chip'];
          if (t.id === myTeamId()) cls.push('mine');
          if (pub.phase === 'board' && t.id === pub.pickingTeamId) cls.push('turn');
          return `<div class="${cls.join(' ')}" data-team="${t.id}" style="--c:${t.color}"><span class="dot"></span><span class="nm">${esc(t.name)}</span><span class="sc">${fmt(t.score)}</span></div>`;
        })
        .join('');
    }
    const html =
      `<div class="logo">🎃 Geisterstunde</div>` +
      (S.role && S.code ? `<div class="roomcode">${esc(S.code)}</div>` : '') +
      `<div class="chips ${pub && pub.teams.length > 4 ? 'many' : ''}">${chips}</div>` +
      `<div class="tools">` +
      (S.role === 'host' ? `<button class="iconbtn ${S.cheat ? 'on' : ''}" data-tool="cheat" title="Spickzettel mit der Lösung im Dock zeigen">🗒️</button>` : '') +
      `<button class="iconbtn" data-tool="vol" title="Lautstärke">${volIcon()}</button>` +
      `<button class="iconbtn" data-tool="fs" title="Vollbild">⛶</button>` +
      `</div>`;
    if (tb.dataset.sig !== html) {
      tb.innerHTML = html;
      tb.dataset.sig = html;
      fitChips();
    }
    for (const f of S.floats.splice(0)) {
      const chip = tb.querySelector(`[data-team="${f.teamId}"]`);
      if (!chip) continue;
      const sp = document.createElement('span');
      sp.className = `floatpts ${f.delta > 0 ? 'pos' : 'neg'}`;
      sp.textContent = `${f.delta > 0 ? '+' : ''}${fmt(f.delta)}`;
      chip.appendChild(sp);
      setTimeout(() => sp.remove(), 1900);
    }
  }

  // Bei vielen Teams oder schmalem Fenster: Logo weg, dann zweizeilig, zuletzt ohne Namen und Raumcode
  function fitChips() {
    const tb = $('#topbar');
    const c = tb.querySelector('.chips');
    tb.classList.remove('crowded', 'packed');
    if (!c || !c.children.length) return;
    c.classList.remove('rows', 'tight');
    c.style.setProperty('--cols', Math.ceil(c.children.length / 2));
    const steps = [
      () => tb.classList.add('crowded'),
      () => c.classList.add('rows'),
      () => (c.classList.add('tight'), tb.classList.add('packed')),
    ];
    for (const step of steps) {
      if (c.scrollWidth <= c.clientWidth + 1) return;
      step();
    }
  }
  // Lange Wörter ("Montagsmaler", "Mitternachtsmeute") lieber etwas kleiner setzen als mitten im Wort umbrechen
  function fitWords(selector, minPx) {
    for (const el of document.querySelectorAll(selector)) {
      el.style.fontSize = '';
      el.style.overflowWrap = 'normal';
      // pixelgenau messen – schon ein Bruchteil Überstand würde das Wort trennen
      const text = document.createRange();
      text.selectNodeContents(el);
      const over = () => text.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.05;
      let size = parseFloat(getComputedStyle(el).fontSize);
      if (over()) {
        // erst grob auf die passende Größe skalieren, dann in halben Pixeln nachregeln
        size = Math.max(minPx, Math.floor((size * el.getBoundingClientRect().width * 2) / text.getBoundingClientRect().width) / 2);
        el.style.fontSize = `${size}px`;
        while (over() && size > minPx) el.style.fontSize = `${(size -= 0.5)}px`;
      }
      el.style.overflowWrap = '';
    }
  }
  function fitCatNames() {
    fitWords('.cathead .nm', 9);
  }
  function fitTeamNames() {
    fitWords('.teamcol h3, .pod .nm', 14);
  }
  function refit() {
    fitChips();
    fitCatNames();
    fitTeamNames();
  }
  // Neu einpassen, sobald sich die nutzbare Breite ändert (Fenster, gedrehtes Handy, auftauchende Scrollleiste)
  let fitWidth = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w === fitWidth) return;
    fitWidth = w;
    refit();
    renderChat(); // Chat-Spalte an- oder abdocken, wenn das Fenster schmaler oder breiter wird
  }).observe($('#topbar'));
  if (document.fonts) document.fonts.ready.then(refit);

  $('#topbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const tool = b.dataset.tool;
    if (tool === 'vol') {
      unlockSound();
      toggleVolPop(b);
    } else if (tool === 'fs') {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } else if (tool === 'cheat') {
      S.cheat = !S.cheat;
      render();
    }
  });

  // ---------- Lautstärke ----------
  // Klick aufs Lautsprecher-Symbol öffnet einen Regler (leiser/lauter) und einen Stumm-Knopf.

  function volIcon() {
    const Snd = window.Sound;
    if (!Snd || Snd.muted || Snd.volume === 0) return '🔇';
    return Snd.volume < 0.5 ? '🔉' : '🔊';
  }

  const volPop = document.createElement('div');
  volPop.id = 'volpop';
  volPop.className = 'hidden';
  volPop.innerHTML = `<button class="iconbtn" type="button" data-vol="mute" title="Ton aus/an"></button><input type="range" min="0" max="100" step="1" aria-label="Lautstärke"><span class="pct"></span>`;
  document.body.appendChild(volPop);

  function renderVolPop() {
    const Snd = window.Sound;
    if (!Snd) return;
    const slider = $('input', volPop);
    if (document.activeElement !== slider) slider.value = Math.round(Snd.volume * 100);
    $('[data-vol]', volPop).textContent = volIcon();
    $('.pct', volPop).textContent = Snd.muted ? 'stumm' : `${Math.round(Snd.volume * 100)} %`;
    renderTopbar();
  }

  function toggleVolPop(btn) {
    if (!volPop.classList.contains('hidden')) {
      volPop.classList.add('hidden');
      return;
    }
    const r = btn.getBoundingClientRect();
    volPop.style.top = `${Math.round(r.bottom + 8)}px`;
    volPop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    volPop.classList.remove('hidden');
    renderVolPop();
  }

  $('input', volPop).addEventListener('input', e => {
    if (window.Sound) window.Sound.setVolume(e.target.value / 100);
    renderVolPop();
  });
  $('input', volPop).addEventListener('change', () => snd('click'));
  $('[data-vol]', volPop).addEventListener('click', () => {
    if (!window.Sound) return;
    if (window.Sound.volume === 0) window.Sound.setVolume(0.5);
    else window.Sound.toggleMute();
    renderVolPop();
  });
  // Klick daneben oder ESC schließt den Regler
  document.addEventListener('pointerdown', e => {
    if (!volPop.classList.contains('hidden') && !volPop.contains(e.target) && !e.target.closest('[data-tool="vol"]')) volPop.classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') volPop.classList.add('hidden');
  });

  // ---------- Host-Dock ----------

  function renderDock() {
    const d = $('#dock');
    if (S.role !== 'host' || !S.pub) {
      if (d.innerHTML) d.innerHTML = '';
      d.dataset.sig = '';
      document.body.classList.remove('has-dock');
      return;
    }
    document.body.classList.add('has-dock');
    const pub = S.pub;
    const q = pub.q;
    const b = (act, label, cls = '', extra = '') => `<button class="btn sm ${cls}" data-act="${act}" ${extra}>${label}</button>`;
    let html = '';
    switch (pub.phase) {
      case 'lobby':
        html += `<span class="lbl">${pub.players.length} Spieler → ${pub.teamOptions[0]} Teams${pub.players.length % 2 ? ' (eins davon allein)' : ''}</span>`;
        html += b('shuffle', '🎲 Teams auslosen', 'primary', pub.players.length < 2 ? 'disabled' : '');
        break;
      case 'teams':
        html += b('toLobby', '← Lobby');
        html += b('shuffle', '🎲 Neu auslosen');
        html += b('start', '▶ Spiel starten', 'primary');
        break;
      case 'board':
        html += `<span class="lbl">Klick ein Feld – oder lass das Team wählen</span>`;
        html += pub.page === 0 ? b('endPage', '⏭ Seite beenden → Backrooms', 'ghost') : b('endPage', '⏭ Spiel beenden → Finale', 'ghost');
        break;
      case 'intro':
        html += b('skipIntro', '⏩ Sofort starten', 'primary');
        html += b('cancel', '✖ Abbrechen (Feld bleibt offen)', 'ghost');
        break;
      case 'question':
        html += b('addTime', '+15 s');
        html += b('resolve', '⏹ Jetzt auflösen', 'primary');
        html += b('cancel', '✖ Abbrechen', 'ghost');
        break;
      case 'reveal':
        html += b('next', '▶ Weiter', 'primary');
        break;
      case 'duel': {
        const d = pub.duel;
        if (!d) break;
        if (d.step === 'challenge') html += `<span class="lbl">Der Herausforderer wählt seinen Gegner …</span>`;
        if (d.step === 'fighters') html += b('duelFighters', '🎲 Fehlende Kämpfer zufällig bestimmen');
        if (d.step === 'question') html += b('duelTime', '+15 s') + b('duelResolve', '⏹ Jetzt auflösen', 'primary');
        if (d.step === 'reveal') html += b('next', '▶ Weiter', 'primary');
        else html += b('duelSkip', '✖ Duell überspringen', 'ghost');
        break;
      }
      case 'brIntro':
        html += b('brStart', '▶ Backrooms starten', 'primary');
        break;
      case 'backrooms':
        html += b('brEnd', '⏹ Vorzeitig beenden', 'danger');
        break;
      case 'brResults':
        html += b('brNext', '▶ Weiter zu Seite 2', 'primary');
        break;
      case 'final':
        html += b('reset', '🔄 Neues Spiel (gleiche Spieler)');
        break;
      default:
        break;
    }
    if (S.cheat && S.host && S.host.cheat && (pub.phase === 'duel' || (q && q.status !== 'reveal'))) html += `<span class="cheat">🗒️ ${esc(S.host.cheat)}</span>`;
    if (d.dataset.sig !== html) {
      d.innerHTML = html;
      d.dataset.sig = html;
    }
  }

  const CONFIRM = {
    cancel: 'Frage abbrechen? Es gibt keine Punkte, das Feld bleibt offen.',
    endPage: 'Diese Seite jetzt beenden? Offene Felder verfallen.',
    brEnd: 'Backrooms jetzt beenden? Gezählt wird der aktuelle Stand.',
    duelSkip: 'Duell überspringen? Es werden keine Punkte gestohlen.',
    reset: 'Neues Spiel starten? Alle Punkte werden gelöscht.',
  };

  $('#dock').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (CONFIRM[act] && !window.confirm(CONFIRM[act])) return;
    snd('click');
    hostSend(act);
  });

  $('#dock').addEventListener('change', e => {
    const sel = e.target.closest('[data-change]');
    if (sel && sel.dataset.change === 'teamCount') hostSend('teamCount', { n: Number(sel.value) });
  });

  // ---------- Team-Chat ----------
  // Spieler: kleines Fenster fürs eigene Team. Auf breiten Bildschirmen steht es als Spalte rechts
  // neben dem Spiel und verdeckt nichts. Spielleiter: alle Team-Chats, jedes Team einzeln auf- und
  // zuklappbar, schwebt über dem Spiel.

  const wideChat = () => window.innerWidth >= 1100;
  const chatLine = m => `<div class="msg">${esc(m.avatar)} <b>${esc(m.name)}:</b> ${esc(m.text)}</div>`;
  let chatPreviewTimer = null;

  function setChatOpen(open) {
    S.chatOpen = open;
    store.set('gs-chat', open ? 'open' : 'closed', true);
    if (open) S.unread = 0;
    renderChat(true);
    const inp = open && $('#chat input');
    if (inp) inp.focus();
  }

  function setChatDocked(on) {
    if (document.body.classList.contains('chat-docked') === on) return;
    document.body.classList.toggle('chat-docked', on);
    refit();
    window.dispatchEvent(new Event('resize')); // Leaflet-Karten passen ihre Größe an
  }

  // Neue Nachricht bei eingeklapptem Chat kurz als Sprechblase zeigen
  function showChatPreview(m) {
    const el = $('#chat .chatpreview');
    if (!el) return;
    el.innerHTML = `${esc(m.avatar)} <b>${esc(m.name)}:</b> ${esc(m.text)}`;
    el.classList.remove('hidden');
    clearTimeout(chatPreviewTimer);
    chatPreviewTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  }

  function renderChat(force) {
    const box = $('#chat');
    const pub = S.pub;
    const host = S.role === 'host';
    // Wer allein im Team ist, braucht keinen Team-Chat.
    const teamSize = S.me && pub ? pub.players.filter(p => p.teamId === S.me.teamId).length : 0;
    const inGame = !!pub && !['lobby', 'backrooms'].includes(pub.phase);
    const show = inGame && (host ? pub.teams.length > 0 : S.role === 'player' && !!S.me && !!S.me.teamId && teamSize > 1);
    if (!show) {
      if (box.innerHTML) box.innerHTML = '';
      setChatDocked(false);
      return;
    }
    if (S.chatOpen == null) {
      const pref = store.get('gs-chat', null, true);
      S.chatOpen = pref ? pref === 'open' : !host && wideChat();
    }
    if (box.dataset.role !== S.role) {
      box.innerHTML = '';
      box.dataset.role = S.role;
    }
    if (!box.firstChild) {
      box.innerHTML = host
        ? `<button class="chatbtn" type="button">💬 Team-Chats<span class="badge hidden"></span></button>
          <div class="chatpanel host hidden">
            <div class="chathead">💬 Team-Chats<span class="sub">nur du siehst das</span><button class="chatmin" type="button" title="Einklappen">–</button></div>
            <div class="chatwarn">⚠️ Nicht offen lassen, wenn du deinen Bildschirm teilst.</div>
            <div class="chatteams"></div>
          </div>`
        : `<button class="chatbtn" type="button">💬 Team-Chat<span class="badge hidden"></span></button>
          <div class="chatpreview hidden"></div>
          <div class="chatpanel hidden">
            <div class="chathead">💬 <span class="tn"></span><span class="sub">nur euer Team sieht das</span><button class="chatmin" type="button" title="Chat einklappen">–</button></div>
            <div class="msgs"></div>
            <form><input class="inp" maxlength="200" placeholder="Nachricht ans Team …" autocomplete="off"><button class="btn sm primary">➤</button></form>
          </div>`;
      $('.chatbtn', box).addEventListener('click', () => setChatOpen(true));
      $('.chatmin', box).addEventListener('click', () => setChatOpen(false));
      if (host) {
        $('.chatteams', box).addEventListener('click', e => {
          const head = e.target.closest('.cthead');
          if (!head) return;
          const id = head.parentElement.dataset.team;
          if (S.chatExpanded.has(id)) S.chatExpanded.delete(id);
          else {
            S.chatExpanded.add(id);
            S.chatUnread[id] = 0;
          }
          renderChat(true);
        });
      } else {
        $('.chatpreview', box).addEventListener('click', () => setChatOpen(true));
        $('form', box).addEventListener('submit', e => {
          e.preventDefault();
          const inp = $('input', box);
          const text = inp.value.trim();
          if (!text) return;
          inp.value = '';
          // Abgelehnt (zu schnell hintereinander)? Dann bleibt der Text zum erneuten Senden stehen.
          send('chat', { text }).then(r => {
            if (r.error && !inp.value) inp.value = text;
          });
        });
      }
      force = true;
    }
    $('.chatbtn', box).classList.toggle('hidden', S.chatOpen);
    $('.chatpanel', box).classList.toggle('hidden', !S.chatOpen);
    if (S.chatOpen && !host) $('.chatpreview', box).classList.add('hidden');
    const unread = host ? Object.values(S.chatUnread).reduce((a, b) => a + b, 0) : S.unread;
    const badge = $('.badge', box);
    badge.classList.toggle('hidden', !unread);
    badge.textContent = unread;
    if (host) renderHostChats(box, force);
    else renderTeamChat(box, force);
    setChatDocked(!host && S.chatOpen && wideChat());
  }

  function renderTeamChat(box, force) {
    const t = teamById(S.me.teamId);
    $('.tn', box).textContent = t ? t.name : 'Team';
    if (!force) return;
    const msgs = $('.msgs', box);
    msgs.innerHTML = S.chat.length ? S.chat.map(chatLine).join('') : '<div class="muted">Hier könnt ihr euch heimlich absprechen – ohne dass die anderen mithören.</div>';
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderHostChats(box, force) {
    const wrap = $('.chatteams', box);
    const sig = S.pub.teams.map(t => t.id + t.name).join('|') + S.pub.players.map(p => p.teamId).join('');
    if (wrap.dataset.sig !== sig) {
      wrap.dataset.sig = sig;
      force = true;
    }
    if (!force) return;
    wrap.innerHTML = S.pub.teams
      .map(t => {
        const list = S.chatAll.filter(m => m.teamId === t.id);
        const open = S.chatExpanded.has(t.id);
        const unread = S.chatUnread[t.id] || 0;
        const who = S.pub.players.filter(p => p.teamId === t.id).map(p => p.name).join(', ');
        return `<section class="ct ${open ? 'open' : ''}" data-team="${t.id}" style="--c:${t.color}">
          <button class="cthead" type="button"><span class="dot"></span><b>${esc(t.name)}</b><span class="who">${esc(who)}</span>${
            unread ? `<span class="badge">${unread}</span>` : `<span class="cnt">${list.length}</span>`
          }<span class="chev">${open ? '▾' : '▸'}</span></button>
          ${open ? `<div class="msgs">${list.length ? list.map(chatLine).join('') : '<div class="muted">Noch nichts geschrieben.</div>'}</div>` : ''}
        </section>`;
      })
      .join('');
    for (const m of wrap.querySelectorAll('.msgs')) m.scrollTop = m.scrollHeight;
  }

  // ---------- Bildschirme ----------

  function questionHead(q) {
    return `<div class="qhead"><span class="qcat">${esc(q.catIcon)} ${esc(q.catName)}</span><span class="qval">· ${q.value}</span><span class="pill qmech">${esc(q.mech.icon)} ${esc(q.mech.label)}</span>`;
  }

  function roleText(C) {
    const q = C.q;
    if (!C.me || !q) return '';
    const cap = C.captain ? C.captain.name : 'euer Kapitän';
    switch (q.input) {
      case 'draft':
      case 'vote':
      case 'hl':
        return C.isCaptain
          ? '👑 Du bist diesmal Kapitän: Besprecht euch und drückt dann auf „Festlegen“.'
          : `👑 ${esc(cap)} ist Kapitän und legt fest – du kannst mitmachen und abstimmen.`;
      case 'teamGuess':
        return '🙌 Ihr habt EINEN gemeinsamen Versuch – wer zuerst abschickt, legt fest. Sprecht euch ab!';
      case 'race':
        return q.type === 'code' ? '🔐 Alle dürfen Codes probieren – ein falscher Code sperrt euer Team kurz.' : '⌨️ Alle im Team dürfen tippen – so oft ihr wollt!';
      case 'draw': {
        const watched = C.myTeam && q.teams[C.myTeam.id] && q.teams[C.myTeam.id].watch;
        if (watched) return `🎨 Du spielst allein – du rätst bei der Zeichnung von <b>${esc((teamById(watched) || {}).name || '?')}</b> mit. Wer zuerst errät, gewinnt!`;
        return C.isDrawer ? `🎨 Du malst! Dein Begriff: <b>${esc(C.me.word || '')}</b> – keine Buchstaben oder Zahlen!` : `🎨 ${esc(C.drawer ? C.drawer.name : 'Jemand')} malt für euch – ratet durch Tippen!`;
      }
      case 'puzzle':
        return '🧩 Alle puzzeln mit: ein Teil antippen, dann das Ziel antippen.';
      default:
        return '';
    }
  }

  // Einladungslink: Läuft der Tunnel, zeigt der Host auch über localhost den Online-Link.
  const isLocalHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const linkBase = () => (isLocalHost() && S.pub && S.pub.publicUrl ? S.pub.publicUrl : location.origin);

  function inviteLink() {
    return `${linkBase()}/?r=${S.code}`;
  }

  // Mit Schlüssel: bringt den Host auch aus einem anderen Browser oder von einem anderen PC zurück.
  function hostLink() {
    return `${linkBase()}/?host=${S.code}&key=${S.hostToken}`;
  }

  // ---------- Hinweise kaufen ----------

  function renderHintBar(el, C) {
    if (!el) return;
    const q = C.q;
    const ts = C.ts;
    const t = C.myTeam;
    let html = '';
    if (!C.isHost && t && ts && q && q.status === 'active') {
      const cost = S.pub.hintCost;
      if (ts.hint) html = `<div class="hintbar got">💡 <b>Euer Hinweis:</b> ${esc(ts.hint.text)}</div>`;
      else if (ts.hintPending) html = '<div class="hintbar wait">💡 Eure Anfrage liegt beim Spielleiter …</div>';
      else {
        const done = ts.locked || ts.solvedAt || (q.type === 'hl' && ts.hlLocked);
        const why = t.hintsLeft <= 0 ? 'keine Hinweise mehr' : t.score < cost ? 'zu wenig Punkte' : done ? 'ihr seid schon fertig' : '';
        html = `<div class="hintbar"><button class="btn sm" type="button" data-buyhint ${why ? 'disabled' : ''}>💡 Hinweis kaufen (−${cost})</button><span class="muted">noch ${t.hintsLeft} von ${S.pub.hintsPerTeam}${why ? ` · ${why}` : ''}</span></div>`;
      }
    }
    if (el.dataset.sig !== html) {
      el.innerHTML = html;
      el.dataset.sig = html;
    }
  }

  function renderHintRequests(el) {
    if (!el) return;
    const reqs = (S.host && S.host.hintRequests) || [];
    const open = new Set(reqs.map(r => r.teamId));
    for (const card of [...el.children]) if (!open.has(card.dataset.req)) card.remove();
    for (const r of reqs) {
      if (el.querySelector(`[data-req="${r.teamId}"]`)) continue;
      const t = teamById(r.teamId);
      const card = document.createElement('div');
      card.className = 'hintreq';
      card.dataset.req = r.teamId;
      card.style.setProperty('--c', t ? t.color : '#ff8c1a');
      card.innerHTML = `
        <div>💡 <b>${esc(t ? t.name : '?')}</b> möchte einen Hinweis <span class="muted">(angefragt von ${esc(r.by)} · noch ${r.hintsLeft} Hinweise · ${fmt(r.score)} Punkte)</span></div>
        <textarea class="inp" rows="2" maxlength="220" placeholder="Hinweistext für das Team …"></textarea>
        <div class="row wrap"><button class="btn sm primary" type="button" data-unlock>Freischalten (−${S.pub.hintCost})</button><button class="btn sm ghost" type="button" data-decline>Ablehnen</button>${
          r.suggestion ? '<span class="muted">Vorschlag aus den Fragen – du kannst ihn ändern.</span>' : '<span class="muted">Für diese Frage gibt es keinen fertigen Hinweis – bitte selbst schreiben.</span>'
        }</div>`;
      $('textarea', card).value = r.suggestion || '';
      el.appendChild(card);
    }
  }

  // ---------- Duell ----------

  function duelSides() {
    const d = S.pub.duel;
    return [
      { key: 'challenger', team: teamById(d.challengerId), label: 'Herausforderer' },
      { key: 'defender', team: teamById(d.defenderId), label: 'Herausgefordert' },
    ];
  }

  function duelHead() {
    const [c, f] = duelSides();
    return `<div class="duelhead"><div class="dt" style="--c:${c.team.color}">${esc(c.team.name)}</div><div class="vs">⚔️</div><div class="dt" style="--c:${f.team ? f.team.color : '#777'}">${f.team ? esc(f.team.name) : '?'}</div></div>`;
  }

  function duelCtx() {
    const d = S.pub.duel;
    const side = myTeamId() === d.challengerId ? 'challenger' : 'defender';
    return {
      pub: S.pub,
      q: { value: d.steal, type: 'estimate' },
      data: d.question,
      me: S.me,
      isHost: false,
      myTeam: teamById(myTeamId()),
      ts: { draft: null, draftPid: null, draftSeq: 0, draftBy: null, locked: d.locked[side] },
      isCaptain: true,
      captain: null,
      lockHint: 'Nur du antwortest für dein Team – leg deine Schätzung fest!',
      lockedHint: '✓ Festgelegt – jetzt wartet ihr auf euren Gegner.',
      send: (a, payload = {}) => (a === 'lock' ? send('duelLock', { v: payload.draft }) : Promise.resolve({})),
      snd,
      serverNow,
      playerById,
      teamById,
      toast,
      esc,
      fmt,
      socket,
    };
  }

  const SCREENS = {
    loading: () => ({
      mount(el) {
        el.innerHTML = '<div class="landing"><h1 class="title flicker">Geisterstunde</h1><div class="tag">Verbinde mit dem Jenseits …</div></div>';
      },
    }),

    landing: () => ({
      mount(el) {
        el.innerHTML = `
          <div class="landing">
            <div class="pumpkins flicker">🎃 🕯️ 💀 🕯️ 🎃</div>
            <h1 class="title flicker">Geisterstunde</h1>
            <div class="tag">Das Horror-Quizduell · 4–12 Spieler · Teams treten gegeneinander an</div>
            <div class="boxes">
              <form class="card" id="joinform" autocomplete="off">
                <h2>Mitspielen</h2>
                <input class="inp code big" id="jcode" maxlength="4" placeholder="CODE" value="${esc(S.prefillCode)}">
                <input class="inp big" id="jname" maxlength="18" placeholder="Dein Name" value="${esc(store.get('gs-name', ''))}">
                <button class="btn primary lg" style="width:100%">Beitreten</button>
                <div class="err" id="jerr"></div>
              </form>
              <div class="card">
                <h2>Hosten</h2>
                <div id="hresume"></div>
                <p class="muted">Erstelle einen Raum und teile den Link. Als Host moderierst du – mitspielen kannst du zusätzlich in einem zweiten Tab.</p>
                <button class="btn lg" id="hbtn" style="width:100%">Neues Spiel hosten</button>
                <div class="err" id="herr"></div>
              </div>
            </div>
          </div>`;
        $('#joinform', el).addEventListener('submit', e => {
          e.preventDefault();
          joinGame($('#jcode', el).value, $('#jname', el).value, $('#jerr', el));
        });
        // Leitet dieser Browser noch ein laufendes Spiel, kommt der Weg zurück zuerst.
        let running = null;
        const saved = store.get('gs-host');
        if (saved) {
          socket.emit('host:check', saved, res => {
            if (!res || res.error) {
              store.del('gs-host');
              return;
            }
            const box = $('#hresume', el);
            if (!box) return;
            running = res.code;
            box.innerHTML = `<button class="btn primary lg" type="button" style="width:100%">↩ Zurück zu deinem Spiel ${esc(res.code)}</button><p class="muted center">${res.players} Spieler im Raum</p>`;
            $('button', box).addEventListener('click', () => {
              unlockSound();
              S.role = 'host';
              S.code = saved.code;
              S.hostToken = saved.token;
              history.replaceState(null, '', `/?host=${saved.code}`);
              resume();
              render();
            });
          });
        }
        $('#hbtn', el).addEventListener('click', () => {
          if (running && !window.confirm(`Du leitest noch das Spiel ${running}. Mit einem neuen Spiel bleiben die Spieler dort ohne Spielleiter zurück.\n\nTrotzdem ein neues Spiel erstellen?`)) return;
          createGame($('#herr', el));
        });
        (S.prefillCode ? $('#jname', el) : $('#jcode', el)).focus();
      },
    }),

    lobby: () => {
      const known = new Map();
      let gravesEl;
      return {
        mount(el) {
          const isHost = S.role === 'host';
          el.innerHTML = `
            <div class="lobby">
              <h1 class="title flicker">Geisterstunde</h1>
              ${isHost ? `
                <div class="codebox">
                  <div class="muted">Raumcode</div>
                  <div class="code">${esc(S.code)}</div>
                  <div class="link" id="invlink"></div>
                  <div class="row wrap" style="justify-content:center">
                    <button class="btn sm" id="copy">📋 Einladungslink kopieren</button>
                    <button class="btn sm ghost" id="copyhost" title="Damit kommst du als Spielleiter zurück, auch aus einem anderen Browser oder von einem anderen PC. Nicht weitergeben!">🔑 Spielleiter-Link kopieren</button>
                  </div>
                </div>
                <div class="warn hidden" id="localwarn"></div>
              ` : `
                <div class="card myself">
                  <div class="av" id="myav" title="Klick für ein neues Symbol"></div>
                  <div><div class="muted">Du bist drin als</div><div style="font-size:1.6rem;font-weight:900" id="myname"></div><div class="muted" style="font-size:.85rem">Klick auf dein Symbol für ein neues.</div></div>
                </div>
                <div class="muted">Warte, bis der Host die Teams auslost …</div>
              `}
              <div class="muted" id="pcount"></div>
              <div class="graves" id="graves"></div>
            </div>`;
          gravesEl = $('#graves', el);
          if (isHost) {
            $('#copy', el).addEventListener('click', () => {
              const link = inviteLink();
              navigator.clipboard.writeText(link).then(() => toast('Link kopiert!'), () => toast(link));
            });
            // Nicht als Toast zeigen: Der Schlüssel soll bei geteiltem Bildschirm nicht im Bild stehen.
            $('#copyhost', el).addEventListener('click', () => {
              const link = hostLink();
              navigator.clipboard.writeText(link).then(
                () => toast('🔑 Spielleiter-Link kopiert – gut aufheben und nicht weitergeben!'),
                () => window.prompt('Spielleiter-Link (nicht weitergeben):', link),
              );
            });
            gravesEl.addEventListener('click', e => {
              const k = e.target.closest('[data-kick]');
              if (k && window.confirm('Diesen Spieler entfernen?')) hostSend('kick', { playerId: k.dataset.kick });
            });
          } else {
            $('#myav', el).addEventListener('click', () => {
              snd('click');
              send('avatar');
            });
          }
        },
        update() {
          const pub = S.pub;
          if (S.role === 'player' && S.me) {
            $('#myav').textContent = S.me.avatar;
            $('#myname').textContent = S.me.name;
          }
          if (S.role === 'host') {
            $('#invlink').textContent = inviteLink();
            const warn = $('#localwarn');
            const local = isLocalHost();
            warn.classList.toggle('hidden', !local || !!pub.publicUrl);
            warn.textContent = '⚠️ Noch kein Online-Link gefunden. Läuft das Tunnel-Fenster aus start.bat? Ohne Tunnel können nur Leute im selben WLAN beitreten.';
          }
          $('#pcount').textContent = `${pub.players.length} ${pub.players.length === 1 ? 'Spieler' : 'Spieler'} im Raum · empfohlen 4–12`;
          const ids = new Set(pub.players.map(p => p.id));
          for (const [id, node] of known) {
            if (!ids.has(id)) {
              node.remove();
              known.delete(id);
            }
          }
          pub.players.forEach((p, i) => {
            let node = known.get(p.id);
            if (!node) {
              node = document.createElement('div');
              node.className = 'grave';
              node.style.animationDelay = `${Math.min(i, 6) * 40}ms`;
              known.set(p.id, node);
              gravesEl.appendChild(node);
            }
            const html = `${S.role === 'host' ? `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>` : ''}<div class="av">${esc(p.avatar)}</div><div class="nm">${esc(p.name)}</div><div class="rip">R.I.P.</div>`;
            if (node.dataset.sig !== html) {
              node.innerHTML = html;
              node.dataset.sig = html;
            }
            node.classList.toggle('off', !p.connected);
            node.classList.toggle('me', !!(S.me && S.me.id === p.id));
          });
        },
      };
    },

    teams: () => {
      let sig = '';
      return {
        mount(el) {
          el.innerHTML = `<div class="lobby"><h1 class="title">Die Teams</h1><div id="yt"></div><div class="teamcols" id="tcols"></div></div>`;
          $('#tcols', el).addEventListener('change', e => {
            const sel = e.target.closest('[data-move]');
            if (sel) hostSend('move', { playerId: sel.dataset.move, teamId: sel.value });
          });
        },
        update() {
          const pub = S.pub;
          const s = JSON.stringify([pub.teams.map(t => t.id + t.name), pub.players.map(p => p.id + p.teamId + p.avatar + p.connected), S.me && S.me.teamId]);
          if (s === sig) return;
          sig = s;
          const t = S.me && teamById(S.me.teamId);
          const alone = t && pub.players.filter(p => p.teamId === t.id).length === 1;
          $('#yt').innerHTML = t
            ? `<div class="yourteam" style="--c:${t.color}">Du spielst für: ${esc(t.name)}</div>${alone ? '<div class="muted center">Ungerade Spielerzahl – du kämpfst als Einzelkämpfer allein. Viel Glück!</div>' : ''}`
            : '';
          $('#tcols').innerHTML = pub.teams
            .map((team, ti) => {
              const members = pub.players.filter(p => p.teamId === team.id);
              return `<div class="card teamcol" style="--c:${team.color}"><h3>${esc(team.name)}${members.length === 1 ? ' <small class="muted" style="font-family:var(--font-body);font-size:.8rem">(allein)</small>' : ''}</h3>${members
                .map(
                  (p, i) => `<div class="member ${p.connected ? '' : 'muted'}" style="animation-delay:${ti * 150 + i * 220}ms"><span class="av">${esc(p.avatar)}</span><b>${esc(p.name)}</b>${
                    S.role === 'host'
                      ? `<select data-move="${p.id}" title="Team wechseln">${pub.teams.map(o => `<option value="${o.id}" ${o.id === team.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`
                      : ''
                  }</div>`,
                )
                .join('') || '<div class="muted">(leer)</div>'}</div>`;
            })
            .join('');
          fitTeamNames();
        },
      };
    },

    board: () => {
      let sig = '';
      let boardEl;
      return {
        mount(el) {
          el.innerHTML = `<div class="pagehead"><h1 class="title" id="ptitle"></h1><div class="sub" id="psub"></div></div><div class="picking" id="pick"></div><div class="board" id="board"></div>`;
          boardEl = $('#board', el);
          boardEl.addEventListener('click', e => {
            const tile = e.target.closest('.tile');
            if (!tile || tile.classList.contains('used') || tile.classList.contains('locked')) return;
            snd('whoosh');
            const payload = { cat: Number(tile.dataset.cat), idx: Number(tile.dataset.idx) };
            if (S.role === 'host') hostSend('pick', payload);
            else send('pick', payload);
          });
          boardEl.addEventListener('mouseover', e => {
            const tile = e.target.closest('.tile');
            if (tile && !tile.classList.contains('used') && !tile.classList.contains('locked') && tile !== this.lastHover) {
              this.lastHover = tile;
              snd('hover');
            }
          });
        },
        update() {
          const pub = S.pub;
          const picker = teamById(pub.pickingTeamId);
          const canPick = S.role === 'host' || (S.me && picker && S.me.teamId === picker.id);
          $('#ptitle').textContent = pub.pageTitle;
          $('#psub').textContent = pub.pageSubtitle;
          const pick = $('#pick');
          if (picker) {
            pick.style.setProperty('--c', picker.color);
            pick.classList.toggle('mine', !!(S.me && S.me.teamId === picker.id));
            pick.innerHTML = S.me && S.me.teamId === picker.id ? '🎃 Ihr seid dran – wählt ein Feld!' : `🎃 <b style="color:${picker.color}">${esc(picker.name)}</b> wählt das nächste Feld …`;
          }
          // Der Host sieht das Duell-Feld nur mit eingeschaltetem Spickzettel.
          const duelTile = S.role === 'host' && S.cheat && S.host && S.host.duelTiles ? S.host.duelTiles[pub.page] : null;
          const s = JSON.stringify([pub.board, canPick, picker && picker.color, duelTile]);
          if (s === sig) return;
          sig = s;
          boardEl.innerHTML = pub.board.categories
            .map(
              (c, ci) =>
                `<div class="catcol"><div class="cathead"><div class="ic">${esc(c.icon)}</div><div class="nm">${esc(c.name)}</div><div class="mc">${esc(c.mech)}</div></div>${pub.board.values
                  .map((v, vi) => {
                    const used = pub.board.used[ci][vi];
                    const duel = duelTile && duelTile.cat === ci && duelTile.idx === vi ? 'duelmark' : '';
                    return `<div class="tile ${used ? 'used' : ''} ${!used && !canPick ? 'locked' : ''} ${duel}" data-cat="${ci}" data-idx="${vi}" style="--glow:${picker ? picker.color : '#ff8c1a'}"><span>${v}</span></div>`;
                  })
                  .join('')}</div>`,
            )
            .join('');
          fitCatNames();
        },
      };
    },

    intro: () => ({
      mount(el) {
        const q = S.pub.q;
        el.innerHTML = `
          <div class="intro">
            <div class="bigic">${esc(q.catIcon)}</div>
            <div class="cat">${esc(q.catName)}</div>
            <div class="val">${q.value}</div>
            <div class="pill mech">${esc(q.mech.icon)} ${esc(q.mech.label)}</div>
            <div class="rule">${esc(q.mech.rule)}</div>
            <div class="role hidden" id="role"></div>
            <div class="countbar bar" data-ends="${q.introEndsAt}" data-total="${Math.max(1000, q.introEndsAt - serverNow())}"><i></i></div>
          </div>`;
      },
      update() {
        const C = ctx();
        const role = $('#role');
        if (!C.me) return;
        let txt = '';
        const watched = C.myTeam && C.q.teams[C.myTeam.id] && C.q.teams[C.myTeam.id].watch;
        if (C.q.input === 'draw' && watched) txt = `🎨 Du spielst allein und rätst bei der Zeichnung von <b>${esc((teamById(watched) || {}).name || '?')}</b> mit.`;
        else if (C.q.input === 'draw') txt = C.isDrawer ? `🎨 Du malst! Dein Begriff: <b>${esc(C.me.word || '')}</b>` : `🎨 Bei euch malt: <b>${esc(C.drawer ? C.drawer.name : '?')}</b>`;
        else if (CAPTAIN_INPUTS.includes(C.q.input)) txt = C.isCaptain ? '👑 Du bist diesmal Kapitän eures Teams!' : `👑 Kapitän bei euch: <b>${esc(C.captain ? C.captain.name : '?')}</b>`;
        else txt = '🙌 Alle im Team machen mit!';
        role.innerHTML = txt;
        role.classList.remove('hidden');
      },
    }),

    question: () => {
      let inst = null;
      let mechEl;
      let lastEnds = null;
      const scr = {
        mount(el) {
          const q = S.pub.q;
          el.innerHTML = `${questionHead(q)}<span class="secs" id="secs"></span></div>
            <div class="timer bar" id="tbar"><i></i></div>
            <div class="tstat" id="tstat"></div>
            <div class="hintreqs" id="hintreq"></div>
            <div class="rolebar hidden" id="rolebar"></div>
            <div id="hintbar"></div>
            <div id="mech"></div>`;
          mechEl = $('#mech', el);
          $('#hintbar', el).addEventListener('click', e => {
            const b = e.target.closest('[data-buyhint]');
            if (!b || b.disabled) return;
            if (!window.confirm(`Einen Hinweis für ${S.pub.hintCost} Punkte beim Spielleiter anfragen?`)) return;
            snd('click');
            send('hint');
          });
          $('#hintreq', el).addEventListener('click', e => {
            const card = e.target.closest('[data-req]');
            if (!card) return;
            if (e.target.closest('[data-unlock]')) {
              snd('lock');
              hostSend('hintUnlock', { teamId: card.dataset.req, text: $('textarea', card).value });
            } else if (e.target.closest('[data-decline]')) {
              hostSend('hintDecline', { teamId: card.dataset.req });
            }
          });
          const M = window.Mech && window.Mech[q.type];
          if (!M) {
            mechEl.innerHTML = `<div class="card">Unbekannte Mechanik: ${esc(q.type)}</div>`;
            return;
          }
          inst = M.create();
          scr.inst = inst;
          inst.mount(mechEl, ctx());
        },
        update() {
          const C = ctx();
          const q = C.q;
          if (q.endsAt !== lastEnds) {
            lastEnds = q.endsAt;
            const tot = timerTotal(q.endsAt);
            for (const id of ['secs', 'tbar']) {
              const n = $(`#${id}`);
              n.dataset.ends = q.endsAt || '';
              n.dataset.total = tot;
            }
          }
          $('#tstat').innerHTML = S.pub.teams
            .map(t => {
              const st = q.teams[t.id] || {};
              let done = false;
              let label = '… überlegt';
              if (q.input === 'race' || q.input === 'draw' || q.input === 'puzzle') {
                done = st.solved;
                label = done ? `✓ ${q.type === 'code' ? 'entkommen' : 'gelöst'} (${fmt(st.solvedMs / 1000, 1)} s)` : '… knobelt';
              } else if (q.input === 'hl') {
                done = st.hlLocked;
                label = done ? '✓ festgelegt' : '… überlegt';
              } else {
                done = st.locked;
                label = done ? (q.input === 'teamGuess' ? '✓ hat geantwortet' : '✓ festgelegt') : '… überlegt';
              }
              return `<span class="s ${done ? 'done' : ''}" style="--c:${t.color}"><span class="dot"></span>${esc(t.name)} ${label}</span>`;
            })
            .join('');
          const rb = $('#rolebar');
          const rt = roleText(C);
          rb.classList.toggle('hidden', !rt);
          rb.classList.toggle('me', (C.isCaptain && CAPTAIN_INPUTS.includes(q.input)) || C.isDrawer);
          if (rb.dataset.sig !== rt) {
            rb.innerHTML = rt;
            rb.dataset.sig = rt;
          }
          renderHintBar($('#hintbar'), C);
          if (S.role === 'host') renderHintRequests($('#hintreq'));
          if (inst) inst.update(C);
        },
        unmount() {
          if (inst && inst.unmount) inst.unmount();
        },
      };
      return scr;
    },

    reveal: () => {
      let cleanup = null;
      let resEl;
      let shown = false;
      const scr = {
        mount(el) {
          const q = S.pub.q;
          const R = q.reveal;
          let duelBanner = '';
          if (R.duel) {
            const w = teamById(R.duel.winnerId);
            duelBanner = `<div class="duelbanner">⚔️ <b>Das war das Duell-Feld!</b> ${
              w ? `<b style="color:${w.color}">${esc(w.name)}</b> hat es gewonnen und darf gleich ein Team zum Schätzduell herausfordern.` : 'Aber kein Team hat die Frage gewonnen – das Duell fällt aus.'
            }</div>`;
            setTimeout(() => {
              snd('thunder');
              flash();
            }, 1200);
          }
          el.innerHTML = `<div class="reveal">${questionHead(q)}</div>
            ${duelBanner}
            <div class="sol"><span class="lbl">Lösung</span>${esc(R.answerText)}</div>
            ${R.info ? `<div class="info">${esc(R.info)}</div>` : ''}
            <div id="extra"></div>
            <div class="results" id="res"></div></div>`;
          resEl = $('#res', el);
          const M = window.Mech && window.Mech[q.type];
          if (M && M.reveal) {
            try {
              cleanup = M.reveal($('#extra', el), ctx(), R) || null;
            } catch (e) {
              console.error(e);
            }
          }
          if (q.type === 'draw') {
            const draw = g => window.Mech.draw.gallery($('#extra', el), ctx(), g);
            scr.onGallery = g => {
              if (g && g.qid === q.id) draw(g);
            };
            if (S.drawGallery && S.drawGallery.qid === q.id) draw(S.drawGallery);
            else (S.role === 'host' ? hostSend('sync') : send('sync')).then(g => g && g.qid === q.id && draw(g));
          }
          resEl.addEventListener('click', e => {
            const b = e.target.closest('[data-adj]');
            if (!b) return;
            snd('click');
            hostSend('adjust', { teamId: b.dataset.team, delta: Number(b.dataset.adj) });
          });
        },
        update() {
          if (shown) return;
          shown = true;
          const q = S.pub.q;
          const R = q.reveal;
          const rows = R.results.slice().sort((a, b) => b.points - a.points);
          resEl.innerHTML = rows
            .map((r, i) => {
              const t = teamById(r.teamId);
              if (!t) return '';
              const cls = r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : 'zero';
              return `<div class="res ${t.id === myTeamId() ? 'mine' : ''}" style="--c:${t.color};animation-delay:${300 + i * 350}ms">
                <div class="bar"></div>
                <div><div class="tn">${esc(t.name)}</div><div class="ta">${esc(r.text)}</div>${r.detail ? `<div class="td">${esc(r.detail)}</div>` : ''}</div>
                <div><div class="pts ${cls}" data-to="${r.points}">0</div>${
                  S.role === 'host'
                    ? `<div class="adj"><button class="btn sm" data-team="${t.id}" data-adj="-50" title="Punkte korrigieren">−50</button><button class="btn sm" data-team="${t.id}" data-adj="50" title="Punkte korrigieren">+50</button></div>`
                    : ''
                }</div></div>`;
            })
            .join('');
          $$('.pts', resEl).forEach((p, i) => {
            const to = Number(p.dataset.to);
            setTimeout(() => {
              const start = performance.now();
              const dur = 700;
              const step = now => {
                const k = Math.min(1, (now - start) / dur);
                const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
                p.textContent = `${v > 0 ? '+' : ''}${fmt(v)}`;
                if (k < 1) requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
              if (to > 0) snd('pop');
              else if (to < 0) snd('wrong');
            }, 300 + i * 350);
          });
          const mine = R.results.find(r => r.teamId === myTeamId());
          if (mine) setTimeout(() => snd(mine.points > 0 ? 'correct' : 'wrong'), 250);
        },
        unmount() {
          if (cleanup) cleanup();
        },
      };
      return scr;
    },

    duel: () => {
      let inst = null;
      const yearLike = q => !q.unit && q.min >= 1000 && q.max <= 2100;
      const scr = {
        mount(el) {
          const d = S.pub.duel;
          const sides = duelSides();
          const ch = sides[0].team;
          const timer = d.endsAt ? `<div class="countbar bar" data-ends="${d.endsAt}" data-total="${Math.max(1000, d.endsAt - serverNow())}"><i></i></div>` : '';
          if (d.step === 'challenge') {
            const canChoose = S.role === 'host' || myTeamId() === d.challengerId;
            el.innerHTML = `<div class="duel">
              <h1 class="title flicker">Duell-Feld!</h1>
              <p class="lead"><b style="color:${ch.color}">${esc(ch.name)}</b> hat das Duell-Feld gewonnen. ${canChoose ? 'Wen fordert ihr heraus?' : 'Gleich wird ein Team herausgefordert …'}</p>
              <p class="muted">Jedes Team schickt eine Person ins Schätzduell. Gewinnt der Herausforderer, stiehlt er ${d.steal} Punkte.</p>
              <div class="duelpick">${S.pub.teams
                .filter(t => t.id !== d.challengerId)
                .map(t => `<button class="btn lg" type="button" data-challenge="${t.id}" style="border-color:${t.color}" ${canChoose ? '' : 'disabled'}><span style="color:${t.color}">${esc(t.name)}</span><br><small class="muted">${fmt(t.score)} Punkte</small></button>`)
                .join('')}</div>
              ${timer}</div>`;
            el.addEventListener('click', e => {
              const b = e.target.closest('[data-challenge]');
              if (!b || b.disabled) return;
              snd('lock');
              (S.role === 'host' ? hostSend : send)('duelChallenge', { teamId: b.dataset.challenge });
            });
            return;
          }
          if (d.step === 'fighters') {
            el.innerHTML = `<div class="duel">${duelHead()}
              <p class="lead">Jedes Team schickt eine Person ins Schätzduell!</p>
              <div class="fighters">${sides.map(s => `<div class="fslot" data-slot="${s.key}" style="--c:${s.team.color}"></div>`).join('')}</div>
              <div id="volunteer"></div>${timer}</div>`;
            el.addEventListener('click', e => {
              if (!e.target.closest('[data-volunteer]')) return;
              snd('lock');
              send('duelVolunteer');
            });
            return;
          }
          if (d.step === 'question') {
            el.innerHTML = `<div class="duel">${duelHead()}
              <div class="fighters">${sides.map(s => `<div class="fslot" data-slot="${s.key}" style="--c:${s.team.color}"></div>`).join('')}</div>
              <div class="timer bar" data-ends="${d.endsAt}" data-total="${Math.max(1000, d.endsAt - serverNow())}" style="width:100%"><i></i></div>
              <div id="dq" style="width:100%;text-align:left"></div></div>`;
            const dq = $('#dq', el);
            if (S.me && S.me.isFighter) {
              inst = window.Mech.estimate.create();
              inst.mount(dq, duelCtx());
            } else {
              dq.innerHTML = `<div class="m-prompt center">${esc(d.question.prompt)}</div><div class="muted center">Nur die beiden Kämpfer antworten – Daumen drücken!</div>`;
            }
            return;
          }
          const R = d.result;
          const show = v => (v == null ? 'keine Antwort' : `${yearLike(d.question) ? v : fmt(v)}${d.question.unit ? ` ${d.question.unit}` : ''}`);
          const winText =
            R.winner === 'challenger'
              ? `${esc(sides[0].team.name)} gewinnt und stiehlt ${R.stolen} Punkte von ${esc(sides[1].team.name)}!`
              : R.winner === 'defender'
                ? `${esc(sides[1].team.name)} verteidigt sich – keine Punkte gestohlen!`
                : 'Unentschieden – niemand verliert Punkte.';
          el.innerHTML = `<div class="duel">${duelHead()}
            <div class="m-prompt">${esc(d.question.prompt)}</div>
            <div class="sol" style="width:100%"><span class="lbl">Lösung</span>${esc(R.display || show(R.answer))}</div>
            <div class="fighters">${sides
              .map(s => {
                const f = d.fighters[s.key];
                const win = R.winner === s.key;
                return `<div class="fslot ${win ? 'win' : ''}" style="--c:${s.team.color}"><div class="av">${f ? esc(f.avatar) : '❔'}</div><div class="nm">${f ? esc(f.name) : '–'}</div><div class="tn">${esc(s.team.name)}</div><div class="guess">${esc(show(R.guesses[s.key]))}</div>${win ? '<div class="crown">👑</div>' : ''}</div>`;
              })
              .join('')}</div>
            <div class="duelresult">${winText}</div>
            ${R.info ? `<div class="info">${esc(R.info)}</div>` : ''}</div>`;
          setTimeout(() => snd(R.winner === 'challenger' ? 'fanfare' : 'reveal'), 300);
        },
        update() {
          const d = S.pub.duel;
          if (!d) return;
          if (d.step === 'fighters' || d.step === 'question') {
            for (const s of duelSides()) {
              const slot = document.querySelector(`[data-slot="${s.key}"]`);
              if (!slot) continue;
              const f = d.fighters[s.key];
              const lock = d.step === 'question' ? (d.locked[s.key] ? '<div class="pill" style="color:var(--green)">✓ festgelegt</div>' : '<div class="muted">überlegt …</div>') : '';
              const html = f
                ? `<div class="av">${esc(f.avatar)}</div><div class="nm">${esc(f.name)}</div><div class="tn">${esc(s.team.name)}</div>${lock}`
                : `<div class="av">❔</div><div class="muted">${esc(s.team.name)} sucht noch einen Kämpfer …</div>`;
              if (slot.dataset.sig !== html) {
                slot.innerHTML = html;
                slot.dataset.sig = html;
              }
              slot.classList.toggle('locked', !!(d.step === 'question' && d.locked[s.key]));
            }
          }
          if (d.step === 'fighters') {
            const v = $('#volunteer');
            const mine = myTeamId();
            const side = mine === d.challengerId ? 'challenger' : mine === d.defenderId ? 'defender' : null;
            let html = '<div class="muted">Euer Team schaut zu.</div>';
            if (S.role === 'host') html = '<div class="muted">Die Teams bestimmen ihre Kämpfer …</div>';
            else if (side && !d.fighters[side]) html = '<button class="btn primary lg" type="button" data-volunteer>🗡️ Ich trete an!</button>';
            else if (side) html = d.fighters[side].id === (S.me && S.me.id) ? '<div class="lead">Du kämpfst für dein Team – gleich geht es los!</div>' : `<div class="muted">${esc(d.fighters[side].name)} kämpft für euch.</div>`;
            if (v && v.dataset.sig !== html) {
              v.innerHTML = html;
              v.dataset.sig = html;
            }
          }
          if (d.step === 'question' && inst) inst.update(duelCtx());
        },
        unmount() {
          if (inst && inst.unmount) inst.unmount();
        },
      };
      return scr;
    },

    brIntro: () => ({
      mount(el) {
        el.innerHTML = `
          <div class="brintro">
            <h1 class="title flicker">Die Backrooms</h1>
            <div class="paper">
              Ihr habt die Dämmerung überlebt – aber irgendetwas ist schiefgelaufen. Ihr seid durch die Wand gefallen.
              Endlose gelbe Räume. Summende Neonröhren. Feuchter Teppich.<br><br>
              Überall liegen <b>Zettel</b> von denen, die vor euch hier waren. Sammelt so viele wie möglich, bevor die Zeit abläuft.
              Aber seid leise. <b>Es</b> ist auch hier.
            </div>
            <div class="keys">
              <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> laufen</div>
              <div>🖱️ Maus bewegen: umsehen<br><span class="muted">ohne Taste halten · Klick ins Bild fängt die Maus ein</span></div>
              <div><kbd>Shift</kbd> rennen<br><span class="muted">aber Rennen ist laut …</span></div>
              <div>📄 Zettel: einfach drüberlaufen</div>
            </div>
            <div class="card">
              <b>Punkte:</b> Jeder Zettel bringt eurem Team <b>+25</b>. Wer die meisten Zettel findet, wird <b>Zettelkönig</b> und bekommt zusätzlich <b>+50 pro Zettel</b>.
              Wenn das Monster dich erwischt, verlierst du einen Zettel und bist kurz gelähmt.<br>
              <b>Vorsicht:</b> Jeder gefundene Zettel macht das Monster wütender – schneller, wachsamer, mit feinerem Gehör. Wenn es schreit, ist es eine Stufe wütender geworden. Zettel gibt es genug, es kommen immer neue nach.
            </div>
            <div class="muted center">${S.role === 'host' ? 'Starte, sobald alle bereit sind. Du siehst die Karte von oben.' : 'Am PC spielt es sich am besten. Gleich geht es los – warte auf den Host …'}</div>
          </div>`;
      },
    }),

    backrooms: () => {
      let mounted = false;
      return {
        mount(el) {
          const wrap = document.createElement('div');
          wrap.className = 'brstage';
          el.appendChild(wrap);
          if (!window.Backrooms) {
            wrap.innerHTML = '<div class="center" style="padding:60px">Das Backrooms-Spiel konnte nicht geladen werden.</div>';
            return;
          }
          try {
            window.Backrooms.mount(wrap, {
              socket,
              isHost: S.role === 'host',
              me: S.role === 'player' && S.me ? { id: S.me.id, name: S.me.name, teamId: S.me.teamId } : null,
              teams: S.pub.teams.map(t => ({ id: t.id, name: t.name, color: t.color })),
              sound: window.Sound,
            });
            mounted = true;
          } catch (e) {
            console.error(e);
            wrap.innerHTML = `<div class="center" style="padding:60px">Fehler beim Starten: ${esc(e.message)}</div>`;
          }
        },
        unmount() {
          if (!mounted) return;
          try {
            window.Backrooms.unmount();
          } catch (e) {
            console.error(e);
          }
        },
      };
    },

    brResults: () => ({
      mount(el) {
        const R = S.pub.brResults || { players: [], teamPoints: {} };
        const rows = R.players
          .map((p, i) => {
            const t = teamById(p.teamId);
            return `<div class="noterow ${p.king ? 'king' : ''}" style="--c:${t ? t.color : '#888'};animation-delay:${200 + i * 160}ms">
              <div class="rk">${p.king ? '👑' : i + 1}</div>
              <div><b>${esc(p.avatar)} ${esc(p.name)}</b><div class="muted" style="font-size:.85rem">${esc(t ? t.name : '')}${p.king ? ' · Zettelkönig!' : ''}</div></div>
              <div class="n">📄 ${p.notes}</div>
              <div class="p">+${fmt(p.points)}</div>
            </div>`;
          })
          .join('');
        const sums = S.pub.teams
          .map(t => `<span class="chip" style="--c:${t.color}"><span class="dot"></span>${esc(t.name)} <b>+${fmt(R.teamPoints[t.id] || 0)}</b></span>`)
          .join('');
        el.innerHTML = `
          <div class="brintro">
            <h1 class="title">Zurück aus den Backrooms</h1>
            <div class="row wrap" style="justify-content:center">${sums}</div>
            <div class="notelist">${rows || '<div class="muted center">Niemand hat einen Zettel gefunden …</div>'}</div>
            <div class="muted center">Pro Zettel +${R.perNote || 25} fürs Team · Zettelkönig zusätzlich +${R.kingPerNote || 50} pro Zettel</div>
          </div>`;
        if (R.players.some(p => p.king)) setTimeout(() => snd('fanfare'), 600);
      },
    }),

    final: () => {
      let conf;
      return {
        mount(el) {
          const teams = S.pub.teams.slice().sort((a, b) => b.score - a.score);
          let rank = 0;
          teams.forEach((t, i) => {
            if (i > 0 && t.score < teams[i - 1].score) rank = i;
            t.rank = rank;
          });
          const order = teams.length >= 3 ? [teams[1], teams[0], teams[2], ...teams.slice(3)] : teams.length === 2 ? [teams[1], teams[0]] : teams;
          const heights = [230, 170, 130, 100];
          const crowns = ['👑', '🥈', '🥉', '🪦'];
          const pods = order
            .map((t, i) => {
              const members = S.pub.players.filter(p => p.teamId === t.id).map(p => `${p.avatar} ${esc(p.name)}`).join(' · ');
              return `<div class="pod" style="--c:${t.color};animation-delay:${600 + (teams.length - i) * 250}ms">
                <div class="crown">${crowns[t.rank] || '🪦'}</div>
                <div class="nm">${esc(t.name)}</div>
                <div class="sc">${fmt(t.score)} Punkte</div>
                <div class="block" style="height:${heights[t.rank] || 90}px">${t.rank + 1}</div>
                <div class="mem">${members}</div>
              </div>`;
            })
            .join('');
          const king = S.pub.brResults && S.pub.brResults.players.find(p => p.king);
          // Bei Gleichstand an der Spitze überleben alle punktgleichen Teams
          const winners = teams.filter(t => t.rank === 0).map(t => esc(t.name));
          const headline = winners.length > 1 ? `${winners.slice(0, -1).join(', ')} & ${winners[winners.length - 1]} überleben die Geisterstunde!` : winners.length ? `${winners[0]} überlebt die Geisterstunde!` : '';
          el.innerHTML = `
            <div class="final">
              <h1 class="title flicker">Die Gewinner</h1>
              <div class="yourteam" style="--c:${winners.length === 1 ? teams[0].color : '#ff8c1a'}">${headline}</div>
              <div class="podium">${pods}</div>
              ${king ? `<div class="muted">📄 Zettelkönig der Backrooms: <b>${esc(king.avatar)} ${esc(king.name)}</b> (${king.notes} Zettel)</div>` : ''}
              <div class="muted">Danke fürs Mitspielen – süße Albträume! 🎃</div>
            </div>`;
          fitTeamNames();
          conf = document.createElement('div');
          conf.className = 'confetti';
          const icons = ['🎃', '👻', '🦇', '💀', '🕷️', '🍬', '🕯️'];
          for (let i = 0; i < 70; i++) {
            const s = document.createElement('span');
            s.textContent = icons[i % icons.length];
            s.style.left = `${Math.random() * 100}%`;
            s.style.animationDuration = `${4 + Math.random() * 5}s`;
            s.style.animationDelay = `${Math.random() * 4}s`;
            s.style.fontSize = `${1.2 + Math.random() * 1.8}rem`;
            conf.appendChild(s);
          }
          document.body.appendChild(conf);
        },
        unmount() {
          if (conf) conf.remove();
        },
      };
    },
  };

  boot();
})();
