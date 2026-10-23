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
  const views = ['tn-start', 'tn-load', 'tn-match', 'tn-between', 'tn-end'];
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
      const vids = [];
      let audio = null;
      // Toutes les versions vidéo, de la plus « propre » à la moins : non NSFW d'abord, sans crédits d'abord
      // (les versions NSFW sont gardées en dernier recours, comme sur le site de base)
      (t.animethemeentries || []).forEach((e) => (e.videos || []).forEach((v) => {
        if (v.link) vids.push({ url: v.link, rank: (e.nsfw ? 2 : 0) + (v.nc ? 0 : 1) });
        if (!audio && v.audio && v.audio.link) audio = v.audio.link;
      }));
      vids.sort((x, y) => x.rank - y.rank);
      const urls = vids.map((v) => v.url).filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 4);
      if (audio) urls.push(audio);                       // dernier recours : le son seul
      if (urls.length) ok.push({ t, urls, audioUrl: audio, hasVideo: vids.length > 0 });
    });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  // Un élément <video> sert de lecteur (il joue aussi les fichiers audio seuls)
  let lastFail = '';
  function loadAudio(url) {
    return new Promise((resolve) => {
      const a = document.createElement('video');
      a.preload = 'metadata';
      a.controls = true;
      a.playsInline = true;
      a.volume = 0.5;
      let done = false;
      const end = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v ? a : null); };
      const timer = setTimeout(() => { lastFail = 'média trop lent'; end(false); }, 12000);
      a.addEventListener('loadedmetadata', () => end(true));
      a.addEventListener('error', () => { lastFail = 'média code ' + (a.error ? a.error.code : '?'); end(false); });
      a.addEventListener('play', () => { items.forEach((it) => { if (it.audio !== a) it.audio.pause(); }); });   // un seul à la fois
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
          let audio = null, usedUrl = '';
          for (const u of c.urls) { audio = await loadAudio(u); usedUrl = u; if (audio || id !== runId) break; }
          // Son seul (pas de vidéo, ou elle ne charge pas) : on préfère un autre anime, sauf si on en manque
          if (audio && usedUrl === c.audioUrl && cursor < order.length - 25) { audio = null; continue; }
          if (id !== runId) return;
          if (!audio) { fails++; continue; }
          if (got.length >= SIZE) return;
          const song = c.t.song || null;
          const artists = song && Array.isArray(song.artists) ? song.artists.map((a) => a.name).filter(Boolean) : [];
          const m = /(\d+)/.exec(c.t.slug || '');
          got.push({ anime: f.title, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, url: c.urls[0], audio });
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

  const sides = [0, 1].map((i) => {
    const card = $(i ? 'tn-card-b' : 'tn-card-a');
    card.querySelector('.tn-pick').addEventListener('click', () => choose(i));
    card.querySelector('.tn-reload').addEventListener('click', () => {
      const v = pair && pair[i] && pair[i].audio;
      if (!v) return;
      const t = v.currentTime;
      v.load();
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = t; } catch (e) { /* ignoré */ } }, { once: true });
      watch(v);
    });
    return { card };
  });

  // Une vidéo qui n'a pas fini de se charger est relancée toute seule (jusqu'à 4 fois), ou avec le bouton « Recharger »
  function watch(v) {
    let tries = 0;
    clearTimeout(v._wd);
    const check = () => {
      const stuck = !Number.isFinite(v.duration) || v.readyState < 2 || !!v.error;
      if (!stuck || tries >= 4 || $('tn-match').classList.contains('hidden')) return;
      tries++;
      const t = v.currentTime;
      v.load();
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = t; } catch (e) { /* ignoré */ } }, { once: true });
      v._wd = setTimeout(check, 7000);
    };
    v._wd = setTimeout(check, 7000);
  }

  function showPair() {
    stopAll();
    pair = [current[pairIdx * 2], current[pairIdx * 2 + 1]];
    $('tn-round').textContent = ROUND_NAMES[current.length / 2] || 'Duel';
    $('tn-count').textContent = 'Duel ' + (pairIdx + 1) + ' / ' + (current.length / 2);
    sides.forEach((s, i) => {
      s.audio = pair[i].audio;
      s.audio.preload = 'auto';
      s.audio.currentTime = 0;
      const box = s.card.querySelector('.tn-vid');
      box.textContent = '';
      box.appendChild(s.audio);
      watch(s.audio);
    });
    show('tn-match');
  }

  let afterPick = null;

  function choose(i) {
    stopAll();
    history.push({ round: ROUND_NAMES[current.length / 2] || 'Duel', a: pair[0], b: pair[1], win: i });
    next.push(pair[i]);
    // Révélation du duel qui vient d'être joué (les autres restent cachés)
    const res = $('tn-between-res');
    res.textContent = '';
    line(res, pair[i], true);
    line(res, pair[1 - i], false);
    pairIdx++;
    let label = 'Duel suivant ➜';
    if (pairIdx * 2 >= current.length) {
      if (next.length === 1) { const champ = next[0]; afterPick = () => finish(champ); label = 'Voir le résultat ➜'; }
      else { afterPick = () => { current = next; next = []; pairIdx = 0; showPair(); }; label = 'Tour suivant ➜'; }
    } else afterPick = showPair;
    $('tn-between-title').textContent = i ? '✓ Opening B gagne' : '✓ Opening A gagne';
    $('tn-between-sub').textContent = label === 'Voir le résultat ➜' ? 'C\'était la finale !' : (label === 'Tour suivant ➜' ? 'Fin du tour : les vainqueurs passent à la suite.' : 'Il passe au tour suivant.');
    $('tn-between-next').textContent = label;
    show('tn-between');
    $('tn-between-next').focus();
  }
  $('tn-between-next').addEventListener('click', () => { if (afterPick) { const f = afterPick; afterPick = null; f(); } });

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
