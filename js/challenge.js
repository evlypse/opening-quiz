/*
 * DÉFIS ENTRE AMIS
 * ----------------
 * Un défi = une liste d'openings (nombre libre, jusqu'à 100), avec pour CHAQUE opening le moment où
 * l'extrait démarre et sa durée. Rien à héberger : tout le défi est écrit dans le lien
 * (…/index.html?defi=CODE). Ton ami ouvre le lien, clique sur « Démarrer », joue, et peut te
 * renvoyer son résultat (bouton « Copier mon résultat »).
 *
 * Création : onglet « Défis » du menu. Les openings s'ajoutent avec le bouton ⚔ de la Bibliothèque
 * et des Listes, ou au hasard. Ce brouillon est gardé dans le navigateur.
 * Ces « défis » n'ont rien à voir avec les « listes » de favoris.
 *
 * Ce fichier a besoin de js/app.js, js/library.js (panneau) et js/lists.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ || !OQ.panel) return;

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'oq-challenge-draft-v1';
  const MAX_ENTRIES = 100;
  const POINTS = [3, 2, 1];                       // sans indice, avec l'opening entier, avec les initiales
  const EMOJI = { correct: '✅', presque: '🟧', faux: '❌', gaveup: '⬜', skip: '➖' };
  const VERDICT_LABEL = { correct: 'Correct', presque: 'Presque', faux: 'Faux', gaveup: 'Abandon', skip: 'Indisponible' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignoré */ } }
  };
  const round1 = (n) => Math.round(n * 10) / 10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v) => parseFloat(String(v).replace(',', '.'));
  const fmt = (n) => String(round1(n)).replace('.', ',');
  const rand = (n) => Math.floor(Math.random() * n);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const api = { active: false };
  OQ.challenge = api;

  /* ------------------------------------------------------------------
   * Brouillon (le défi en cours de création)
   * ------------------------------------------------------------------ */
  const defaultLength = () => {
    const n = num(store.get('opening-quiz-length', '5'));
    return Number.isFinite(n) ? clamp(round1(n), 0.1, 20) : 5;
  };

  function loadDraft() {
    const d = { title: '', guessNumber: true, hints: false, defLength: defaultLength(), entries: [] };
    try {
      const o = JSON.parse(store.get(DRAFT_KEY, ''));
      if (o && typeof o === 'object') {
        d.title = String(o.title || '').slice(0, 40);
        d.guessNumber = o.guessNumber !== false;
        d.hints = !!o.hints;
        if (Number.isFinite(o.defLength)) d.defLength = clamp(round1(o.defLength), 0.1, 20);
        if (Array.isArray(o.entries)) {
          o.entries.slice(0, MAX_ENTRIES).forEach((e) => {
            if (!e || !Number.isFinite(Number(e.id))) return;
            d.entries.push({
              id: Number(e.id), title: String(e.title || ''), number: Number(e.number) || 0,
              songTitle: String(e.songTitle || ''), artists: Array.isArray(e.artists) ? e.artists.map(String) : [],
              start: clamp(round1(Number(e.start) || 0), 0, 3600), length: clamp(round1(Number(e.length) || 5), 0.1, 20),
              auto: !!e.auto
            });
          });
        }
      }
    } catch (err) { /* brouillon illisible : on repart de zéro */ }
    return d;
  }
  let draft = loadDraft();

  function save() {
    // les champs qui commencent par « _ » (durée, lien audio) ne sont pas gardés
    store.set(DRAFT_KEY, JSON.stringify(draft, (k, v) => (k[0] === '_' ? undefined : v)));
    updateNav();
  }

  function updateNav() {
    const n = draft.entries.length;
    const b = $('nav-challenge');
    if (b) b.textContent = '⚔ Défis' + (n ? ' (' + n + ')' : '');
  }

  /* ------------------------------------------------------------------
   * Audio : lien + durée d'un opening (une requête à la fois, pour ménager l'API)
   * ------------------------------------------------------------------ */
  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  const media = new Map();                       // id d'opening -> Promise<{ url, dur }>
  function ensureMedia(entry) {
    if (media.has(entry.id)) return media.get(entry.id);
    const p = (async () => {
      let url = entry._url;
      if (!url) {
        const cand = OQ.candidateFromTheme(await OQ.fetchTheme(entry.id));
        url = cand && cand.url;
      }
      if (!url) throw new Error('pas d\'audio');
      const dur = await new Promise((resolve) => {
        const a = new Audio();
        a.preload = 'metadata';
        const timer = setTimeout(() => done(0), 10000);
        function done(v) { clearTimeout(timer); a.removeAttribute('src'); resolve(v); }
        a.addEventListener('loadedmetadata', () => done(Number.isFinite(a.duration) ? a.duration : 0));
        a.addEventListener('error', () => done(0));
        a.src = url;
      });
      entry._dur = dur;
      return { url, dur };
    })();
    media.set(entry.id, p);
    p.catch(() => media.delete(entry.id));
    return p;
  }

  /* ------------------------------------------------------------------
   * Écoute d'un extrait dans le constructeur
   * ------------------------------------------------------------------ */
  const tAudio = new Audio();
  let tBtn = null;
  let tTimer = 0;

  function stopTest() {
    clearInterval(tTimer);
    tAudio.pause();
    if (tBtn) { tBtn.textContent = '▶'; tBtn = null; }
  }
  document.addEventListener('oq:gameaudio', stopTest);

  async function testEntry(btn, entry) {
    if (tBtn === btn) { stopTest(); return; }
    stopTest();
    OQ.pauseGame();
    document.dispatchEvent(new CustomEvent('oq:gameaudio'));   // coupe aussi les écoutes de la bibliothèque
    tBtn = btn;
    btn.textContent = '…';
    try {
      const m = await enqueue(() => ensureMedia(entry));
      if (tBtn !== btn) return;
      tAudio.src = m.url;
      await new Promise((resolve) => { tAudio.onloadedmetadata = resolve; tAudio.onerror = resolve; });
      if (tBtn !== btn) return;
      tAudio.currentTime = entry.start;
      await tAudio.play();
      btn.textContent = '⏸';
      const end = entry.start + entry.length;
      tTimer = setInterval(() => { if (tAudio.currentTime >= end || tAudio.ended) stopTest(); }, 40);
    } catch (err) {
      if (tBtn === btn) { btn.textContent = '✕'; tBtn = null; }
    }
  }

  const oldClose = OQ.panel.close;
  OQ.panel.close = () => { stopTest(); oldClose(); };

  /* ------------------------------------------------------------------
   * Ajouter / retirer des openings
   * ------------------------------------------------------------------ */
  let renderTimer = 0;
  function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === 'INPUT' && $('ch-list').contains(a)) { renderSoon(); return; }   // on n'interrompt pas la saisie
      renderBuilder();
    }, 250);
  }

  function randomStart(entry, dur) {
    const max = Math.max(0, dur - entry.length - 0.5);
    entry.start = round1(Math.random() * max);
    entry.auto = false;
    save();
  }

  function addEntry(e, url) {
    if (draft.entries.length >= MAX_ENTRIES) return 'max';
    if (draft.entries.some((x) => x.id === e.id)) return 'dup';
    const entry = {
      id: e.id, title: e.title || '', number: e.number || 0, songTitle: e.songTitle || '',
      artists: e.artists || [], start: 0, length: draft.defLength, auto: true
    };
    if (url) entry._url = url;
    draft.entries.push(entry);
    save();
    renderSoon();
    // le point de départ est tiré au hasard tant que tu ne l'as pas choisi toi-même
    enqueue(() => ensureMedia(entry)).then((m) => {
      if (entry.auto && m.dur) { randomStart(entry, m.dur); renderSoon(); }
    }).catch(() => {});
    return 'ok';
  }

  api.add = (e) => addEntry(e);
  api.count = () => draft.entries.length;

  let rowBusy = false;
  async function addRandom(n) {
    if (rowBusy) return;
    rowBusy = true;
    const btn = $('ch-rand');
    btn.disabled = true;
    const msg = $('ch-msg');
    let added = 0;
    try {
      for (let i = 0; i < n && draft.entries.length < MAX_ENTRIES; i++) {
        msg.textContent = 'Ajout au hasard : ' + (i + 1) + ' / ' + n + '…';
        let info = null;
        for (let t = 0; t < 8 && !info; t++) {
          try {
            const r = await OQ.randomOpening({ levels: OQ.getLevels(), genres: OQ.getGenres() });
            if (r && !draft.entries.some((x) => x.id === r.themeId || x.title === r.anime.title)) info = r;
          } catch (err) { /* on réessaie */ }
        }
        if (!info) continue;
        addEntry({ id: info.themeId, title: info.anime.title, number: info.number, songTitle: info.songTitle, artists: info.artists }, info.url);
        added++;
      }
      msg.textContent = added ? added + ' opening' + (added > 1 ? 's' : '') + ' ajouté' + (added > 1 ? 's' : '') + '.' : 'Impossible d\'ajouter des openings (connexion ?).';
    } finally {
      rowBusy = false;
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------
   * Constructeur : affichage
   * ------------------------------------------------------------------ */
  function renderBuilder() {
    $('ch-title').value = draft.title;
    $('ch-number').checked = draft.guessNumber;
    $('ch-hints').checked = draft.hints;
    $('ch-deflen').value = String(draft.defLength);

    const ul = $('ch-list');
    ul.textContent = '';
    const n = draft.entries.length;
    $('ch-count').textContent = n
      ? n + ' opening' + (n > 1 ? 's' : '') + ' dans le défi'
      : 'Aucun opening pour l\'instant. Ajoute-en avec le bouton ⚔ (Bibliothèque, Listes) ou au hasard.';
    ['ch-copy-link', 'ch-copy-code', 'ch-copy-list', 'ch-clear'].forEach((id) => { $(id).disabled = !n; });

    draft.entries.forEach((e, i) => ul.appendChild(buildRow(e, i)));
  }

  function numberInput(value, min, max) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = '0.1';
    inp.inputMode = 'decimal';
    inp.value = String(value);
    return inp;
  }

  function buildRow(entry, i) {
    const li = el('li', 'ch-row');

    const top = el('div', 'ch-top');
    top.appendChild(el('span', 'lib-num', (i + 1) + '.'));
    const info = el('div', 'lib-song');
    info.appendChild(el('b', '', (entry.title || '…') + (entry.number ? ' · opening ' + entry.number : '')));
    const meta = [entry.songTitle, (entry.artists || []).join(', ')].filter(Boolean).join(' · ');
    if (meta) info.appendChild(el('small', '', meta));
    top.appendChild(info);

    const play = el('button', 'btn secondary mini', '▶');
    play.type = 'button';
    play.title = 'Écouter l\'extrait tel que ton ami l\'entendra';
    play.addEventListener('click', () => testEntry(play, entry));
    top.appendChild(play);

    const dice = el('button', 'btn secondary mini', '🎲');
    dice.type = 'button';
    dice.title = 'Nouveau point de départ au hasard';
    dice.addEventListener('click', async () => {
      dice.textContent = '…';
      try {
        const m = await enqueue(() => ensureMedia(entry));
        if (m.dur) { randomStart(entry, m.dur); renderBuilder(); } else { dice.textContent = '🎲'; }
      } catch (err) { dice.textContent = '✕'; }
    });
    top.appendChild(dice);

    const up = el('button', 'btn secondary mini', '↑');
    up.type = 'button';
    up.title = 'Monter';
    up.disabled = i === 0;
    up.addEventListener('click', () => move(i, -1));
    top.appendChild(up);

    const down = el('button', 'btn secondary mini', '↓');
    down.type = 'button';
    down.title = 'Descendre';
    down.disabled = i === draft.entries.length - 1;
    down.addEventListener('click', () => move(i, 1));
    top.appendChild(down);

    const rm = el('button', 'btn secondary mini', '✕');
    rm.type = 'button';
    rm.title = 'Retirer du défi';
    rm.addEventListener('click', () => { stopTest(); draft.entries.splice(i, 1); save(); renderBuilder(); });
    top.appendChild(rm);
    li.appendChild(top);

    // Début, durée et curseur
    const ctrl = el('div', 'ch-ctrl');
    const lblS = el('label', 'ch-lbl', 'Début');
    const inS = numberInput(entry.start, 0, 3600);
    lblS.appendChild(inS);
    lblS.appendChild(el('span', '', 's'));
    const lblL = el('label', 'ch-lbl', 'Durée');
    const inL = numberInput(entry.length, 0.1, 20);
    lblL.appendChild(inL);
    lblL.appendChild(el('span', '', 's'));
    ctrl.appendChild(lblS);
    ctrl.appendChild(lblL);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ch-seek';
    slider.step = '0.1';
    slider.setAttribute('aria-label', 'Point de départ dans l\'opening');
    const setSlider = () => {
      const dur = entry._dur || 0;
      slider.classList.toggle('hidden', !dur);
      if (!dur) return;
      const max = Math.max(0.1, dur - entry.length);
      slider.min = '0';
      slider.max = String(round1(max));
      slider.value = String(Math.min(entry.start, max));
      slider.style.setProperty('--p', (Math.min(entry.start, max) / max) * 100 + '%');
    };
    setSlider();
    ctrl.appendChild(slider);
    li.appendChild(ctrl);

    // Choisir le moment exact sur la vidéo
    const vidBtn = el('button', 'btn secondary mini', '🎬');
    vidBtn.type = 'button';
    vidBtn.title = 'Choisir le moment exact sur la vidéo';
    top.insertBefore(vidBtn, rm);
    let vbox = null;
    vidBtn.addEventListener('click', async () => {
      if (vbox) { vbox.querySelector('video').pause(); vbox.remove(); vbox = null; vidBtn.textContent = '🎬'; return; }
      stopTest();
      OQ.pauseGame();
      document.dispatchEvent(new CustomEvent('oq:gameaudio'));
      vidBtn.textContent = '…';
      try {
        const cand = OQ.candidateFromTheme(await OQ.fetchTheme(entry.id));
        const vurl = cand && cand.videoUrl;
        if (!vurl) throw new Error('pas de vidéo');
        vbox = el('div', 'ch-vid');
        const v = document.createElement('video');
        v.controls = true; v.playsInline = true; v.preload = 'auto'; OQ.bindVideoVolume(v); v.src = vurl;
        v.addEventListener('loadedmetadata', () => { try { v.currentTime = entry.start; } catch (e) { /* ignoré */ } });
        vbox.appendChild(v);
        const bar = el('div', 'ch-vid-bar');
        const mk = (txt, title, fn) => { const b = el('button', 'btn secondary mini', txt); b.type = 'button'; b.title = title; b.addEventListener('click', fn); bar.appendChild(b); return b; };
        const setStart = (t) => {
          entry.start = clamp(round1(t), 0, 3600);
          entry.auto = false;
          inS.value = String(entry.start);
          setSlider();
          save();
        };
        let stopT = 0;
        mk('−0,1 s', 'Reculer d\'un dixième', () => { v.pause(); v.currentTime = Math.max(0, v.currentTime - 0.1); });
        mk('+0,1 s', 'Avancer d\'un dixième', () => { v.pause(); v.currentTime = v.currentTime + 0.1; });
        mk('📍 Début ici', 'Utiliser la position actuelle de la vidéo comme début', () => setStart(v.currentTime));
        mk('▶ Mon extrait', 'Voir l\'extrait choisi', () => {
          clearInterval(stopT);
          v.currentTime = entry.start;
          v.play().catch(() => {});
          const end = entry.start + entry.length;
          stopT = setInterval(() => { if (v.currentTime >= end || v.ended || !v.isConnected) { v.pause(); clearInterval(stopT); } }, 40);
        });
        vbox.appendChild(bar);
        v.addEventListener('play', () => { OQ.pauseGame(); document.dispatchEvent(new CustomEvent('oq:gameaudio-video')); });
        li.appendChild(vbox);
        vidBtn.textContent = '✕';
      } catch (err) {
        vidBtn.textContent = '🚫';
        vidBtn.title = 'Pas de vidéo disponible';
      }
    });

    if (!entry._dur) {
      // on charge la durée en arrière-plan pour pouvoir afficher le curseur
      enqueue(() => ensureMedia(entry)).then(() => { if (slider.isConnected) setSlider(); }).catch(() => {});
    }

    inS.addEventListener('change', () => {
      const v = num(inS.value);
      entry.start = clamp(round1(Number.isFinite(v) ? v : 0), 0, 3600);
      entry.auto = false;
      inS.value = String(entry.start);
      setSlider();
      save();
    });
    inL.addEventListener('change', () => {
      const v = num(inL.value);
      entry.length = clamp(round1(Number.isFinite(v) ? v : 5), 0.1, 20);
      inL.value = String(entry.length);
      setSlider();
      save();
    });
    slider.addEventListener('input', () => {
      entry.start = round1(Number(slider.value));
      entry.auto = false;
      inS.value = String(entry.start);
      slider.style.setProperty('--p', (Number(slider.value) / Math.max(0.1, Number(slider.max))) * 100 + '%');
      save();
    });
    return li;
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.entries.length) return;
    const t = draft.entries[i];
    draft.entries[i] = draft.entries[j];
    draft.entries[j] = t;
    save();
    renderBuilder();
  }

  /* ------------------------------------------------------------------
   * Code / lien
   * ------------------------------------------------------------------ */
  const toB64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));

  function encodeDraft() {
    return toB64(JSON.stringify({
      v: 1,
      t: draft.title,
      n: draft.guessNumber ? 1 : 0,
      h: draft.hints ? 1 : 0,
      e: draft.entries.map((e) => [e.id, Math.round(e.start * 10), Math.round(e.length * 10)])
    }));
  }

  // Lit un code (ou un lien complet) ; renvoie null s'il est invalide
  function decode(text) {
    let code = String(text || '').trim();
    const m = /[?&]defi=([A-Za-z0-9_-]+)/.exec(code);
    if (m) code = m[1];
    if (!/^[A-Za-z0-9_-]{8,}$/.test(code)) return null;
    try {
      const o = JSON.parse(fromB64(code));
      if (!o || o.v !== 1 || !Array.isArray(o.e) || !o.e.length) return null;
      const e = o.e.slice(0, MAX_ENTRIES).map((x) => [Number(x[0]), clamp(Number(x[1]) || 0, 0, 36000), clamp(Number(x[2]) || 50, 1, 200)])
        .filter((x) => Number.isFinite(x[0]) && x[0] > 0);
      if (!e.length) return null;
      return { title: String(o.t || '').slice(0, 40), n: o.n !== 0, h: o.h === 1, e };
    } catch (err) { return null; }
  }

  const baseUrl = () => location.origin + location.pathname;
  const shareLink = () => baseUrl() + '?defi=' + encodeDraft();

  function textList() {
    const head = 'Défi' + (draft.title ? ' « ' + draft.title + ' »' : '') + ' : ' + draft.entries.length + ' opening' + (draft.entries.length > 1 ? 's' : '');
    const lines = draft.entries.map((e, i) =>
      (i + 1) + '. ' + (e.title || '?') + (e.number ? ' — opening ' + e.number : '') + (e.songTitle ? ' (' + e.songTitle + ')' : '')
      + ' · début ' + fmt(e.start) + ' s · ' + fmt(e.length) + ' s');
    return [head, ...lines].join('\n');
  }

  async function copy(text, btn, label) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (err) { /* repli ci-dessous */ }
    if (!ok) { window.prompt('Copie ce texte :', text); return; }
    const old = label || btn.textContent;
    btn.textContent = 'Copié ✓';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }

  async function importCode(text) {
    const def = decode(text);
    const msg = $('ch-msg');
    if (!def) { msg.textContent = 'Code ou lien de défi invalide.'; return; }
    if (draft.entries.length && !window.confirm('Remplacer le défi en cours de création (' + draft.entries.length + ' opening(s)) ?')) return;
    stopTest();
    draft.title = def.title;
    draft.guessNumber = def.n;
    draft.hints = def.h;
    draft.entries = def.e.map((x) => ({
      id: x[0], title: '', number: 0, songTitle: '', artists: [], start: round1(x[1] / 10), length: round1(x[2] / 10), auto: false
    }));
    save();
    renderBuilder();
    msg.textContent = 'Défi importé : récupération des titres…';
    let done = 0;
    for (const e of draft.entries.slice()) {
      try {
        const info = await enqueue(() => OQ.infoForThemeId(e.id));
        if (info) {
          e.title = info.anime.title;
          e.number = info.number;
          e.songTitle = info.songTitle;
          e.artists = info.artists;
          e._url = info.url;
        }
      } catch (err) { /* on garde l'entrée telle quelle */ }
      if (++done % 3 === 0) { save(); renderSoon(); }
    }
    save();
    renderBuilder();
    msg.textContent = 'Défi importé.';
  }

  /* ------------------------------------------------------------------
   * Jouer un défi
   * ------------------------------------------------------------------ */
  let pending = null;          // défi reçu par lien, pas encore démarré
  let C = null;                // partie en cours

  function setView() {
    const final = !!(C && C.active && C.phase === 'final');
    $('ch-final').classList.toggle('hidden', !final);
    $('ch-play').classList.toggle('hidden', final || !pending || !!(C && C.active));
    $('ch-build').classList.toggle('hidden', final || (!!pending && !C));
    $('ch-back-build').classList.toggle('hidden', !pending || final);
  }

  function showPending() {
    if (!pending) return;
    $('ch-play-title').textContent = pending.title ? 'Défi « ' + pending.title + ' »' : 'Un défi t\'attend !';
    const n = pending.e.length;
    const secs = pending.e.map((x) => x[2] / 10);
    const same = secs.every((s) => s === secs[0]);
    $('ch-play-info').textContent = n + ' opening' + (n > 1 ? 's' : '') + ' à deviner · '
      + (same ? 'extraits de ' + fmt(secs[0]) + ' s' : 'extraits de ' + fmt(Math.min(...secs)) + ' à ' + fmt(Math.max(...secs)) + ' s')
      + ' · ' + (pending.n ? 'anime + numéro' : 'anime seulement')
      + ' · indices ' + (pending.h ? 'autorisés' : 'désactivés');
  }

  function multiBusy() { return OQ.mp.active || (OQ.multiBusy && OQ.multiBusy()); }

  function renderBar(text) {
    const bar = $('mp-bar');
    bar.classList.remove('hidden');
    $('mp-force').classList.add('hidden');
    if (text) { $('mp-bar-text').textContent = text; return; }
    const n = C.def.e.length;
    $('mp-bar-text').textContent = 'Défi' + (C.def.title ? ' « ' + C.def.title + ' »' : '')
      + ' · Opening ' + Math.min(C.i + 1, n) + '/' + n + ' · ' + C.pts + ' pt' + (C.pts > 1 ? 's' : '');
  }

  function startChallenge(def) {
    if (multiBusy()) { $('ch-play-msg').textContent = 'Quitte d\'abord la room multijoueur en cours.'; return; }
    if (C && C.active) quit();
    stopTest();
    C = { active: true, def, i: 0, results: [], pts: 0, phase: 'play' };
    api.active = true;
    OQ.enterMulti({ hints: def.h, guessNumber: def.n, length: def.e[0][2] / 10 });
    OQ.mp.onAnswer = onAnswer;
    OQ.mp.onNext = onNext;
    OQ.mp.onPrefetched = null;
    $('ch-play-msg').textContent = '';
    OQ.panel.close();
    renderBar('Chargement…');
    runRound();
  }

  async function runRound() {
    const idx = C.i;
    const e = C.def.e[idx];
    renderBar('Chargement de l\'opening ' + (idx + 1) + '/' + C.def.e.length + '…');
    const info = await OQ.challengeRound({ id: e[0], start: e[1] / 10, length: e[2] / 10 });
    if (!C || !C.active || C.i !== idx || info === null) return;       // quitté ou remplacé entre-temps
    if (info === false) {
      C.results.push({ verdict: 'skip', pts: 0, title: '(opening indisponible)', number: 0, song: '' });
      renderBar('Opening indisponible, on passe au suivant…');
      setTimeout(() => { if (C && C.active && C.i === idx) advance(); }, 1300);
      return;
    }
    renderBar();
  }

  function onAnswer(verdict, hints) {
    if (!C || !C.active) return;
    const pts = verdict === 'correct' ? POINTS[Math.min(2, hints || 0)] : 0;
    C.pts += pts;
    const r = OQ.getRound();
    C.results.push({
      verdict, hints: hints || 0, pts,
      title: r ? r.anime.title : '?', number: r ? r.number : 0, song: r ? r.songTitle : ''
    });
    OQ.showResult();

    const last = C.i >= C.def.e.length - 1;
    OQ.nextBtn.classList.remove('hidden');
    OQ.nextBtn.textContent = last ? 'Voir mon score ➜' : 'Opening suivant ➜';
    const msg = $('mp-next-msg');
    msg.textContent = (pts ? '+' + pts + ' pt' + (pts > 1 ? 's' : '') + ' · ' : '') + 'Score : ' + C.pts + ' pt' + (C.pts > 1 ? 's' : '');
    msg.classList.remove('hidden');
    renderBar();
  }

  function onNext() {
    if (!C || !C.active) return;
    if (C.phase === 'final') { showFinal(); return; }
    advance();
  }

  function advance() {
    $('mp-next-msg').classList.add('hidden');
    C.i++;
    if (C.i >= C.def.e.length) { finish(); return; }
    runRound();
  }

  function finish() {
    C.phase = 'final';
    OQ.nextBtn.textContent = 'Voir mon score ➜';
    renderBar('Défi terminé · ' + C.pts + ' pt' + (C.pts > 1 ? 's' : ''));
    showFinal();
  }

  function resultText() {
    const played = C.results.filter((r) => r.verdict !== 'skip');
    const found = played.filter((r) => r.verdict === 'correct').length;
    const max = played.length * 3;
    return 'Défi' + (C.def.title ? ' « ' + C.def.title + ' »' : '') + ' : ' + C.pts + '/' + max + ' pts · ' + found + '/' + played.length + ' trouvés\n'
      + C.results.map((r) => EMOJI[r.verdict]).join('') + '\n' + baseUrl();
  }

  function showFinal() {
    OQ.panel.open('challenge');
    const played = C.results.filter((r) => r.verdict !== 'skip');
    const found = played.filter((r) => r.verdict === 'correct').length;
    $('ch-final-title').textContent = 'Défi' + (C.def.title ? ' « ' + C.def.title + ' »' : '') + ' terminé';
    $('ch-final-score').textContent = C.pts + ' / ' + (played.length * 3) + ' points · ' + found + ' opening' + (found > 1 ? 's' : '') + ' trouvé' + (found > 1 ? 's' : '') + ' sur ' + played.length;
    const ul = $('ch-final-list');
    ul.textContent = '';
    C.results.forEach((r, i) => {
      const li = el('li', 'lib-row');
      li.appendChild(el('span', 'lib-num', (i + 1) + '.'));
      const info = el('div', 'lib-song');
      info.appendChild(el('b', '', r.title + (r.number ? ' · opening ' + r.number : '')));
      if (r.song) info.appendChild(el('small', '', r.song));
      li.appendChild(info);
      const v = el('span', 'sb-verdict ' + r.verdict, VERDICT_LABEL[r.verdict]);
      li.appendChild(v);
      if (r.pts) li.appendChild(el('span', 'sb-pts', '+' + r.pts));
      ul.appendChild(li);
    });
    setView();
  }

  function quit() {
    if (!C || !C.active) return;
    C.active = false;
    api.active = false;
    C = null;
    $('mp-bar').classList.add('hidden');
    $('mp-next-msg').classList.add('hidden');
    OQ.nextBtn.textContent = 'Suivant ➜';
    OQ.exitMulti();                             // reprend le jeu normal
    pending = null;
    setView();
    if (!$('panel').classList.contains('hidden')) renderBuilder();
  }

  /* ------------------------------------------------------------------
   * Boutons et formulaire
   * ------------------------------------------------------------------ */
  $('nav-challenge').addEventListener('click', () => OQ.panel.open('challenge'));

  $('ch-title').addEventListener('input', () => { draft.title = $('ch-title').value.slice(0, 40); save(); });
  $('ch-number').addEventListener('change', () => { draft.guessNumber = $('ch-number').checked; save(); });
  $('ch-hints').addEventListener('change', () => { draft.hints = $('ch-hints').checked; save(); });
  $('ch-deflen').addEventListener('change', () => {
    const v = num($('ch-deflen').value);
    draft.defLength = clamp(round1(Number.isFinite(v) ? v : 5), 0.1, 20);
    $('ch-deflen').value = String(draft.defLength);
    save();
  });
  $('ch-apply-len').addEventListener('click', () => {
    draft.entries.forEach((e) => { e.length = draft.defLength; });
    save();
    renderBuilder();
  });
  $('ch-reroll').addEventListener('click', async () => {
    const btn = $('ch-reroll');
    btn.disabled = true;
    for (const e of draft.entries) {
      try {
        const m = await enqueue(() => ensureMedia(e));
        if (m.dur) randomStart(e, m.dur);
      } catch (err) { /* on passe */ }
    }
    btn.disabled = false;
    renderBuilder();
  });
  $('ch-rand').addEventListener('click', () => {
    const n = clamp(parseInt($('ch-rand-n').value, 10) || 5, 1, MAX_ENTRIES);
    $('ch-rand-n').value = String(n);
    addRandom(n);
  });

  $('ch-copy-link').addEventListener('click', () => copy(shareLink(), $('ch-copy-link'), 'Copier le lien'));
  $('ch-copy-code').addEventListener('click', () => copy(encodeDraft(), $('ch-copy-code'), 'Copier le code'));
  $('ch-copy-list').addEventListener('click', () => copy(textList(), $('ch-copy-list'), 'Copier la liste'));
  $('ch-clear').addEventListener('click', () => {
    if (!draft.entries.length || !window.confirm('Vider le défi en cours de création ?')) return;
    stopTest();
    draft.entries = [];
    save();
    renderBuilder();
  });
  $('ch-import-btn').addEventListener('click', () => { importCode($('ch-import').value); $('ch-import').value = ''; });
  $('ch-import').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('ch-import-btn').click(); } });

  $('ch-start').addEventListener('click', () => { if (pending) startChallenge(pending); });
  $('ch-back-build').addEventListener('click', () => { pending = null; setView(); renderBuilder(); });
  $('ch-copy-result').addEventListener('click', () => { if (C) copy(resultText(), $('ch-copy-result'), 'Copier mon résultat'); });
  $('ch-quit').addEventListener('click', () => quit());
  $('mp-bar-leave').addEventListener('click', () => { if (C && C.active) quit(); });

  document.addEventListener('oq:tab', (e) => {
    if (e.detail !== 'challenge') return;
    setView();
    if (C && C.phase === 'final') return;
    renderBuilder();
  });


  /* ------------------------------------------------------------------
   * Recherche d'openings directement dans l'onglet Défis
   * ------------------------------------------------------------------ */
  let qSeq = 0;
  async function chSearch() {
    const q = $('ch-q').value.trim();
    const info = $('ch-q-info');
    const res = $('ch-q-res');
    if (q.length < 2) { info.textContent = 'Tape au moins 2 lettres.'; return; }
    const seq = ++qSeq;
    res.textContent = '';
    info.textContent = 'Recherche…';
    try {
      let r = await OQ.fetchVariants('lib', '/anime', { q, 'filter[has]': 'animethemes', 'page[size]': 20 });
      if (r && (r.status === 400 || r.status === 422)) r = await OQ.fetchVariants('lib', '/anime', { q, 'page[size]': 20 });
      if (seq !== qSeq) return;
      if (!r || !r.ok) throw new Error('HTTP');
      const entries = ((await r.json()).anime || []).map(OQ.entryInfo);
      OQ.indexEntries(entries);
      const groups = new Map();
      entries.forEach((e) => {
        const k = OQ.keyOf(e.name);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
      });
      let n = 0;
      groups.forEach((members) => {
        const sorted = members.slice().sort((a, b) => a.year - b.year);
        const anchor = sorted.find((m) => !OQ.BAD_FORMATS.has(m.format)) || sorted[0];
        const f = OQ.findCurated(anchor);
        const title = f ? f.title : OQ.cleanTitle(anchor.english || anchor.name);
        const rows = OQ.buildRows(members, anchor.slug, f, title);
        if (!rows.length) return;
        const d = el('details', 'lib-item');
        if (n < 2) d.open = true;
        const sm = el('summary');
        sm.appendChild(el('span', 'lib-title', title));
        sm.appendChild(el('span', 'lib-count', rows.length + ' opening' + (rows.length > 1 ? 's' : '')));
        d.appendChild(sm);
        const ul = el('ul', 'lib-rows');
        rows.forEach((row) => {
          const li = el('li', 'lib-row');
          li.appendChild(el('span', 'lib-num', '#' + row.number));
          const inf = el('div', 'lib-song');
          inf.appendChild(el('b', '', row.songTitle || 'Titre inconnu'));
          if (row.artists.length) inf.appendChild(el('small', '', row.artists.join(', ')));
          li.appendChild(inf);
          const add = el('button', 'btn secondary mini', '＋ Ajouter');
          add.type = 'button';
          add.addEventListener('click', () => {
            const rr = addEntry({ id: row.themeId, title: row.title, number: row.number, songTitle: row.songTitle, artists: row.artists });
            add.textContent = rr === 'max' ? 'Plein' : '✓ Ajouté';
            add.disabled = true;
          });
          li.appendChild(add);
          ul.appendChild(li);
        });
        d.appendChild(ul);
        res.appendChild(d);
        n++;
      });
      info.textContent = n ? n + ' anime' + (n > 1 ? 's' : '') + ' trouvé' + (n > 1 ? 's' : '') : 'Aucun résultat.';
    } catch (err) {
      if (seq === qSeq) info.textContent = 'Recherche impossible pour le moment (connexion ?).';
    }
  }
  $('ch-q-go').addEventListener('click', chSearch);
  $('ch-q').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') chSearch(); });

  /* ------------------------------------------------------------------
   * Boutons ⚔ (Bibliothèque et Listes) : ajout au défi en cours de création
   * ------------------------------------------------------------------ */
  api.button = (entry) => {
    const b = el('button', 'btn secondary mini', '⚔');
    b.type = 'button';
    b.title = 'Ajouter au défi';
    b.addEventListener('click', () => {
      const r = addEntry(entry);
      b.textContent = r === 'ok' ? '✓' : (r === 'dup' ? '✓' : '✕');
      b.title = r === 'max' ? 'Le défi est plein (100 openings)' : (r === 'dup' ? 'Déjà dans le défi' : 'Ajouté au défi');
      setTimeout(() => { b.textContent = '⚔'; b.title = 'Ajouter au défi'; }, 1500);
    });
    return b;
  };

  /* ------------------------------------------------------------------
   * Démarrage : lien ?defi=CODE ou rien
   * ------------------------------------------------------------------ */
  updateNav();
  try {
    const code = new URLSearchParams(location.search).get('defi');
    if (code) {
      const def = decode('?defi=' + code);
      if (def) {
        pending = def;
        showPending();
        setView();
        OQ.panel.open('challenge');
      }
    }
  } catch (err) { /* ignoré */ }
  setView();
})();
