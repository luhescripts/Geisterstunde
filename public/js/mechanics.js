// Oberflächen der Battle-Mechaniken. Jede Mechanik liefert create() -> { mount, update, unmount }
// und optional reveal(el, C, R) für die Auflösung.
(() => {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: d });
  const el = html => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const LETTERS = 'ABCDEFGH';
  const PAIR_COLORS = ['#ff8c1a', '#7cfc5a', '#b26bff', '#5ac8ff', '#ffd24a', '#ff5c8a'];
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';

  function voters(C, votes, value) {
    return Object.entries(votes || {})
      .filter(([, v]) => same(v, value))
      .map(([pid]) => {
        const p = C.playerById(pid);
        return p ? `<span title="${esc(p.name)}">${esc(p.avatar)}</span>` : '';
      })
      .join('');
  }

  function canAct(C) {
    return !C.isHost && !!C.ts && !C.ts.locked;
  }

  // Gemeinsamer Team-Entwurf: veraltete Echos der eigenen Änderungen werden ignoriert.
  function DraftSync() {
    let seq = 0;
    return {
      send(C, v) {
        C.send('draft', { v, seq: ++seq });
      },
      fresh(C) {
        const ts = C.ts;
        if (!ts || ts.draft == null) return false;
        return !(C.me && ts.draftPid === C.me.id && ts.draftSeq < seq);
      },
    };
  }

  // Festlegen-Leiste: nur der Kapitän sieht den Knopf.
  function LockBar(opts) {
    const root = el('<div class="lockbar"><div class="txt"></div><button class="btn primary" type="button">🔒 Festlegen</button></div>');
    const txt = root.querySelector('.txt');
    const btn = root.querySelector('button');
    let cur = null;
    btn.addEventListener('click', () => {
      if (cur && !btn.disabled) opts.onLock(cur);
    });
    return {
      el: root,
      update(C, locked) {
        cur = C;
        if (C.isHost || !C.ts) {
          root.classList.add('hidden');
          return;
        }
        root.classList.remove('hidden');
        root.classList.toggle('locked', !!locked);
        if (locked) {
          txt.textContent = C.lockedHint || (opts.lockedText ? opts.lockedText(C) : '✓ Festgelegt – jetzt sind die anderen Teams dran.');
          btn.classList.add('hidden');
        } else if (C.isCaptain) {
          txt.textContent = C.lockHint || (opts.captainText ? opts.captainText(C) : 'Seid ihr euch einig? Dann festlegen!');
          btn.classList.remove('hidden');
          btn.disabled = opts.canLock ? !opts.canLock(C) : false;
        } else {
          txt.textContent = `👑 ${C.captain ? C.captain.name : 'Euer Kapitän'} legt fest, sobald ihr euch einig seid.`;
          btn.classList.add('hidden');
        }
      },
    };
  }

  function pinIcon(color, label) {
    return window.L.divIcon({
      className: '',
      html: `<div class="pin" style="color:${color}">${label ? `<span class="lbl" style="color:${color}">${esc(label)}</span>` : ''}📍</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 32],
    });
  }

  const Mech = {};

  // ---------- Karten-Pin ----------
  Mech.map = {
    create() {
      let map = null;
      let marker = null;
      let lock;
      let cur;
      let dragging = false;
      let last = null;
      let hint;
      const sync = DraftSync();

      function place(lat, lng) {
        const color = cur.myTeam ? cur.myTeam.color : '#ff8c1a';
        if (!marker) {
          marker = window.L.marker([lat, lng], { icon: pinIcon(color, cur.myTeam && cur.myTeam.name), draggable: true }).addTo(map);
          marker.on('dragstart', () => {
            dragging = true;
          });
          marker.on('dragend', () => {
            dragging = false;
            const p = marker.getLatLng().wrap();
            last = { lat: p.lat, lng: p.lng };
            sync.send(cur, last);
          });
        } else marker.setLatLng([lat, lng]);
        last = { lat, lng };
      }

      return {
        mount(host, C) {
          cur = C;
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="mapwrap"><div class="map"></div></div>
            <div class="m-hint"></div>
          </div>`);
          host.appendChild(root);
          hint = root.querySelector('.m-hint');
          lock = LockBar({ canLock: c => !!(c.ts && c.ts.draft), onLock: c => c.send('lock') });
          root.appendChild(lock.el);
          if (!window.L) {
            root.querySelector('.map').innerHTML = '<div class="center muted" style="padding:40px">Die Karte konnte nicht geladen werden.</div>';
            return;
          }
          map = window.L.map(root.querySelector('.map'), { worldCopyJump: true, minZoom: 2, maxZoom: 13, zoomSnap: 0.5 }).setView([35, 0], 2);
          window.L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
          map.on('click', e => {
            if (!canAct(cur)) return;
            const ll = e.latlng.wrap();
            place(ll.lat, ll.lng);
            cur.snd('click');
            sync.send(cur, { lat: ll.lat, lng: ll.lng });
          });
          setTimeout(() => map && map.invalidateSize(), 80);
        },
        update(C) {
          cur = C;
          const locked = !!(C.ts && C.ts.locked);
          lock.update(C, locked);
          if (C.isHost) hint.textContent = 'Die Teams setzen gerade heimlich ihre Nadeln …';
          else if (locked) hint.textContent = '';
          else hint.textContent = `Tippt auf die Karte, um eure Team-Nadel zu setzen – alle im Team können sie verschieben.${C.ts && C.ts.draftBy ? ` Zuletzt bewegt von ${C.ts.draftBy}.` : ''}`;
          if (!map) return;
          const d = C.ts && C.ts.draft;
          if (d && !dragging && sync.fresh(C) && (!last || d.lat !== last.lat || d.lng !== last.lng)) place(d.lat, d.lng);
          if (marker && marker.dragging) {
            if (canAct(C)) marker.dragging.enable();
            else marker.dragging.disable();
          }
        },
        unmount() {
          if (map) map.remove();
          map = null;
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex || !window.L) return null;
      const box = el('<div class="mapwrap revmap"><div class="map"></div></div>');
      host.appendChild(box);
      const map = window.L.map(box.querySelector('.map'), { worldCopyJump: false, minZoom: 1, maxZoom: 13, zoomSnap: 0.25 }).setView([25, 0], 2);
      window.L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
      const target = window.L.latLng(ex.target.lat, ex.target.lng);
      window.L.circle(target, { radius: (ex.radiusKm || 25) * 1000, color: '#ffd24a', weight: 1, fillOpacity: 0.1 }).addTo(map);
      window.L.marker(target, { icon: window.L.divIcon({ className: '', html: '<div class="pin">💀</div>', iconSize: [34, 34], iconAnchor: [17, 20] }), zIndexOffset: 1000 })
        .addTo(map)
        .bindTooltip(ex.target.label, { permanent: true, direction: 'top', className: 'kmlabel', offset: [0, -16] });
      const pts = [target];
      for (const p of ex.pins) {
        const t = C.teamById(p.teamId);
        if (!t) continue;
        let lng = p.lng;
        while (lng - ex.target.lng > 180) lng -= 360;
        while (lng - ex.target.lng < -180) lng += 360;
        const ll = window.L.latLng(p.lat, lng);
        pts.push(ll);
        window.L.marker(ll, { icon: pinIcon(t.color, t.name) }).addTo(map);
        window.L.polyline([ll, target], { color: t.color, weight: 3, dashArray: '8 8', opacity: 0.9 })
          .addTo(map)
          .bindTooltip(`${fmt(p.km)} km`, { permanent: true, direction: 'center', className: 'kmlabel' });
      }
      const timer = setTimeout(() => {
        map.invalidateSize();
        map.flyToBounds(window.L.latLngBounds(pts).pad(0.35), { maxZoom: 9, duration: 1.8 });
      }, 400);
      return () => {
        clearTimeout(timer);
        map.remove();
      };
    },
  };

  // ---------- Schätzen ----------
  Mech.estimate = {
    create() {
      let cur;
      let val;
      let num;
      let slider;
      let by;
      let typed;
      let lock;
      let sendT = null;
      let touched = false;
      const sync = DraftSync();

      const clamp = (d, v) => Math.min(d.max, Math.max(d.min, v));
      const nice = v => {
        if (v < 100) return Math.round(v);
        const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
        return Math.round(v / mag) * mag;
      };
      const toSlider = (d, v) => (d.scale === 'log' ? (1000 * Math.log(v / d.min)) / Math.log(d.max / d.min) : (1000 * (v - d.min)) / (d.max - d.min));
      const fromSlider = (d, p) => {
        if (d.scale === 'log') return clamp(d, nice(d.min * Math.pow(d.max / d.min, p / 1000)));
        const step = d.step || 1;
        return clamp(d, Math.round((d.min + ((d.max - d.min) * p) / 1000) / step) * step);
      };

      function show() {
        const yearLike = !cur.data.unit && cur.data.min >= 1000 && cur.data.max <= 2100;
        num.innerHTML = `${yearLike ? val : fmt(val)}<span class="unit">${esc(cur.data.unit)}</span>`;
        slider.value = Math.round(toSlider(cur.data, val));
      }

      function setVal(v, sendIt) {
        val = clamp(cur.data, v);
        touched = true;
        show();
        if (sendIt) {
          clearTimeout(sendT);
          sendT = setTimeout(() => sync.send(cur, val), 140);
        }
      }

      return {
        mount(host, C) {
          cur = C;
          const d = C.data;
          val = C.ts && C.ts.draft != null ? C.ts.draft : d.start;
          const steps =
            d.scale === 'log'
              ? [['÷2', v => v / 2], ['−10 %', v => v * 0.9], ['+10 %', v => v * 1.1], ['×2', v => v * 2]]
              : d.max - d.min > 1000
                ? [['−100', v => v - 100], ['−10', v => v - 10], ['−1', v => v - 1], ['+1', v => v + 1], ['+10', v => v + 10], ['+100', v => v + 100]]
                : [['−10', v => v - 10], ['−1', v => v - 1], ['+1', v => v + 1], ['+10', v => v + 10]];
          const root = el(`<div>
            <div class="m-prompt">${esc(d.prompt)}</div>
            <div class="est">
              <div class="num"></div>
              <input type="range" min="0" max="1000" step="1">
              <div class="steps">${steps.map((s, i) => `<button class="btn sm" type="button" data-s="${i}">${s[0]}</button>`).join('')}</div>
              <form class="row"><input class="inp" type="number" inputmode="decimal" style="width:190px" placeholder="Zahl eintippen"><button class="btn sm">Übernehmen</button></form>
              <div class="by"></div>
            </div>
          </div>`);
          host.appendChild(root);
          num = root.querySelector('.num');
          slider = root.querySelector('input[type=range]');
          by = root.querySelector('.by');
          typed = root.querySelector('input[type=number]');
          slider.addEventListener('input', () => setVal(fromSlider(cur.data, Number(slider.value)), true));
          root.querySelector('.steps').addEventListener('click', e => {
            const b = e.target.closest('[data-s]');
            if (!b) return;
            const v = steps[Number(b.dataset.s)][1](val);
            setVal(cur.data.scale === 'log' ? nice(v) : Math.round(v), true);
            cur.snd('click');
          });
          root.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const v = Number(String(typed.value).replace(',', '.'));
            if (Number.isFinite(v)) setVal(v, true);
            typed.value = '';
          });
          lock = LockBar({ onLock: c => c.send('lock', { draft: val }) });
          root.appendChild(lock.el);
          if (C.isHost) {
            num.innerHTML = '?';
            for (const x of root.querySelectorAll('input, .steps, form')) x.classList.add('hidden');
          } else show();
        },
        update(C) {
          cur = C;
          const locked = !!(C.ts && C.ts.locked);
          lock.update(C, locked);
          if (C.isHost) {
            by.textContent = 'Die Teams schätzen gerade …';
            return;
          }
          for (const x of [slider, typed, ...document.querySelectorAll('.est .steps button, .est form button')]) x.disabled = locked;
          const d = C.ts && C.ts.draft;
          if (d != null && d !== val && sync.fresh(C) && C.ts.draftPid !== (C.me && C.me.id) && document.activeElement !== slider) {
            val = d;
            show();
          }
          by.textContent = C.ts && C.ts.draftBy ? `Zuletzt geändert von ${C.ts.draftBy}` : touched ? '' : 'Schiebt den Regler oder tippt eine Zahl ein.';
        },
        unmount() {
          clearTimeout(sendT);
        },
      };
    },
  };

  // ---------- Sortieren ----------
  Mech.sort = {
    create() {
      let cur;
      let list;
      let lock;
      let order = [];
      let dragging = null;
      const sync = DraftSync();
      const label = id => {
        const it = cur.data.items.find(x => x.id === id);
        return it ? it.label : '?';
      };
      const editable = () => canAct(cur);

      function renderList() {
        list.innerHTML = order
          .map(
            (id, i) =>
              `<li data-id="${id}"><span class="nr">${i + 1}</span><span class="grip">⋮⋮</span><span class="lb">${esc(label(id))}</span>${
                editable() ? '<span class="arr"><button class="btn sm" type="button" data-mv="-1">▲</button><button class="btn sm" type="button" data-mv="1">▼</button></span>' : ''
              }</li>`,
          )
          .join('');
        list.classList.toggle('ro', !editable());
      }

      function renumber() {
        [...list.children].forEach((li, i) => {
          li.querySelector('.nr').textContent = i + 1;
        });
      }

      function commit() {
        order = [...list.children].map(li => Number(li.dataset.id));
        renumber();
        sync.send(cur, order);
      }

      return {
        mount(host, C) {
          cur = C;
          order = C.ts && Array.isArray(C.ts.draft) ? C.ts.draft.slice() : C.data.items.map(x => x.id);
          const root = el(`<div class="sortwrap">
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="sortlbl">▲ ${esc(C.data.top)}</div>
            <ol class="sortlist"></ol>
            <div class="sortlbl">▼ ${esc(C.data.bottom)}</div>
          </div>`);
          host.appendChild(root);
          list = root.querySelector('.sortlist');
          lock = LockBar({ onLock: c => c.send('lock', { draft: order }) });
          root.appendChild(lock.el);
          renderList();

          list.addEventListener('click', e => {
            const b = e.target.closest('[data-mv]');
            if (!b || !editable()) return;
            const li = b.closest('li');
            if (Number(b.dataset.mv) < 0 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
            else if (Number(b.dataset.mv) > 0 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
            cur.snd('click');
            commit();
          });
          list.addEventListener('pointerdown', e => {
            if (!editable() || e.target.closest('button')) return;
            const li = e.target.closest('li');
            if (!li) return;
            dragging = li;
            li.classList.add('dragging');
            li.setPointerCapture(e.pointerId);
            e.preventDefault();
          });
          list.addEventListener('pointermove', e => {
            if (!dragging) return;
            const over = document.elementFromPoint(e.clientX, e.clientY);
            const li = over && over.closest('li');
            if (!li || li === dragging || li.parentElement !== list) return;
            const r = li.getBoundingClientRect();
            list.insertBefore(dragging, e.clientY > r.top + r.height / 2 ? li.nextSibling : li);
            renumber();
          });
          const end = () => {
            if (!dragging) return;
            dragging.classList.remove('dragging');
            dragging = null;
            commit();
          };
          list.addEventListener('pointerup', end);
          list.addEventListener('pointercancel', end);
        },
        update(C) {
          const wasEditable = editable();
          cur = C;
          lock.update(C, !!(C.ts && C.ts.locked));
          const d = C.ts && Array.isArray(C.ts.draft) && sync.fresh(C) ? C.ts.draft : null;
          if (!dragging && ((d && !same(d, order)) || wasEditable !== editable())) {
            if (d) order = d.slice();
            renderList();
          }
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex) return null;
      host.appendChild(
        el(`<div class="card"><div class="sortlbl" style="text-align:left">Richtige Reihenfolge</div><ol class="sortlist ro">${ex.correct
          .map((it, i) => `<li><span class="nr">${i + 1}</span><span class="lb">${esc(it.label)}</span><b style="color:var(--gold)">${esc(it.display)}</b></li>`)
          .join('')}</ol></div>`),
      );
      return null;
    },
  };

  // ---------- Zuordnen ----------
  Mech.match = {
    create() {
      let cur;
      let lock;
      let leftCol;
      let rightCol;
      let count;
      let sel = null;
      let pairs = {};
      const sync = DraftSync();

      function render() {
        const n = cur.data.left.length;
        const byRight = {};
        for (const [l, r] of Object.entries(pairs)) byRight[r] = Number(l);
        const ed = canAct(cur);
        leftCol.innerHTML = cur.data.left
          .map(it => {
            const paired = pairs[it.id] != null;
            return `<button type="button" class="mitem ${paired ? 'paired' : ''} ${sel === it.id ? 'sel' : ''}" data-l="${it.id}" style="--pc:${PAIR_COLORS[it.id % PAIR_COLORS.length]}" ${ed ? '' : 'disabled'}><span class="b">${paired ? it.id + 1 : ''}</span>${esc(it.label)}</button>`;
          })
          .join('');
        rightCol.innerHTML = cur.data.right
          .map(it => {
            const l = byRight[it.id];
            const paired = l != null;
            return `<button type="button" class="mitem ${paired ? 'paired' : ''}" data-r="${it.id}" style="--pc:${paired ? PAIR_COLORS[l % PAIR_COLORS.length] : 'transparent'}" ${ed ? '' : 'disabled'}><span class="b">${paired ? l + 1 : ''}</span>${esc(it.label)}</button>`;
          })
          .join('');
        count.textContent = `${Object.keys(pairs).length} von ${n} verbunden${sel != null ? ' · jetzt rechts das Passende antippen' : ''}`;
      }

      function commit() {
        sync.send(cur, pairs);
        render();
      }

      return {
        mount(host, C) {
          cur = C;
          pairs = C.ts && C.ts.draft ? { ...C.ts.draft } : {};
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="match"><div class="col l"></div><div class="col r"></div></div>
            <div class="m-hint"></div>
          </div>`);
          host.appendChild(root);
          leftCol = root.querySelector('.col.l');
          rightCol = root.querySelector('.col.r');
          count = root.querySelector('.m-hint');
          lock = LockBar({ onLock: c => c.send('lock', { draft: pairs }), canLock: () => Object.keys(pairs).length > 0 });
          root.appendChild(lock.el);
          leftCol.addEventListener('click', e => {
            const b = e.target.closest('[data-l]');
            if (!b || !canAct(cur)) return;
            const id = Number(b.dataset.l);
            sel = sel === id ? null : id;
            cur.snd('click');
            render();
          });
          rightCol.addEventListener('click', e => {
            const b = e.target.closest('[data-r]');
            if (!b || !canAct(cur)) return;
            const r = Number(b.dataset.r);
            const holder = Object.keys(pairs).find(l => pairs[l] === r);
            if (sel == null) {
              if (holder != null) {
                delete pairs[holder];
                commit();
              }
              return;
            }
            if (holder != null) delete pairs[holder];
            pairs[sel] = r;
            sel = null;
            cur.snd('click');
            commit();
          });
          render();
        },
        update(C) {
          cur = C;
          lock.update(C, !!(C.ts && C.ts.locked));
          if (sync.fresh(C) && !same(C.ts.draft, pairs)) pairs = { ...C.ts.draft };
          render();
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex) return null;
      host.appendChild(el(`<div class="pairs">${ex.pairs.map(p => `<div><b>${esc(p.left)}</b> ↔ ${esc(p.right)}</div>`).join('')}</div>`));
      return null;
    },
  };

  // ---------- Auswahl (Wer stirbt zuerst? / Hochstapler) ----------
  Mech.choice = {
    create() {
      let cur;
      let lock;
      let opts;
      return {
        mount(host, C) {
          cur = C;
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="opts">${C.data.options.map((o, i) => `<button type="button" class="opt" data-v="${i}"><span class="row"><span class="k">${LETTERS[i]}</span>${esc(o)}</span><div class="voters"></div></button>`).join('')}</div>
          </div>`);
          host.appendChild(root);
          opts = [...root.querySelectorAll('.opt')];
          lock = LockBar({ canLock: c => !!(c.ts && c.me && c.ts.votes[c.me.id] !== undefined), onLock: c => c.send('lock') });
          root.appendChild(lock.el);
          root.querySelector('.opts').addEventListener('click', e => {
            const b = e.target.closest('.opt');
            if (!b || !canAct(cur)) return;
            cur.snd('click');
            cur.send('vote', { v: Number(b.dataset.v) });
          });
        },
        update(C) {
          cur = C;
          const locked = !!(C.ts && C.ts.locked);
          lock.update(C, locked);
          const mine = C.ts && C.me ? C.ts.votes[C.me.id] : undefined;
          opts.forEach((b, i) => {
            b.disabled = !canAct(C);
            b.classList.toggle('mine', mine === i && !locked);
            b.classList.toggle('final', locked && C.ts.answer === i);
            b.querySelector('.voters').innerHTML = C.ts ? voters(C, C.ts.votes, i) : '';
          });
        },
      };
    },
  };

  // ---------- Lügendetektor ----------
  Mech.bet = {
    create() {
      let cur;
      let lock;
      let tf;
      let wager;
      let info;
      return {
        mount(host, C) {
          cur = C;
          const root = el(`<div>
            <div class="statement">${esc(C.data.statement)}</div>
            <div class="tf">
              <button type="button" class="opt t" data-v="1">✅ WAHR<div class="voters"></div></button>
              <button type="button" class="opt f" data-v="0">❌ GELOGEN<div class="voters"></div></button>
            </div>
            <div class="wager"><b>Einsatz:</b>${[25, 50, 75, 100].map(w => `<button type="button" class="btn sm" data-w="${w}">${w} %</button>`).join('')}<span class="muted info"></span></div>
          </div>`);
          host.appendChild(root);
          tf = [...root.querySelectorAll('.tf .opt')];
          wager = [...root.querySelectorAll('[data-w]')];
          info = root.querySelector('.info');
          lock = LockBar({ canLock: c => !!(c.ts && c.me && c.ts.votes[c.me.id] !== undefined), onLock: c => c.send('lock', { wager: c.ts.draft }) });
          root.appendChild(lock.el);
          root.querySelector('.tf').addEventListener('click', e => {
            const b = e.target.closest('.opt');
            if (!b || !canAct(cur)) return;
            cur.snd('click');
            cur.send('vote', { v: b.dataset.v === '1' });
          });
          root.querySelector('.wager').addEventListener('click', e => {
            const b = e.target.closest('[data-w]');
            if (!b || !canAct(cur)) return;
            cur.snd('click');
            cur.send('draft', { v: Number(b.dataset.w) });
          });
          if (C.isHost) root.querySelector('.wager').classList.add('hidden');
        },
        update(C) {
          cur = C;
          const locked = !!(C.ts && C.ts.locked);
          lock.update(C, locked);
          const mine = C.ts && C.me ? C.ts.votes[C.me.id] : undefined;
          const w = (C.ts && C.ts.draft) || 50;
          tf.forEach(b => {
            const v = b.dataset.v === '1';
            b.disabled = !canAct(C);
            b.classList.toggle('mine', mine === v && !locked);
            b.classList.toggle('final', locked && C.ts.answer && C.ts.answer.choice === v);
            b.querySelector('.voters').innerHTML = C.ts ? voters(C, C.ts.votes, v) : '';
          });
          wager.forEach(b => {
            b.disabled = !canAct(C);
            b.classList.toggle('on', Number(b.dataset.w) === (locked && C.ts.answer ? C.ts.answer.wager : w));
          });
          const stake = (C.q.value * w) / 100;
          info.textContent = `Richtig: +${fmt(Math.round(stake / 5) * 5)} · Falsch: −${fmt(Math.round(stake / 10) * 5)}`;
        },
      };
    },
  };

  // ---------- Höher oder Tiefer ----------
  Mech.hl = {
    create() {
      let cur;
      let lock;
      let root;
      let lastShown = -1;
      return {
        mount(host, C) {
          cur = C;
          root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="dots"></div>
            <div class="hl">
              <div class="hlcard a"><div class="muted">${esc(C.data.metric)}</div><div class="lb"></div><div class="vl"></div></div>
              <div class="hlvs">vs</div>
              <div class="hlcard b"><div class="muted">${esc(C.data.metric)}</div><div class="lb"></div><div class="vl q">?</div></div>
            </div>
            <div class="hlbtns">
              <button type="button" class="opt" data-v="up">▲ Höher<div class="voters"></div></button>
              <button type="button" class="opt" data-v="down">▼ Tiefer<div class="voters"></div></button>
            </div>
            <div class="hlres"></div>
          </div>`);
          host.appendChild(root);
          lock = LockBar({ canLock: c => !!(c.ts && c.me && c.ts.hlVotes[c.me.id] !== undefined), onLock: c => c.send('lock') });
          root.appendChild(lock.el);
          root.querySelector('.hlbtns').addEventListener('click', e => {
            const b = e.target.closest('.opt');
            if (!b || cur.isHost || !cur.ts || cur.ts.hlLocked || cur.data.roundPhase !== 'choose') return;
            cur.snd('click');
            cur.send('vote', { v: b.dataset.v });
          });
        },
        update(C) {
          cur = C;
          const d = C.data;
          const r = d.round;
          const a = d.items[r];
          const b = d.items[r + 1];
          const show = d.roundPhase === 'show';
          const myId = C.myTeam && C.myTeam.id;
          root.querySelector('.dots').innerHTML = Array.from({ length: d.rounds }, (_, i) => {
            const h = d.history[i];
            let cls = i === r && !show ? 'cur' : '';
            if (h && myId) cls = h.results[myId] && h.results[myId].ok ? 'ok' : 'bad';
            else if (h) cls = 'ok';
            return `<i class="${cls}"></i>`;
          }).join('');
          root.querySelector('.a .lb').textContent = a.label;
          root.querySelector('.a .vl').textContent = a.display || '';
          root.querySelector('.b .lb').textContent = b.label;
          const bv = root.querySelector('.b .vl');
          bv.textContent = show && b.display ? b.display : '?';
          bv.classList.toggle('q', !show);
          const res = show && d.history[r];
          const bc = root.querySelector('.hlcard.b');
          bc.classList.toggle('ok', !!(res && myId && res.results[myId] && res.results[myId].ok));
          bc.classList.toggle('bad', !!(res && myId && res.results[myId] && !res.results[myId].ok));
          const votes = (C.ts && C.ts.hlVotes) || {};
          const mine = C.me ? votes[C.me.id] : undefined;
          const lockedChoice = C.ts && C.ts.hlLocked ? C.ts.hlAnswers[r] : undefined;
          root.querySelectorAll('.hlbtns .opt').forEach(btn => {
            const v = btn.dataset.v;
            btn.disabled = C.isHost || !C.ts || C.ts.hlLocked || show;
            btn.classList.toggle('mine', mine === v && !(C.ts && C.ts.hlLocked));
            btn.classList.toggle('final', lockedChoice === v || (show && res && res.correct === v));
            btn.querySelector('.voters').innerHTML = voters(C, votes, v);
          });
          root.querySelector('.hlres').innerHTML = res
            ? C.pub.teams
                .map(t => {
                  const x = res.results[t.id];
                  return `<span class="chip" style="--c:${t.color}"><span class="dot"></span>${esc(t.name)} ${x && x.ok ? '✓' : '✗'}</span>`;
                })
                .join('')
            : '';
          if (show && r !== lastShown) {
            lastShown = r;
            if (myId && res) C.snd(res.results[myId] && res.results[myId].ok ? 'correct' : 'wrong');
            else C.snd('reveal');
          }
          lock.update(C, !!(C.ts && C.ts.hlLocked) || show);
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex) return null;
      host.appendChild(
        el(`<div class="card chain">${ex.items
          .map((it, i) => `${i ? '<span class="ar">→</span>' : ''}<span class="it">${esc(it.label)}<b>${esc(it.display || fmt(it.value))}</b></span>`)
          .join('')}</div>`),
      );
      return null;
    },
  };

  // ---------- Hinweis-Jagd ----------
  Mech.clues = {
    create() {
      let cur;
      let list;
      let factor;
      let next;
      let answer;
      let shown = 0;
      return {
        mount(host, C) {
          cur = C;
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="factor"></div>
            <ul class="clues"></ul>
            <div class="m-hint next"></div>
            <div class="answer"></div>
          </div>`);
          host.appendChild(root);
          list = root.querySelector('.clues');
          factor = root.querySelector('.factor');
          next = root.querySelector('.next');
          answer = root.querySelector('.answer');
        },
        update(C) {
          cur = C;
          const d = C.data;
          while (shown < d.clues.length) {
            const li = document.createElement('li');
            li.dataset.n = shown + 1;
            li.textContent = d.clues[shown];
            list.appendChild(li);
            shown++;
            C.snd('type');
          }
          const k = d.clues.length - 1;
          factor.innerHTML = `<span class="muted">Punkte jetzt:</span>${d.factors
            .slice(0, d.total)
            .map((f, i) => `<b class="${i === k ? 'cur' : ''}">${Math.round(f * 100)} %</b>`)
            .join('')}<span class="muted">= ${fmt(Math.round((C.q.value * d.factors[k]) / 5) * 5)} Punkte</span>`;
          next.innerHTML = d.nextAt ? `Nächster Hinweis in <b class="cd" data-ends="${d.nextAt}"></b> s` : 'Das war der letzte Hinweis!';
          let html = '';
          let mode = '';
          if (C.isHost) {
            mode = 'host';
            html = '<div class="muted">Die Teams grübeln …</div>';
          } else if (C.ts && C.ts.locked && C.ts.answer) {
            mode = `done${C.ts.answer.text}`;
            const by = C.ts.answer.by ? ` von ${esc(C.ts.answer.by)}` : '';
            html = `<div class="lockbar locked"><div class="txt">✓ Abgegeben${by} bei Hinweis ${C.ts.answer.clue}: „${esc(C.ts.answer.text)}“ – Auflösung am Ende.</div></div>`;
          } else {
            // Alle im Team dürfen antworten – der erste abgeschickte Versuch zählt fürs ganze Team.
            mode = 'guess';
            html = '<form class="guessrow"><input class="inp big" maxlength="80" placeholder="Eure Antwort …" autocomplete="off"><button class="btn primary lg">Antworten</button></form><div class="m-hint">Nur EIN Versuch fürs ganze Team – wer zuerst abschickt, legt fest. Früh antworten bringt mehr Punkte.</div>';
          }
          if (answer.dataset.mode !== mode) {
            answer.dataset.mode = mode;
            answer.innerHTML = html;
            const f = answer.querySelector('form');
            if (f) {
              f.addEventListener('submit', e => {
                e.preventDefault();
                const inp = f.querySelector('input');
                const text = inp.value.trim();
                if (!text) return;
                if (!window.confirm(`„${text}“ als eure EINZIGE Antwort abgeben?`)) return;
                cur.send('guess', { text });
              });
              f.querySelector('input').focus();
            }
          }
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex) return null;
      host.appendChild(el(`<ul class="clues">${ex.clues.map((c, i) => `<li data-n="${i + 1}" style="animation-delay:${i * 80}ms">${esc(c)}</li>`).join('')}</ul>`));
      return null;
    },
  };

  // ---------- Tipp-Rennen ----------
  Mech.type = {
    create() {
      let cur;
      let feed;
      let form;
      let solved;
      return {
        mount(host, C) {
          cur = C;
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            ${C.data.emoji ? `<div class="emoji">${esc(C.data.emoji)}</div>` : ''}
            <form class="guessrow"><input class="inp big" maxlength="80" placeholder="Eure Antwort …" autocomplete="off"><button class="btn primary lg">Raten</button></form>
            <div class="solved hidden"></div>
            <ul class="feed"></ul>
          </div>`);
          host.appendChild(root);
          feed = root.querySelector('.feed');
          form = root.querySelector('form');
          solved = root.querySelector('.solved');
          if (C.isHost) {
            form.classList.add('hidden');
            feed.classList.add('hidden');
          }
          form.addEventListener('submit', e => {
            e.preventDefault();
            const inp = form.querySelector('input');
            const text = inp.value.trim();
            if (!text) return;
            inp.value = '';
            cur.send('guess', { text }).then(r => {
              if (r.correct) cur.snd('correct');
              else if (r.ok) cur.snd('buzz');
            });
          });
          if (!C.isHost) form.querySelector('input').focus();
        },
        update(C) {
          cur = C;
          if (C.isHost || !C.ts) return;
          if (C.ts.solvedAt) {
            form.classList.add('hidden');
            solved.classList.remove('hidden');
            solved.textContent = `✓ Gelöst von ${C.ts.solvedBy} nach ${fmt((C.ts.solvedAt - C.q.startedAt) / 1000, 1)} s!`;
          }
          feed.innerHTML = C.ts.feed
            .slice()
            .reverse()
            .slice(0, 12)
            .map(f => `<li class="${f.ok ? 'ok' : 'bad'}"><span class="who">${esc(f.name)}:</span>${f.ok ? '✓' : '✗'} ${esc(f.text)}</li>`)
            .join('');
        },
      };
    },
  };

  // ---------- Code knacken ----------
  Mech.code = {
    create() {
      let cur;
      let entry = '';
      let digitsEl;
      let door;
      let cool;
      let feed;
      let hintEl;
      let keyHandler;
      let n = 4;

      function draw() {
        digitsEl.innerHTML = Array.from({ length: n }, (_, i) => `<span>${entry[i] || ''}</span>`).join('');
      }

      function blocked() {
        return cur.isHost || !cur.ts || cur.ts.solvedAt || cur.ts.cooldownUntil > cur.serverNow();
      }

      function press(k) {
        if (blocked()) return;
        if (k === 'del') entry = entry.slice(0, -1);
        else if (k === 'ok') submit();
        else if (entry.length < n) {
          entry += k;
          cur.snd('type');
          if (entry.length === n) {
            draw();
            setTimeout(submit, 180);
            return;
          }
        }
        draw();
      }

      function submit() {
        if (entry.length !== n || blocked()) return;
        const code = entry;
        entry = '';
        cur.send('guess', { text: code }).then(r => {
          if (r.correct) {
            cur.snd('correct');
            door.classList.add('open');
          } else if (r.ok) {
            cur.snd('wrong');
            door.classList.remove('bad');
            void door.offsetWidth;
            door.classList.add('bad');
          }
          draw();
        });
      }

      return {
        mount(host, C) {
          cur = C;
          n = C.data.digits;
          const root = el(`<div>
            <div class="m-prompt">${esc(C.data.prompt)}</div>
            <div class="riddle">${C.data.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
            <div class="hintbox hidden"></div>
            <div class="lockui">
              <div class="door"><div class="digits"></div></div>
              <div class="cooldown"></div>
              <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']
                .map(k => `<button type="button" class="btn" data-k="${k}">${k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}</button>`)
                .join('')}</div>
            </div>
            <ul class="feed"></ul>
          </div>`);
          host.appendChild(root);
          digitsEl = root.querySelector('.digits');
          door = root.querySelector('.door');
          cool = root.querySelector('.cooldown');
          feed = root.querySelector('.feed');
          hintEl = root.querySelector('.hintbox');
          if (C.isHost) {
            root.querySelector('.keypad').classList.add('hidden');
            feed.classList.add('hidden');
          }
          root.querySelector('.keypad').addEventListener('click', e => {
            const b = e.target.closest('[data-k]');
            if (b) press(b.dataset.k);
          });
          keyHandler = e => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            if (/^[0-9]$/.test(e.key)) press(e.key);
            else if (e.key === 'Backspace') press('del');
            else if (e.key === 'Enter') press('ok');
          };
          document.addEventListener('keydown', keyHandler);
          draw();
        },
        update(C) {
          cur = C;
          if (C.data.hint) {
            hintEl.classList.remove('hidden');
            hintEl.textContent = `💡 Tipp: ${C.data.hint}`;
          } else if (C.data.hintAt) {
            hintEl.classList.add('hidden');
          }
          if (C.isHost || !C.ts) return;
          if (C.ts.solvedAt) {
            door.classList.add('open');
            cool.innerHTML = `<span style="color:var(--green)">🚪 Ihr seid entkommen! (${esc(C.ts.solvedBy)}, ${fmt((C.ts.solvedAt - C.q.startedAt) / 1000, 1)} s)</span>`;
          }
          feed.innerHTML = C.ts.feed
            .slice()
            .reverse()
            .slice(0, 10)
            .map(f => `<li class="${f.ok ? 'ok' : 'bad'}"><span class="who">${esc(f.name)}:</span>${f.ok ? '✓' : '✗'} ${esc(f.text)}</li>`)
            .join('');
        },
        tick(C, now) {
          if (!C.ts || C.ts.solvedAt || C.isHost) return;
          const left = (C.ts.cooldownUntil || 0) - now;
          cool.textContent = left > 0 ? `🔒 Falscher Code – gesperrt für ${Math.ceil(left / 1000)} s` : '';
        },
        unmount() {
          document.removeEventListener('keydown', keyHandler);
        },
      };
    },
  };

  // ---------- Montagsmaler ----------
  const PALETTE = ['#f1e7d0', '#1a1a1a', '#d0142c', '#ff8c1a', '#2f9e1f', '#7b3fc4', '#1f78c4', '#ffffff', '#7a4a1e', '#e8c21a'];

  function drawSegs(canvas, segs) {
    const c2d = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    c2d.lineCap = 'round';
    c2d.lineJoin = 'round';
    for (const s of segs) {
      c2d.strokeStyle = PALETTE[s[4]] || '#1a1a1a';
      c2d.lineWidth = (s[5] * W) / 1000;
      c2d.beginPath();
      c2d.moveTo((s[0] * W) / 1000, (s[1] * H) / 1000);
      c2d.lineTo((s[2] * W) / 1000, (s[3] * H) / 1000);
      c2d.stroke();
    }
  }

  function clearCanvas(canvas) {
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = PALETTE[0];
    c2d.fillRect(0, 0, canvas.width, canvas.height);
  }

  Mech.draw = {
    create() {
      let cur;
      let root;
      const canvases = {};
      let color = 1;
      let size = 8;
      let drawing = false;
      let last = null;
      let buf = [];
      let flushT = null;
      let feed;
      let form;
      let solvedEl;

      function flush() {
        if (buf.length) {
          cur.socket.emit('draw:stroke', { s: buf });
          buf = [];
        }
      }

      function point(e, canvas) {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1000, Math.round(((e.clientX - r.left) / r.width) * 1000))),
          y: Math.max(0, Math.min(1000, Math.round(((e.clientY - r.top) / r.height) * 1000))),
        };
      }

      function makeCanvas(editable) {
        const cv = document.createElement('canvas');
        cv.width = 1000;
        cv.height = 750;
        cv.className = `drawcanvas ${editable ? '' : 'ro'}`;
        clearCanvas(cv);
        if (editable) {
          cv.addEventListener('pointerdown', e => {
            if (!cur.isDrawer || (cur.ts && cur.ts.solvedAt)) return;
            drawing = true;
            last = point(e, cv);
            cv.setPointerCapture(e.pointerId);
            const s = [last.x, last.y, last.x, last.y, color, size];
            drawSegs(cv, [s]);
            buf.push(s);
          });
          cv.addEventListener('pointermove', e => {
            if (!drawing) return;
            const p = point(e, cv);
            if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 3) return;
            const s = [last.x, last.y, p.x, p.y, color, size];
            drawSegs(cv, [s]);
            buf.push(s);
            last = p;
          });
          const stop = () => {
            drawing = false;
            flush();
          };
          cv.addEventListener('pointerup', stop);
          cv.addEventListener('pointercancel', stop);
        }
        return cv;
      }

      return {
        mount(host, C) {
          cur = C;
          if (C.isHost) {
            root = el(`<div><div class="m-prompt">Alle Teams malen gleichzeitig – hier siehst du live mit:</div><div class="gallery"></div></div>`);
            host.appendChild(root);
            const g = root.querySelector('.gallery');
            for (const t of C.pub.teams) {
              // Teams ohne Maler raten woanders mit – für sie gibt es kein eigenes Bild
              if (C.q.teams[t.id] && C.q.teams[t.id].watch) continue;
              const fig = el(`<figure style="--c:${t.color}"><figcaption>${esc(t.name)}</figcaption></figure>`);
              const cv = makeCanvas(false);
              cv.className = '';
              fig.appendChild(cv);
              g.appendChild(fig);
              canvases[t.id] = cv;
            }
            C.hostSend('sync').then(r => (r.teams || []).forEach(t => canvases[t.teamId] && drawSegs(canvases[t.teamId], t.strokes)));
            return;
          }
          const drawer = C.isDrawer;
          // Einzelteams sehen die Zeichnung eines anderen Teams.
          const status = C.myTeam && C.q.teams[C.myTeam.id];
          const watched = status && status.watch ? C.teamById(status.watch) : null;
          const whoDraws = watched ? `das Team ${watched.name}` : C.drawer ? C.drawer.name : 'euer Maler';
          root = el(`<div class="drawwrap">
            ${drawer ? `<div class="word">Male: ${esc(C.me.word || '')}</div>` : `<div class="m-prompt center">Was malt ${esc(whoDraws)}? <span class="muted">(${'＿ '.repeat(C.data.letters).trim()} · ${C.data.letters} Buchstaben)</span></div>`}
            <div class="cvslot" style="width:100%;display:flex;justify-content:center"></div>
            ${
              drawer
                ? `<div class="palette">${PALETTE.slice(1).map((c, i) => `<button type="button" class="sw ${i + 1 === color ? 'on' : ''}" data-c="${i + 1}" style="background:${c}"></button>`).join('')}
                   <button type="button" class="btn sm sz" data-z="4">dünn</button><button type="button" class="btn sm sz on" data-z="8">mittel</button><button type="button" class="btn sm sz" data-z="18">dick</button>
                   <button type="button" class="btn sm" data-c="0">🧽 Radierer</button><button type="button" class="btn sm danger" data-clear>🗑️ Alles löschen</button></div>`
                : '<form class="guessrow" style="width:min(100%,880px)"><input class="inp big" maxlength="60" placeholder="Was ist das?" autocomplete="off"><button class="btn primary lg">Raten</button></form>'
            }
            <div class="solved hidden" style="width:min(100%,880px)"></div>
            <ul class="feed" style="width:min(100%,880px)"></ul>
          </div>`);
          host.appendChild(root);
          const cv = makeCanvas(drawer);
          canvases[watched ? watched.id : C.me.teamId] = cv;
          root.querySelector('.cvslot').appendChild(cv);
          feed = root.querySelector('.feed');
          solvedEl = root.querySelector('.solved');
          form = root.querySelector('form');
          if (drawer) {
            flushT = setInterval(flush, 60);
            root.querySelector('.palette').addEventListener('click', e => {
              const b = e.target.closest('button');
              if (!b) return;
              if (b.dataset.clear !== undefined) {
                if (!window.confirm('Alles löschen?')) return;
                clearCanvas(cv);
                cur.send('clear');
                return;
              }
              if (b.dataset.c !== undefined) {
                color = Number(b.dataset.c);
                root.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b));
              }
              if (b.dataset.z !== undefined) {
                size = Number(b.dataset.z);
                root.querySelectorAll('[data-z]').forEach(x => x.classList.toggle('on', x === b));
              }
            });
          } else {
            form.addEventListener('submit', e => {
              e.preventDefault();
              const inp = form.querySelector('input');
              const text = inp.value.trim();
              if (!text) return;
              inp.value = '';
              cur.send('guess', { text }).then(r => {
                if (r.correct) cur.snd('correct');
                else if (r.ok) cur.snd('buzz');
              });
            });
            form.querySelector('input').focus();
          }
          C.send('sync').then(r => (r.teams || []).forEach(t => canvases[t.teamId] && drawSegs(canvases[t.teamId], t.strokes)));
        },
        update(C) {
          cur = C;
          if (C.isHost || !C.ts) return;
          if (C.ts.solvedAt) {
            if (form) form.classList.add('hidden');
            solvedEl.classList.remove('hidden');
            solvedEl.textContent = `✓ Erraten von ${C.ts.solvedBy} nach ${fmt((C.ts.solvedAt - C.q.startedAt) / 1000, 1)} s!`;
          }
          feed.innerHTML = C.ts.feed
            .slice()
            .reverse()
            .slice(0, 10)
            .map(f => `<li class="${f.ok ? 'ok' : 'bad'}"><span class="who">${esc(f.name)}:</span>${f.ok ? '✓' : '✗'} ${esc(f.text)}</li>`)
            .join('');
        },
        onStroke(d) {
          const cv = canvases[d.teamId];
          if (cv) drawSegs(cv, d.s);
        },
        onClear(d) {
          const cv = canvases[d.teamId];
          if (cv) clearCanvas(cv);
        },
        unmount() {
          clearInterval(flushT);
          if (buf.length) flush();
        },
      };
    },
    gallery(host, C, g) {
      host.innerHTML = '';
      const box = el('<div class="gallery"></div>');
      for (const t of g.teams) {
        const team = C.teamById(t.teamId);
        const status = C.q && C.q.teams && C.q.teams[t.teamId];
        if (!team || (status && status.watch)) continue;
        const fig = el(`<figure style="--c:${team.color}"><figcaption>${esc(team.name)}</figcaption></figure>`);
        const cv = document.createElement('canvas');
        cv.width = 1000;
        cv.height = 750;
        clearCanvas(cv);
        drawSegs(cv, t.strokes);
        fig.appendChild(cv);
        box.appendChild(fig);
      }
      host.appendChild(box);
    },
  };

  // ---------- Puzzle ----------
  const sceneCache = {};

  function sceneURL(scene) {
    if (sceneCache[scene]) return sceneCache[scene];
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 720;
    try {
      if (window.Scenes && window.Scenes.draw) window.Scenes.draw(scene, c);
      else throw new Error('Szenen fehlen');
    } catch (e) {
      console.warn(e);
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 720, 720);
      grad.addColorStop(0, '#ff8c1a');
      grad.addColorStop(0.5, '#4a1060');
      grad.addColorStop(1, '#0b0909');
      g.fillStyle = grad;
      g.fillRect(0, 0, 720, 720);
      g.font = '120px serif';
      g.textAlign = 'center';
      g.fillText('🎃👻💀', 360, 300);
      g.fillText('🦇🕯️🕷️', 360, 520);
    }
    sceneCache[scene] = c.toDataURL('image/jpeg', 0.92);
    return sceneCache[scene];
  }

  Mech.puzzle = {
    create() {
      let cur;
      let grid;
      let perm = [];
      let sel = null;
      let n = 3;
      let url;
      let prog;
      let bonusEl;

      function pos(piece) {
        const col = piece % n;
        const row = Math.floor(piece / n);
        return `${(col / (n - 1)) * 100}% ${(row / (n - 1)) * 100}%`;
      }

      function render() {
        const done = perm.length && perm.every((v, i) => v === i);
        grid.classList.toggle('done', !!done);
        grid.innerHTML = perm
          .map((piece, i) => `<div class="pc ${piece === i ? 'ok' : ''} ${sel === i ? 'sel' : ''}" data-i="${i}" style="background-image:url(${url});background-size:${n * 100}% ${n * 100}%;background-position:${pos(piece)}"></div>`)
          .join('');
        const good = perm.filter((v, i) => v === i).length;
        if (prog) prog.style.width = `${(good / perm.length) * 100}%`;
      }

      return {
        mount(host, C) {
          cur = C;
          n = C.data.grid;
          url = sceneURL(C.data.scene);
          perm = C.ts && C.ts.perm ? C.ts.perm.slice() : Array.from({ length: n * n }, (_, i) => i);
          const root = el(`<div>
            <div class="m-prompt">${C.isHost ? 'Die Teams puzzeln um die Wette …' : 'Setzt das Bild zusammen! Teil antippen, dann das Ziel antippen.'}</div>
            <div class="puzwrap">
              <div class="puz" style="grid-template-columns:repeat(${n},1fr)"></div>
              <div class="puzside">
                <div class="muted">Vorlage</div>
                <img alt="Vorlage" src="${url}">
                <div class="progress"><i style="width:0"></i></div>
                <div class="bonus"></div>
              </div>
            </div>
          </div>`);
          host.appendChild(root);
          grid = root.querySelector('.puz');
          prog = root.querySelector('.progress i');
          bonusEl = root.querySelector('.bonus');
          if (C.isHost) {
            grid.classList.add('hidden');
            root.querySelector('.progress').classList.add('hidden');
          }
          grid.addEventListener('click', e => {
            const pc = e.target.closest('.pc');
            if (!pc || cur.isHost || !cur.ts || cur.ts.solvedAt) return;
            const i = Number(pc.dataset.i);
            if (sel == null) sel = i;
            else if (sel === i) sel = null;
            else {
              [perm[sel], perm[i]] = [perm[i], perm[sel]];
              cur.send('swap', { x: sel, y: i });
              cur.snd('click');
              sel = null;
            }
            render();
          });
          bonusEl.addEventListener('submit', e => {
            e.preventDefault();
            const inp = bonusEl.querySelector('input');
            const text = inp.value.trim();
            if (!text) return;
            cur.send('bonus', { text }).then(r => {
              if (r.ok) cur.snd(r.correct ? 'correct' : 'wrong');
            });
          });
          render();
        },
        update(C) {
          cur = C;
          if (C.isHost || !C.ts) return;
          if (C.ts.perm && !same(C.ts.perm, perm)) {
            perm = C.ts.perm.slice();
            if (sel != null && C.ts.solvedAt) sel = null;
            render();
          }
          let mode = 'none';
          let html = '';
          if (C.ts.solvedAt && C.data.bonusQuestion) {
            if (C.ts.bonus) {
              mode = `b${C.ts.bonus.ok}`;
              html = C.ts.bonus.ok
                ? `<div class="solved">✓ Richtig: „${esc(C.ts.bonus.text)}“ +25 %</div>`
                : `<div class="lockbar"><div class="txt">✗ „${esc(C.ts.bonus.text)}“ war leider falsch.</div></div>`;
            } else {
              mode = 'ask';
              html = `<div class="solved">🧩 Fertig! (${esc(C.ts.solvedBy)})</div><form class="row wrap" style="margin-top:10px"><div class="muted" style="width:100%">Bonus: ${esc(C.data.bonusQuestion)} (1 Versuch)</div><input class="inp grow" maxlength="60" placeholder="Filmtitel …" autocomplete="off"><button class="btn primary">Raten</button></form>`;
            }
          } else if (C.ts.solvedAt) {
            mode = 'done';
            html = `<div class="solved">🧩 Fertig! (${esc(C.ts.solvedBy)})</div>`;
          }
          if (bonusEl.dataset.mode !== mode) {
            bonusEl.dataset.mode = mode;
            bonusEl.innerHTML = html;
            const inp = bonusEl.querySelector('input');
            if (inp) inp.focus();
          }
        },
      };
    },
    reveal(host, C, R) {
      const ex = R.extra;
      if (!ex) return null;
      host.appendChild(el(`<div class="center"><img alt="" src="${sceneURL(ex.scene)}" style="width:min(420px,90vw);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.6)"></div>`));
      return null;
    },
  };

  window.Mech = Mech;
})();
