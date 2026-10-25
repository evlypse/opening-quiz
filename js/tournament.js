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
      if (res.status === 429) { await sleep(1500); throw new Error('429'); }
      if (res.status === 400 || res.status === 422) continue;
      if (!res.ok) throw new Error('HTTP ' + res.status);
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
        if (v.link) vids.push({ url: v.link, rank: (e.nsfw ? 2 : 0) + (v.nc ? 0 : 1), res: Number(v.resolution) || 0, size: Number(v.size) || 0 });
        if (!audio && v.audio && v.audio.link) audio = v.audio.link;
      }));
      if (vids.length || audio) ok.push({ t, vids, audioUrl: audio, hasVideo: vids.length > 0 });
    });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  // Le lecteur (un élément <video>, qui joue aussi un fichier audio seul) n'est créé qu'au moment où l'opening
  // approche : plus d'attente de 16 vidéos au départ.
  // Qualité vidéo : 720p par défaut (plus léger), 1080p au choix. Retenue d'une visite à l'autre.
  let quality = 720;
  try { if (localStorage.getItem('opening-quiz-tn-quality') === '1080') quality = 1080; } catch (e) { /* ignoré */ }

  // Liste des adresses à essayer pour un opening : versions les plus « propres » d'abord (non NSFW, sans crédits),
  // puis la résolution la plus proche de la qualité voulue ; le son seul en tout dernier recours.
  function urlsFor(item, q) {
    const best = Math.min(...item.vids.map((v) => v.rank), 99);
    const sorted = item.vids.slice().sort((x, y) => (x.rank === best ? 0 : 1) - (y.rank === best ? 0 : 1)
      || (x.rank - y.rank) || Math.abs((x.res || q) - q) - Math.abs((y.res || q) - q));
    const urls = sorted.map((v) => v.url).filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 5);
    if (!urls.length && item.audioUrl) urls.push(item.audioUrl);          // le son seul : uniquement s'il n'existe aucune vidéo
    return urls;
  }

  // Sécurité : aucune vidéo ne démarre toute seule, seulement juste après un geste (clic, touche, toucher)
  let lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart', 'mousedown'].forEach((ev) => document.addEventListener(ev, () => { lastGesture = Date.now(); }, true));

  // Le lecteur est un élément <video> (il joue aussi un fichier audio seul). Il lit la vidéo déjà téléchargée en
  // mémoire quand c'est possible : plus aucun délai au moment d'appuyer sur lecture.
  function makeMedia(item) {
    if (item.audio) return item.audio;
    const a = document.createElement('video');
    a.preload = 'auto';
    a.controls = true;
    a.playsInline = true;
    a.volume = 0.3;
    a.autoplay = false;
    a.addEventListener('play', () => {
      const ua = navigator.userActivation;                                            // vrai juste après un vrai geste
      if (ua && !ua.isActive && Date.now() - lastGesture > 2000) { a.pause(); return; }   // pas lancée par toi : on coupe
      items.forEach((it) => { if (it.audio && it.audio !== a) it.audio.pause(); });   // un seul à la fois
      // Si la lecture ne démarre pas vraiment (vidéo « figée » ou périmée), on relance la source sans rien te demander
      clearTimeout(a._stall);
      a._stall = setTimeout(() => {
        if (item.audio !== a || a.paused || a.readyState >= 3 && a.currentTime > 0) return;
        a._rescue();
      }, 8000);
    });
    a.addEventListener('playing', () => {
      clearTimeout(a._stall);
      if (!item.revealed) { item.revealed = true; showInfo(item); }                   // le nom n'apparaît que quand la lecture a vraiment démarré
    });
    a.addEventListener('pause', () => clearTimeout(a._stall));
    a._rescue = () => {
      if (item.audio !== a) return;
      a._rescues = (a._rescues || 0) + 1;
      const t = a.currentTime || 0;
      if (a._rescues > 3 && item.blobUrl) {                                           // le fichier en mémoire pose problème : lecture directe
        try { URL.revokeObjectURL(item.blobUrl); } catch (e) { /* ignoré */ }
        item.blobUrl = '';
      }
      if (a._rescues > 1 && !item.blobUrl) item.ui = ((item.ui || 0) + (a._rescues > 3 ? 1 : 0)) % item.urls.length;
      a.src = item.blobUrl || item.urls[item.ui || 0];
      a.load();
      const go = () => { a.removeEventListener('loadedmetadata', go); try { a.currentTime = t; } catch (e) { /* ignoré */ } lastGesture = Date.now(); const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); };
      a.addEventListener('loadedmetadata', go);
      clearTimeout(a._stall);
      if (a._rescues < 6) a._stall = setTimeout(() => { if (item.audio === a && !a.paused && !(a.readyState >= 3)) a._rescue(); }, 12000);
    };
    a.addEventListener('waiting', () => {
      clearTimeout(a._stall);
      a._stall = setTimeout(() => { if (item.audio === a && !a.paused && !(a.readyState >= 3)) a._rescue(); }, 15000);
    });
    a._item = item;
    item.audio = a;
    a.src = item.blobUrl || item.urls[item.ui || 0];
    // Surveillance : si la vidéo ne démarre pas (pas de durée connue), on essaie une autre version du fichier
    let tries = 0;
    let timer = 0;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (item.audio === a && !(a.readyState >= 1)) next(); }, tries < 2 ? 20000 : 12000);
    };
    const next = () => {
      if (item.audio !== a || a.readyState >= 1 || tries >= 6) return;
      tries++;
      if (item.blobUrl) { try { URL.revokeObjectURL(item.blobUrl); } catch (e) { /* ignoré */ } item.blobUrl = ''; }
      if (tries > 2) item.ui = ((item.ui || 0) + 1) % item.urls.length;   // 2 relances de la version d'origine avant d'en changer
      a.src = item.urls[item.ui || 0];
      a.load();
      watch();
    };
    a.addEventListener('error', () => setTimeout(next, 600));
    a.addEventListener('loadedmetadata', () => clearTimeout(timer));
    watch();
    return a;
  }

  // Libère la mémoire d'un opening (vidéo téléchargée + lecteur)
  function release(item) {
    if (item.audio) { item.audio.pause(); item.audio.removeAttribute('src'); item.audio.load(); item.audio = null; }
    if (item.blobUrl) { try { URL.revokeObjectURL(item.blobUrl); } catch (e) { /* ignoré */ } }
    item.blobUrl = '';
    item.ready = null;
    item.skip = false;
    item.pct = 0;
    item.mode = '';
  }

  // Télécharge toute la vidéo en mémoire (avec sa progression). En cas d'échec : autre version de la même vidéo,
  // puis, en dernier recours, lecture directe depuis le serveur.
  // Téléchargement complet d'une vidéo. Si la connexion se coupe ou se bloque, on REPREND là où on s'était arrêté
  // (au lieu de tout recommencer), d'abord sur la version d'origine, puis sur les autres versions.
  function ensure(item) {
    if (item.ready) return item.ready;
    item.pct = 0;
    item.ready = (async () => {
      let netErrors = 0;
      let parts = [], got = 0, total = 0, lastIdx = -1;
      for (let t = 0; t < 14 && !item.skip; t++) {
        const idx = (item.ui + Math.floor(t / 4)) % item.urls.length;   // 4 essais par version
        if (idx !== lastIdx) { parts = []; got = 0; total = 0; lastIdx = idx; }
        const ctl = new AbortController();
        item.abort = () => ctl.abort();
        let idle = 0;
        const arm = (ms) => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), ms); };
        try {
          arm(90000);                                          // un fichier « froid » peut mettre longtemps à démarrer
          let res;
          try {
            res = await fetch(item.urls[idx], { signal: ctl.signal, headers: got ? { Range: 'bytes=' + got + '-' } : {} });
          } catch (e) {
            if (got && e && e.name === 'TypeError') { parts = []; got = 0; res = await fetch(item.urls[idx], { signal: ctl.signal }); }
            else throw e;
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (got && res.status !== 206) { parts = []; got = 0; }              // le serveur ne reprend pas : on repart de zéro
          const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
          total = cr ? Number(cr[1]) : (got + (Number(res.headers.get('content-length')) || 0)) || total;
          if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            for (;;) {
              const r = await reader.read();
              if (r.done) break;
              parts.push(r.value); got += r.value.length; arm(45000);
              item.pct = Math.max(item.pct || 0, total ? Math.min(0.99, got / total) : 0.5);
            }
          } else {
            const buf = new Uint8Array(await res.arrayBuffer());
            parts.push(buf); got += buf.length;
          }
          clearTimeout(idle);
          if (total && got < total) throw new Error('incomplet');                 // fichier coupé : on reprend
          const blob = new Blob(parts, { type: 'video/webm' });
          item.blobUrl = URL.createObjectURL(blob);
          item.ui = idx;
          item.pct = 1;
          item.mode = 'blob';
          return;
        } catch (e) {
          clearTimeout(idle);
          if (item.skip) break;
          if (e && e.name === 'TypeError') { if (++netErrors >= 3) break; }       // réseau ou accès refusé
          await sleep(500);
        }
      }
      item.mode = 'stream';                                                       // dernier recours : lecture directe
      item.pct = 1;
    })();
    return item.ready;
  }

  let order = [], cursor = 0;   // animes tirés au sort et position dans la liste
  let slots = [];            // les 16 places du premier tour, remplies au fur et à mesure du chargement
  let loaderDone = false;

  function startLoader(id) {
    loaderDone = false;
    order = shuffle(usablePool());
    cursor = 0;
    let fails = 0, got = 0, inflight = 0;
    const setProgress = () => {};                                          // l'affichage est géré par prepareAll (un seul écran)
    setProgress();
    const worker = async () => {
      while (id === runId) {
        if (got >= SIZE) return;
        if (got + inflight >= SIZE) { await sleep(200); continue; }          // les autres s'en occupent
        if (cursor >= order.length || fails > 80) return;
        const f = order[cursor++];
        inflight++;
        try {
          const anime = await fetchAnime(f.slug);
          if (id !== runId) return;
          const c = anime ? pickTheme(anime) : null;
          if (!c) continue;
          // Pas de vidéo : on préfère un autre anime, sauf si on en manque
          if (!c.hasVideo && cursor < order.length - 25) continue;
          const song = c.t.song || null;
          const artists = song && Array.isArray(song.artists) ? song.artists.map((x) => x.name).filter(Boolean) : [];
          const m = /(\d+)/.exec(c.t.slug || '');
          const item = { anime: f.title, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, vids: c.vids, audioUrl: c.audioUrl, urls: [], ui: 0, audio: null };
          item.urls = urlsFor(item, quality);
          slots[got++] = item;
          items.push(item);
          setProgress();
        } catch (e) { fails++; await sleep(400); }
        finally { inflight--; }
      }
    };
    Promise.all([worker(), worker(), worker(), worker(), worker()]).then(() => { if (id === runId) loaderDone = true; });
  }


  // Remplace un opening impossible à télécharger par un autre anime
  async function drawReplacement(id) {
    while (id === runId && cursor < order.length) {
      const f = order[cursor++];
      try {
        const anime = await fetchAnime(f.slug);
        const c = anime ? pickTheme(anime) : null;
        if (!c || !c.hasVideo) continue;
        const song = c.t.song || null;
        const artists = song && Array.isArray(song.artists) ? song.artists.map((x) => x.name).filter(Boolean) : [];
        const m = /(\d+)/.exec(c.t.slug || '');
        const item = { anime: f.title, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, vids: c.vids, audioUrl: c.audioUrl, urls: [], ui: 0, audio: null };
        item.urls = urlsFor(item, quality);
        return item;
      } catch (e) { await sleep(300); }
    }
    return null;
  }

  // Télécharge en entier toutes les vidéos de la liste : on ne montre rien tant que tout n'est pas sûr de se lancer.
  // replaceable : si une vidéo est vraiment introuvable, on tire un autre opening à sa place.
  async function prepareAll(id, list, replaceable) {
    show('tn-load');
    const total = list.length;
    let run = true;
    let shown = 0;
    const draw = async () => {
      while (run && id === runId) {
        const done = list.filter((it) => it && it.mode === 'blob').length;
        const raw = list.reduce((a, it) => a + (it ? (it.mode === 'blob' ? 1 : Math.min(0.99, it.pct || 0)) : 0), 0) / total;
        shown = Math.max(shown, raw);
        const frac = shown;
        $('tn-load-text').textContent = replaceable ? 'Préparation des openings… ' + done + ' / ' + total
          : 'Chargement des vidéos du duel… ' + Math.round(frac * 100) + ' %';
        $('tn-load-bar').style.width = Math.round(frac * 100) + '%';
        await sleep(150);
      }
    };
    draw();
    let next = 0;
    const worker = async () => {
      while (id === runId) {
        const i = next++;
        if (i >= total) return;
        let it = list[i];
        while (!it && id === runId) {                                                // l'opening n'est pas encore arrivé
          if (loaderDone && !list[i]) return;
          await sleep(150);
          it = list[i];
        }
        if (!it) return;
        for (let attempt = 0; id === runId; attempt++) {
          await ensure(it);
          if (it.mode === 'blob') break;
          if (attempt < 2) { it.skip = false; release(it); continue; }                  // on réessaie à fond
          if (!replaceable) break;
          const n = await drawReplacement(id);
          if (!n) break;
          const k = items.indexOf(it);
          if (k >= 0) items[k] = n; else items.push(n);
          release(it);
          list[i] = n;
          if (slots === current || slots[i] === it) slots[i] = n;
          it = n;
          attempt = -1;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);   // le délai de démarrage domine : on en lance plusieurs à la fois
    run = false;
    return id === runId;
  }

  /* ---------- Tournoi ---------- */
  const ROUND_NAMES = { 8: 'Huitièmes de finale', 4: 'Quarts de finale', 2: 'Demi-finales', 1: 'Finale' };
  let current = [];        // openings encore en lice
  let next = [];           // vainqueurs du tour en cours
  let pairIdx = 0;
  let history = [];        // { round, a, b, win }
  let pair = null;

  function stopAll() { items.forEach((it) => { if (it.audio) it.audio.pause(); }); }

  const sides = [0, 1].map((i) => {
    const card = $(i ? 'tn-card-b' : 'tn-card-a');
    card.querySelector('.tn-pick').addEventListener('click', () => choose(i));
    card.querySelector('.tn-reload').addEventListener('click', () => {
      const it = pair && pair[i];
      if (!it) return;
      if (it.blobUrl) {                              // fichier déjà en mémoire : on reconstruit juste le lecteur
        const t = it.audio ? it.audio.currentTime : 0;
        if (it.audio) { it.audio.pause(); it.audio.removeAttribute('src'); it.audio.load(); it.audio = null; }
        const a = makeMedia(it);
        const box = sides[i].card.querySelector('.tn-vid');
        box.textContent = '';
        box.appendChild(a);
        if (t) a.addEventListener('loadedmetadata', () => { try { a.currentTime = t; } catch (e) { /* ignoré */ } }, { once: true });
        return;
      }
      release(it);
      showPair();
    });
    return { card };
  });

  // Nom de l'opening (anime, numéro, chanson) : affiché sous la vidéo une fois qu'elle a été lancée
  function showInfo(item) {
    if (!pair) return;
    sides.forEach((s, i) => {
      if (pair[i] !== item) return;
      const box = s.card.querySelector('.tn-info');
      box.textContent = '';
      if (item.revealed) line(box, item, false);
    });
  }

  const failText = () => 'Impossible de préparer 16 openings (connexion ?). Réessaie dans un instant.';

  // Affiche le duel en cours : d'abord on télécharge les deux vidéos en entier (progression à l'écran), puis on les
  // montre ; pendant que tu joues, le duel suivant se télécharge déjà.
  async function showPair() {
    const id = runId;
    stopAll();
    const ia = pairIdx * 2;
    if (!(current[ia] && current[ia + 1])) {          // premier tour : les deux openings ne sont pas encore arrivés
      show('tn-load');
      while (id === runId && !(current[ia] && current[ia + 1])) {
        if (loaderDone) { show('tn-start'); $('tn-start-msg').textContent = failText(); return; }
        await sleep(150);
      }
      if (id !== runId) return;
    }
    const p = [current[ia], current[ia + 1]];
    if (!p.every((it) => it.blobUrl)) {                // (après un changement de qualité par exemple)
      if (!(await prepareAll(id, p, false))) return;
    }
    pair = p;
    $('tn-round').textContent = ROUND_NAMES[current.length / 2] || 'Duel';
    $('tn-count').textContent = 'Duel ' + (pairIdx + 1) + ' / ' + (current.length / 2);
    sides.forEach((s, i) => {
      s.audio = makeMedia(pair[i]);
      const box = s.card.querySelector('.tn-vid');
      box.textContent = '';
      box.appendChild(s.audio);
      showInfo(pair[i]);
    });
    show('tn-match');
    // le duel suivant se télécharge pendant que tu joues celui-ci
    [ia + 2, ia + 3].forEach((k) => { if (current[k]) ensure(current[k]); });
  }

  let afterPick = null;

  function choose(i) {
    stopAll();
    history.push({ round: ROUND_NAMES[current.length / 2] || 'Duel', a: pair[0], b: pair[1], win: i });
    next.push(pair[i]);
    release(pair[1 - i]);                           // le perdant n'a plus besoin de sa vidéo
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

  function setQuality(q) {
    quality = q === 1080 ? 1080 : 720;
    try { localStorage.setItem('opening-quiz-tn-quality', String(quality)); } catch (e) { /* ignoré */ }
    document.querySelectorAll('.tn-q').forEach((b) => {
      const on = Number(b.dataset.q) === quality;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    items.forEach((it) => {
      it.urls = urlsFor(it, quality);
      it.ui = 0;
      release(it);
    });
    if (!$('tn-match').classList.contains('hidden')) {                // le duel en cours est rechargé dans la nouvelle qualité
      const id = runId;
      const alive = current.slice(pairIdx * 2).concat(next).filter(Boolean);
      (async () => { if (await prepareAll(id, alive, false)) showPair(); })();
    }
  }
  document.querySelectorAll('.tn-q').forEach((b) => b.addEventListener('click', () => setQuality(Number(b.dataset.q))));
  setQuality(quality);

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
  function start() {
    const id = ++runId;
    stopAll();
    $('tn-start-msg').textContent = '';
    if (usablePool().length < SIZE) { $('tn-start-msg').textContent = 'Pas assez d\'animes avec ces difficultés : coches-en d\'autres.'; return; }
    items.forEach(release);
    items = [];
    slots = new Array(SIZE);
    current = slots; next = []; pairIdx = 0; history = [];
    show('tn-load');
    startLoader(id);
    (async () => {                                   // un seul écran : les vidéos se téléchargent au fur et à mesure qu'elles arrivent
      if (!(await prepareAll(id, slots, true))) return;
      if (id !== runId) return;
      if (slots.filter(Boolean).length < SIZE) { show('tn-start'); $('tn-start-msg').textContent = failText(); return; }
      showPair();
    })();
  }

  function quit() { runId++; stopAll(); items.forEach(release); items = []; show('tn-start'); }

  $('tn-go').addEventListener('click', start);
  $('tn-again').addEventListener('click', () => { stopAll(); start(); });
  $('tn-cancel').addEventListener('click', quit);
  $('tn-quit').addEventListener('click', () => { if (confirm('Abandonner ce tournoi ?')) quit(); });
})();
