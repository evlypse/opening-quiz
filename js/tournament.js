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
    if (item.audioUrl) urls.push(item.audioUrl);
    return urls;
  }

  // Sécurité : aucune vidéo ne démarre toute seule, seulement juste après un geste (clic, touche, toucher)
  let lastGesture = 0;
  ['pointerdown', 'keydown', 'touchstart', 'mousedown'].forEach((ev) => document.addEventListener(ev, () => { lastGesture = Date.now(); }, true));

  let lastFail = '';
  function makeMedia(item) {
    if (item.audio) return item.audio;
    const a = document.createElement('video');
    a.preload = 'metadata';
    a.controls = true;
    a.playsInline = true;
    a.volume = 0.5;
    a.autoplay = false;
    a.addEventListener('play', () => {
      const ua = navigator.userActivation;                                            // vrai juste après un vrai geste
      if (ua && !ua.isActive && Date.now() - lastGesture > 2000) { a.pause(); return; }   // pas lancée par toi : on coupe
      items.forEach((it) => { if (it.audio && it.audio !== a) it.audio.pause(); });   // un seul à la fois
      if (!item.revealed) { item.revealed = true; showInfo(item); }                   // le nom apparaît dès qu'on lance la vidéo
    });
    a.addEventListener('error', () => { lastFail = 'média code ' + (a.error ? a.error.code : '?'); });
    a._item = item;
    item.ui = 0;
    item.urls = urlsFor(item, quality);
    item.audio = a;
    a.src = item.urls[0];
    return a;
  }

  let slots = [];            // les 16 places du premier tour, remplies au fur et à mesure du chargement
  let loaderDone = false;

  // Charge le début de la vidéo (une vingtaine de secondes) avant de la déclarer prête ; en cas de blocage, on essaie
  // une autre version du même opening. Renvoie false si rien ne marche.
  function warm(item) {
    return new Promise((resolve) => {
      const a = makeMedia(item);
      a.preload = 'auto';
      let tries = 0, done = false, timer = 0;
      const buffered = () => { try { const bf = a.buffered; return bf.length ? bf.end(bf.length - 1) : 0; } catch (e) { return 0; } };
      const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll); resolve(ok); };
      const retry = () => {
        clearTimeout(timer);
        if (++tries >= 3 || item.urls.length < 2) return finish(false);
        item.ui = (item.ui + 1) % item.urls.length;
        a.src = item.urls[item.ui];
        timer = setTimeout(retry, 30000);
      };
      a.addEventListener('error', retry);
      timer = setTimeout(retry, 45000);
      const poll = setInterval(() => {
        if (Number.isFinite(a.duration) && buffered() >= Math.min(20, Math.max(1, a.duration - 1))) finish(true);
      }, 250);
    });
  }

  function startLoader(id) {
    lastFail = '';
    loaderDone = false;
    const order = shuffle(usablePool());
    let cursor = 0, fails = 0, got = 0, inflight = 0;
    const setProgress = () => {
      $('tn-load-text').textContent = 'Préparation des openings… ' + got + ' / ' + SIZE;
      $('tn-load-bar').style.width = Math.round(got / SIZE * 100) + '%';
    };
    setProgress();
    const worker = async () => {
      while (id === runId) {
        if (got >= SIZE) return;
        if (got + inflight >= SIZE) { await sleep(300); continue; }          // les autres s'en occupent
        if (cursor >= order.length || fails > 40) return;
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
          const item = { anime: f.title, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, vids: c.vids, audioUrl: c.audioUrl, urls: [], audio: null };
          items.push(item);
          const ok = await warm(item);
          if (id !== runId) return;
          if (!ok) { items.splice(items.indexOf(item), 1); item.audio.removeAttribute('src'); item.audio.load(); fails++; continue; }
          slots[got++] = item;
          setProgress();
        } catch (e) { fails++; if (!lastFail) lastFail = 'API injoignable'; await sleep(400); }
        finally { inflight--; }
      }
    };
    Promise.all([worker(), worker(), worker(), worker(), worker(), worker(), worker(), worker()]).then(() => { if (id === runId) loaderDone = true; });
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
      const v = pair && pair[i] && pair[i].audio;
      if (!v) return;
      const t = v.currentTime;
      v.load();
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = t; } catch (e) { /* ignoré */ } }, { once: true });
      watch(v);
    });
    return { card };
  });

  // Une vidéo qui n'a pas fini de se charger est relancée toute seule (après 2 essais, on passe à une autre version
  // du même opening), ou avec le bouton « Recharger »
  function watch(v) {
    let tries = 0;
    clearTimeout(v._wd);
    const check = () => {
      const stuck = !Number.isFinite(v.duration) || !!v.error;   // (un téléchargement lent n'est pas « bloqué »)
      if (!stuck || tries >= 6 || $('tn-match').classList.contains('hidden')) return;
      tries++;
      const t = v.currentTime;
      const it = v._item;
      if (tries >= 2 && it && it.urls.length > 1) { it.ui = (it.ui + 1) % it.urls.length; v.src = it.urls[it.ui]; } else v.load();
      v.addEventListener('loadedmetadata', () => { try { v.currentTime = t; } catch (e) { /* ignoré */ } }, { once: true });
      v._wd = setTimeout(check, 15000);
    };
    v._wd = setTimeout(check, 15000);
  }

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

  const failText = () => 'Impossible de préparer 16 openings (connexion ?). Réessaie dans un instant.' + (lastFail ? ' [' + lastFail + ']' : '');

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
    pair = [current[ia], current[ia + 1]];
    $('tn-round').textContent = ROUND_NAMES[current.length / 2] || 'Duel';
    $('tn-count').textContent = 'Duel ' + (pairIdx + 1) + ' / ' + (current.length / 2);
    sides.forEach((s, i) => {
      s.audio = makeMedia(pair[i]);
      s.audio.preload = 'auto';
      s.audio.currentTime = 0;
      const box = s.card.querySelector('.tn-vid');
      box.textContent = '';
      box.appendChild(s.audio);
      watch(s.audio);
      showInfo(pair[i]);
    });
    show('tn-match');
    // on prépare déjà le duel suivant (juste le début des vidéos)
    [ia + 2, ia + 3].forEach((k) => { if (current[k]) makeMedia(current[k]); });
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

  function setQuality(q) {
    quality = q === 1080 ? 1080 : 720;
    try { localStorage.setItem('opening-quiz-tn-quality', String(quality)); } catch (e) { /* ignoré */ }
    document.querySelectorAll('.tn-q').forEach((b) => {
      const on = Number(b.dataset.q) === quality;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    items.forEach((it) => {
      const v = it.audio;
      if (!v) return;
      const t = v.currentTime;
      v.pause();                                   // après un changement de qualité, c'est toi qui relances
      it.urls = urlsFor(it, quality);
      it.ui = 0;
      v.src = it.urls[0];
      v.addEventListener('loadedmetadata', () => {
        try { v.currentTime = t; } catch (e) { /* ignoré */ }
      }, { once: true });
      if (!$('tn-match').classList.contains('hidden')) watch(v);
    });
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
    items = [];
    slots = new Array(SIZE);
    current = slots; next = []; pairIdx = 0; history = [];
    show('tn-load');
    startLoader(id);
    (async () => {                                   // on attend que les 16 soient prêts (début déjà chargé)
      while (id === runId && !loaderDone) await sleep(200);
      if (id !== runId) return;
      if (slots.filter(Boolean).length < SIZE) { show('tn-start'); $('tn-start-msg').textContent = failText(); return; }
      showPair();
    })();
  }

  function quit() { runId++; stopAll(); items.forEach((it) => { if (it.audio) it.audio.onended = null; }); show('tn-start'); }

  $('tn-go').addEventListener('click', start);
  $('tn-again').addEventListener('click', () => { stopAll(); start(); });
  $('tn-cancel').addEventListener('click', quit);
  $('tn-quit').addEventListener('click', () => { if (confirm('Abandonner ce tournoi ?')) quit(); });
})();
