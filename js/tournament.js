/*
 * TOURNOI D'OPENINGS (tournament.html)
 * ------------------------------------
 * 16 openings au hasard (un par anime de js/animes.js, OP seulement) sont cachés puis opposés deux par deux.
 * À chaque duel on écoute A et B et on choisit son préféré ; le vainqueur passe au tour suivant jusqu'à la finale.
 * Les titres ne sont révélés qu'à la fin. Page indépendante : elle ne charge pas js/app.js.
 */
(() => {
  'use strict';

  const API = 'https://api.animethemes.moe';
  const SIZE = 16;
  const LEVELS = ['easy', 'medium', 'hard'];
  const BAD_GROUP = /dub|english|latin|german|french|spanish|korean|chinese|italian|portuguese|russian|arabic|hindi|tagalog/i;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  /* ---------- Liste des animes (animes.js + réglages de l'administrateur) ---------- */
  const OV = (window.OVERRIDES && typeof window.OVERRIDES === 'object') ? window.OVERRIDES : {};
  const OV_ANIMES = OV.animes && typeof OV.animes === 'object' ? OV.animes : {};
  const OV_EXCLUDED = new Set((Array.isArray(OV.excluded) ? OV.excluded : []).map(Number));
  const OV_EXCLUDED_ANIMES = new Set(Array.isArray(OV.excludedAnimes) ? OV.excludedAnimes : []);
  const ovRemoved = new Set(Array.isArray(OV.removed) ? OV.removed : []);
  const POOL = (typeof ANIMES !== 'undefined' ? ANIMES : []).map((f) => ({ title: f.title, slug: f.slug, tier: f.tier }));
  (Array.isArray(OV.added) ? OV.added : []).forEach((a) => {
    if (a && a.slug && !POOL.some((x) => x.slug === a.slug)) POOL.push({ title: a.title || a.slug, slug: a.slug, tier: LEVELS.includes(a.tier) ? a.tier : 'hard' });
  });
  POOL.forEach((f) => { const o = OV_ANIMES[f.slug]; if (o && LEVELS.includes(o.tier)) f.tier = o.tier; });
  const usablePool = () => POOL.filter((f) => !ovRemoved.has(f.slug) && !OV_EXCLUDED_ANIMES.has(f.slug) && levels.has(f.tier));

  /* ---------- Difficultés ---------- */
  const levels = new Set(LEVELS);
  LEVELS.forEach((l) => {
    const b = $('tn-' + l);
    b.addEventListener('click', () => {
      if (levels.has(l)) { if (levels.size === 1) return; levels.delete(l); } else levels.add(l);
      b.classList.toggle('active', levels.has(l));
      b.setAttribute('aria-pressed', String(levels.has(l)));
    });
  });

  /* ---------- Affichage ---------- */
  const views = ['tn-start', 'tn-load', 'tn-match', 'tn-end'];
  function show(id) { views.forEach((v) => $(v).classList.toggle('hidden', v !== id)); window.scrollTo(0, 0); }

  /* ---------- Chargement des openings ---------- */
  let runId = 0;
  let items = [];          // les 16 openings : { anime, song, artists, num, url, audio }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function fetchAnime(slug) {
    const incs = ['animethemes.animethemeentries.videos.audio,animethemes.song.artists', 'animethemes.animethemeentries.videos.audio,animethemes.song'];
    for (const inc of incs) {
      const res = await fetch(`${API}/anime/${encodeURIComponent(slug)}?include=${encodeURIComponent(inc)}`);
      if (res.status === 429) { lastFail = 'API 429'; await sleep(1500); throw new Error('429'); }
      if (res.status === 400 || res.status === 422) continue;
      if (!res.ok) { lastFail = 'API ' + res.status; throw new Error('HTTP ' + res.status); }
      const data = await res.json();
      return data.anime || null;
    }
    return null;
  }

  function pickTheme(anime) {
    const ok = [];
    (anime.animethemes || []).forEach((t) => {
      if (t.type !== 'OP' || OV_EXCLUDED.has(Number(t.id)) || (t.group && BAD_GROUP.test(t.group))) return;
      let video = null, audio = null;
      // versions non NSFW d'abord ; on préfère la vidéo sans crédits (moins de spoil)
      const entries = (t.animethemeentries || []).slice().sort((a, b) => (a.nsfw ? 1 : 0) - (b.nsfw ? 1 : 0));
      entries.forEach((e) => (e.videos || []).forEach((v) => {
        if (v.link && (!video || (v.nc && !video.nc))) video = v;
        if (!audio && v.audio && v.audio.link) audio = v.audio.link;
      }));
      const url = video ? video.link : audio;
      if (url) ok.push({ t, url, audioUrl: audio });
    });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  // Un élément <video> sert de lecteur (il joue aussi les fichiers audio seuls)
  let lastFail = '';
  function loadAudio(url) {
    return new Promise((resolve) => {
      const a = document.createElement('video');
      a.preload = 'metadata';
      a.playsInline = true;
      a.volume = 0.5;
      let done = false;
      const end = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v ? a : null); };
      const timer = setTimeout(() => { lastFail = 'média trop lent'; end(false); }, 15000);
      a.addEventListener('loadedmetadata', () => end(true));
      a.addEventListener('error', () => { lastFail = 'média code ' + (a.error ? a.error.code : '?'); end(false); });
      a.addEventListener('click', () => { if (a.paused) a.play().catch(() => {}); else a.pause(); });
      a.src = url;
      a.load();
    });
  }

  async function prepare(id) {
    lastFail = '';
    const order = shuffle(usablePool());
    if (order.length < SIZE) throw new Error('pool');
    const got = [];
    let cursor = 0, fails = 0;
    const setProgress = () => {
      $('tn-load-text').textContent = 'Préparation des openings… ' + got.length + ' / ' + SIZE;
      $('tn-load-bar').style.width = Math.round(got.length / SIZE * 100) + '%';
    };
    setProgress();
    const worker = async () => {
      while (got.length < SIZE && id === runId) {
        if (cursor >= order.length || fails > 40) return;
        const f = order[cursor++];
        try {
          const anime = await fetchAnime(f.slug);
          if (id !== runId) return;
          const c = anime ? pickTheme(anime) : null;
          if (!c) continue;
          let audio = await loadAudio(c.url);
          if (!audio && c.audioUrl && c.audioUrl !== c.url) audio = await loadAudio(c.audioUrl);   // repli : son seul
          if (id !== runId) return;
          if (!audio) { fails++; continue; }
          if (got.length >= SIZE) return;
          const song = c.t.song || null;
          const artists = song && Array.isArray(song.artists) ? song.artists.map((a) => a.name).filter(Boolean) : [];
          const m = /(\d+)/.exec(c.t.slug || '');
          const d = audio.duration;
          if (Number.isFinite(d) && d > 20) audio.currentTime = Math.random() * Math.max(0, d - 20);   // départ au hasard
          got.push({ anime: f.title, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, url: c.url, audio });
          setProgress();
        } catch (e) { fails++; if (!lastFail) lastFail = 'API injoignable'; await sleep(400); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (id !== runId) return null;
    if (got.length < SIZE) throw new Error('incomplet');
    return shuffle(got);
  }

  /* ---------- Tournoi ---------- */
  const ROUND_NAMES = { 8: 'Huitièmes de finale', 4: 'Quarts de finale', 2: 'Demi-finales', 1: 'Finale' };
  let current = [];        // openings encore en lice
  let next = [];           // vainqueurs du tour en cours
  let pairIdx = 0;
  let history = [];        // { round, a, b, win }
  let pair = null;

  function stopAll() { items.forEach((it) => it.audio.pause()); }

  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  const sides = [0, 1].map((i) => {
    const card = $(i ? 'tn-card-b' : 'tn-card-a');
    return { card, play: card.querySelector('.tn-play'), seek: card.querySelector('.tn-seek'), time: card.querySelector('.tn-time'), audio: null };
  });

  function refreshSide(s) {
    const a = s.audio;
    if (!a) return;
    const d = a.duration || 0;
    if (document.activeElement !== s.seek) s.seek.value = d ? Math.round(a.currentTime / d * 1000) : 0;
    s.time.textContent = fmt(a.currentTime) + ' / ' + fmt(d);
    s.play.textContent = a.paused ? '▶ Écouter' : '⏸ Pause';
  }

  sides.forEach((s, i) => {
    s.play.addEventListener('click', () => {
      if (!s.audio) return;
      if (s.audio.paused) { sides[1 - i].audio && sides[1 - i].audio.pause(); s.audio.play().catch(() => {}); } else s.audio.pause();
      refreshSide(s); refreshSide(sides[1 - i]);
    });
    s.seek.addEventListener('input', () => {
      if (s.audio && s.audio.duration) { s.audio.currentTime = s.seek.value / 1000 * s.audio.duration; refreshSide(s); }
    });
    s.card.querySelector('.tn-pick').addEventListener('click', () => choose(i));
  });

  setInterval(() => { if (!$('tn-match').classList.contains('hidden')) sides.forEach(refreshSide); }, 250);

  function showPair() {
    stopAll();
    pair = [current[pairIdx * 2], current[pairIdx * 2 + 1]];
    $('tn-round').textContent = ROUND_NAMES[current.length / 2] || 'Duel';
    $('tn-count').textContent = 'Duel ' + (pairIdx + 1) + ' / ' + (current.length / 2);
    sides.forEach((s, i) => {
      s.audio = pair[i].audio;
      s.audio.preload = 'auto';
      const box = s.card.querySelector('.tn-vid');
      box.textContent = '';
      box.appendChild(s.audio);
      refreshSide(s);
    });
    show('tn-match');
  }

  function choose(i) {
    stopAll();
    history.push({ round: ROUND_NAMES[current.length / 2] || 'Duel', a: pair[0], b: pair[1], win: i });
    next.push(pair[i]);
    pairIdx++;
    if (pairIdx * 2 >= current.length) {
      if (next.length === 1) { finish(next[0]); return; }
      current = next; next = []; pairIdx = 0;
    }
    showPair();
  }

  /* ---------- Fin : révélation ---------- */
  function line(parent, it, win) {
    const d = document.createElement('div');
    d.className = 'tn-it' + (win ? ' win' : '');
    const b = document.createElement('b'); b.textContent = it.anime;
    const op = document.createElement('span'); op.textContent = 'opening ' + it.num;
    d.append(win ? '✓ ' : '', b, ' · ', op);
    if (it.song) { const sm = document.createElement('small'); sm.textContent = ' — ' + it.song + (it.artists.length ? ' · ' + it.artists.join(', ') : ''); d.appendChild(sm); }
    parent.appendChild(d);
  }

  function finish(champ) {
    $('tn-champ-title').textContent = champ.anime + ' · opening ' + champ.num;
    $('tn-champ-song').textContent = champ.song ? champ.song + (champ.artists.length ? ' — ' + champ.artists.join(', ') : '') : '';
    const cbox = $('tn-champ-vid');
    cbox.textContent = '';
    cbox.appendChild(champ.audio);
    const cp = $('tn-champ-play');
    cp.onclick = () => { if (champ.audio.paused) champ.audio.play().catch(() => {}); else champ.audio.pause(); cp.textContent = champ.audio.paused ? '▶ Écouter' : '⏸ Pause'; };
    cp.textContent = '▶ Écouter';
    champ.audio.onended = () => { cp.textContent = '▶ Écouter'; };
    const recap = $('tn-recap');
    recap.textContent = '';
    let last = '';
    history.forEach((h) => {
      if (h.round !== last) { const t = document.createElement('h4'); t.className = 'tn-rt'; t.textContent = h.round; recap.appendChild(t); last = h.round; }
      const row = document.createElement('div');
      row.className = 'tn-duel-row';
      line(row, h.a, h.win === 0);
      line(row, h.b, h.win === 1);
      recap.appendChild(row);
    });
    show('tn-end');
  }

  /* ---------- Lancement ---------- */
  async function start() {
    const id = ++runId;
    stopAll();
    $('tn-start-msg').textContent = '';
    show('tn-load');
    try {
      const got = await prepare(id);
      if (!got) return;
      items = got;
      current = got.slice(); next = []; pairIdx = 0; history = [];
      showPair();
    } catch (e) {
      if (id !== runId) return;
      show('tn-start');
      $('tn-start-msg').textContent = e.message === 'pool'
        ? 'Pas assez d\'animes avec ces difficultés : coches-en d\'autres.'
        : 'Impossible de préparer 16 openings (connexion ?). Réessaie dans un instant.' + (lastFail ? ' [' + lastFail + ']' : '');
    }
  }

  function quit() { runId++; stopAll(); items.forEach((it) => { it.audio.onended = null; }); show('tn-start'); }

  $('tn-go').addEventListener('click', start);
  $('tn-again').addEventListener('click', () => { items.forEach((it) => it.audio.pause()); start(); });
  $('tn-cancel').addEventListener('click', quit);
  $('tn-quit').addEventListener('click', () => { if (confirm('Abandonner ce tournoi ?')) quit(); });
})();
