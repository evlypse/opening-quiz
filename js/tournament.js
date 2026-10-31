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

  /* ---------- Années (même réglage que les autres modes, retenu dans le navigateur) ---------- */
  const YEAR_KEY = 'opening-quiz-years';
  const years = { min: 0, max: 0 };
  try {
    const p = (localStorage.getItem(YEAR_KEY) || '').split('-').map((x) => parseInt(x, 10));
    years.min = p[0] > 0 ? p[0] : 0;
    years.max = p[1] > 0 ? p[1] : 0;
  } catch (e) { /* ignoré */ }
  const yearOk = (y) => !y || ((!years.min || y >= years.min) && (!years.max || y <= years.max));
  (() => {
    const box = $('year-box');
    if (!box) return;
    const ymin = $('year-min'), ymax = $('year-max'), label = $('year-label'), info = $('year-info');
    const render = () => {
      label.textContent = years.min && years.max ? years.min + ' – ' + years.max : years.min ? 'depuis ' + years.min : years.max ? 'jusqu\'à ' + years.max : 'toutes';
      box.classList.toggle('filtering', !!(years.min || years.max));
      info.textContent = 'Laisse vide pour ne pas limiter. Les difficultés cochées en haut s\'appliquent toujours.';
      if (document.activeElement !== ymin) ymin.value = years.min || '';
      if (document.activeElement !== ymax) ymax.value = years.max || '';
    };
    const apply = () => {
      years.min = parseInt(ymin.value, 10) || 0;
      years.max = parseInt(ymax.value, 10) || 0;
      if (years.min && years.max && years.min > years.max) { const t = years.min; years.min = years.max; years.max = t; }
      try { localStorage.setItem(YEAR_KEY, years.min + '-' + years.max); } catch (e) { /* ignoré */ }
      render();
    };
    ymin.addEventListener('change', apply);
    ymax.addEventListener('change', apply);
    $('year-clear').addEventListener('click', () => { ymin.value = ''; ymax.value = ''; apply(); });
    render();
  })();

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

  // Un opening (OP) utilisable : ses vidéos, son audio ; null s'il est exclu ou sans média
  function themeOption(t) {
    if (!t || t.type !== 'OP' || OV_EXCLUDED.has(Number(t.id)) || (t.group && BAD_GROUP.test(t.group))) return null;
    const vids = [];
    let audio = null;
    // Toutes les versions vidéo, de la plus « propre » à la moins : non NSFW d'abord, sans crédits d'abord
    // (les versions NSFW sont gardées en dernier recours, comme sur le site de base)
    (t.animethemeentries || []).forEach((e) => (e.videos || []).forEach((v) => {
      if (v.link) vids.push({ url: v.link, rank: (e.nsfw ? 2 : 0) + (v.nc ? 0 : 1), res: Number(v.resolution) || 0, size: Number(v.size) || 0 });
      if (!audio && v.audio && v.audio.link) audio = v.audio.link;
    }));
    return vids.length || audio ? { t, vids, audioUrl: audio, hasVideo: vids.length > 0 } : null;
  }

  function pickTheme(anime) {
    const ok = (anime.animethemes || []).map(themeOption).filter(Boolean);
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
      const from = a.currentTime;
      a._stall = setTimeout(() => {
        if (item.audio !== a || a.paused || a.currentTime > from + 0.4) return;       // ça avance : tout va bien
        a._rescue();
      }, 5000);
    });
    a.addEventListener('timeupdate', () => {
      if (!item.revealed && !a.paused && a.currentTime >= 0.6) {                      // le nom n'apparaît que quand l'image avance vraiment
        item.revealed = true; clearTimeout(a._stall); showInfo(item);
      }
    });
    a.addEventListener('pause', () => clearTimeout(a._stall));
    a._rescue = () => {
      if (item.audio !== a) return;
      a._rescues = (a._rescues || 0) + 1;
      const t = a.currentTime || 0;
      if (a._rescues > 1 && (item.blobUrl || item.partUrl)) {                         // le fichier en mémoire pose problème : lecture directe
        try { if (item.blobUrl) URL.revokeObjectURL(item.blobUrl); } catch (e) { /* ignoré */ }
        item.blobUrl = '';
        item.partUrl = '';
      }
      if (a._rescues > 3 && !item.blobUrl) item.ui = ((item.ui || 0) + 1) % item.urls.length;
      a.src = item.blobUrl || item.partUrl || item.urls[item.ui || 0];
      a.load();
      const go = () => { a.removeEventListener('loadedmetadata', go); try { a.currentTime = t; } catch (e) { /* ignoré */ } lastGesture = Date.now(); const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); };
      a.addEventListener('loadedmetadata', go);
      clearTimeout(a._stall);
      if (a._rescues < 6) a._stall = setTimeout(() => { if (item.audio === a && !a.paused && a.currentTime < t + 0.4) a._rescue(); }, 9000);
    };
    a.addEventListener('waiting', () => {
      clearTimeout(a._stall);
      a._stall = setTimeout(() => { if (item.audio === a && !a.paused && !(a.readyState >= 3)) a._rescue(); }, 15000);
    });
    a._item = item;
    item.audio = a;
    a.src = item.blobUrl || item.partUrl || item.urls[item.ui || 0];
    if (!item.blobUrl) {                                                                // début ou lecture directe : on bascule sur le fichier complet dès qu'il arrive
      ensure(item).then(() => {
        if (item.audio !== a || !item.blobUrl) return;
        const t = a.currentTime || 0, was = !a.paused && !a.ended;
        a.src = item.blobUrl;
        a.load();
        a.addEventListener('loadedmetadata', () => {
          try { a.currentTime = t; } catch (e) { /* ignoré */ }
          if (was) { lastGesture = Date.now(); const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); }
        }, { once: true });
      });
    }
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
    item.halfP = null;
    item.halfDone = false;
    if (item.partUrl) { try { URL.revokeObjectURL(item.partUrl); } catch (e) { /* ignoré */ } }
    item.partUrl = '';
    item.dl = null;
    item.skip = false;
    item.pct = 0;
    item.mode = '';
  }

  // Télécharge toute la vidéo en mémoire (avec sa progression). En cas d'échec : autre version de la même vidéo,
  // puis, en dernier recours, lecture directe depuis le serveur.
  // Téléchargement d'une vidéo (en entier, ou seulement la première moitié : frac = 0.5). Si la connexion se coupe ou se
  // bloque, on REPREND là où on s'était arrêté ; la moitié déjà reçue est gardée pour compléter plus tard.
  function ensure(item, frac = 1) {
    if (frac < 1) {
      if (item.ready) return item.ready;
      if (!item.halfP) item.halfP = run(item, frac);
      return item.halfP;
    }
    if (item.ready) return item.ready;
    item.ready = (async () => {
      if (item.halfP) await item.halfP;
      if (item.mode !== 'blob') await run(item, 1);
    })();
    return item.ready;
  }

  // Le début est reçu : on en fait un petit fichier lisible tout de suite (la suite arrive pendant que tu regardes)
  function markHalf(item, d) {
    item.halfDone = true;
    try { if (item.partUrl) URL.revokeObjectURL(item.partUrl); item.partUrl = URL.createObjectURL(new Blob(d.parts, { type: 'video/webm' })); } catch (e) { item.partUrl = ''; }
  }

  async function run(item, frac) {
    item.pct = item.pct || 0;
    item.frac = frac;
    const d = item.dl || (item.dl = { parts: [], got: 0, total: 0, idx: -1 });
    let netErrors = 0;
    for (let t = 0; t < 14 && !item.skip; t++) {
      const idx = (item.ui + Math.floor(t / 4)) % item.urls.length;   // 4 essais par version
      if (idx !== d.idx) { d.parts = []; d.got = 0; d.total = 0; d.idx = idx; item.halfDone = false; }
      const ctl = new AbortController();
      item.abort = () => ctl.abort();
      let idle = 0;
      const arm = (ms) => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), ms); };
      try {
        arm(25000);
        let res;
        try {
          res = await fetch(item.urls[idx], { signal: ctl.signal, headers: d.got ? { Range: 'bytes=' + d.got + '-' } : {} });
        } catch (e) {
          if (d.got && e && e.name === 'TypeError') { d.parts = []; d.got = 0; res = await fetch(item.urls[idx], { signal: ctl.signal }); }
          else throw e;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (d.got && res.status !== 206) { d.parts = []; d.got = 0; }          // le serveur ne reprend pas : on repart de zéro
        const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
        d.total = cr ? Number(cr[1]) : (d.got + (Number(res.headers.get('content-length')) || 0)) || d.total;
        const stopAt = frac < 1 && d.total ? Math.floor(d.total * frac) : 0;
        if (stopAt && d.got >= stopAt) { clearTimeout(idle); try { if (res.body) res.body.cancel(); } catch (e) { /* ignoré */ } markHalf(item, d); return; }
        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            d.parts.push(r.value); d.got += r.value.length; arm(20000);
            item.pct = Math.max(item.pct || 0, d.total ? Math.min(0.99, d.got / d.total) : 0.5);
            if (d.total && d.got >= d.total) {          // tout est là : inutile d'attendre la fermeture
              try { await reader.cancel(); } catch (e) { /* ignoré */ }
              break;
            }
            if (stopAt && d.got >= stopAt) {                                  // moitié reçue : on s'arrête là pour l'instant
              clearTimeout(idle);
              try { await reader.cancel(); } catch (e) { /* ignoré */ }
              markHalf(item, d);
              return;
            }
          }
        } else {
          const buf = new Uint8Array(await res.arrayBuffer());
          d.parts.push(buf); d.got += buf.length;
        }
        clearTimeout(idle);
        if (d.total && d.got < d.total) throw new Error('incomplet');           // fichier coupé : on reprend
        item.blobUrl = URL.createObjectURL(new Blob(d.parts, { type: 'video/webm' }));
        item.ui = idx;
        item.pct = 1;
        item.mode = 'blob';
        item.dl = null;
        return;
      } catch (e) {
        clearTimeout(idle);
        if (d.total && d.got >= d.total) {                                      // tout était déjà reçu : on termine
          item.blobUrl = URL.createObjectURL(new Blob(d.parts, { type: 'video/webm' }));
          item.ui = d.idx; item.pct = 1; item.mode = 'blob'; item.dl = null;
          return;
        }
        if (item.skip) break;
        if (e && e.name === 'TypeError') { if (++netErrors >= 3) break; }       // réseau ou accès refusé
        await sleep(500);
      }
    }
    item.mode = 'stream';                                                       // dernier recours : lecture directe
    item.pct = 1;
  }

  const HEAD = 0.25;         // part de chaque vidéo téléchargée avant de commencer (le début)
  const PREP = 4;            // nombre d'openings téléchargés avant de commencer (les 2 premiers duels)
  let slots = [];            // les 16 places du premier tour, remplies au fur et à mesure du chargement
  let loaderDone = false;

  /* ---------- Tirage au sort ---------- */
  // Facile / Moyen : les animes de la liste (js/animes.js). Difficile : tout le reste du catalogue AnimeThemes,
  // tiré au hasard (comme dans le jeu principal). Une difficulté « difficile » pèse 3 fois plus qu'une autre :
  // le catalogue difficile est de très loin le plus grand.
  const WEIGHT = { easy: 1, medium: 1, hard: 3 };
  const FALLBACK_TOTAL = 1000;
  let totalOPs = 0;
  let yearApi = true;                 // false si l'API refuse le filtre d'année
  const yearTotals = {};              // année -> nombre d'animes de cette année

  const lastPage = (data) => {
    const last = data.links && data.links.last;
    const m = last && /page(?:\[number\]|%5Bnumber%5D)=(\d+)/i.exec(last);
    if (m) return Number(m[1]);
    if (data.meta && data.meta.last_page) return Number(data.meta.last_page);
    if (data.meta && data.meta.total) return Number(data.meta.total);
    return 0;
  };

  async function getJson(url) {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(1500); throw new Error('429'); }
    if (res.status === 400 || res.status === 422) return { bad: true };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const INCS = ['anime,animethemeentries.videos.audio,song.artists', 'anime,animethemeentries.videos.audio,song'];

  // Un opening au hasard dans tout le catalogue
  async function randomCatalogTheme() {
    if (!totalOPs) {
      try { totalOPs = lastPage(await getJson(`${API}/animetheme?filter[type]=OP&page[size]=1`)) || FALLBACK_TOTAL; } catch (e) { totalOPs = FALLBACK_TOTAL; }
    }
    const n = 1 + Math.floor(Math.random() * totalOPs);
    for (const inc of INCS) {
      const data = await getJson(`${API}/animetheme?filter[type]=OP&page[size]=1&page[number]=${n}&include=${encodeURIComponent(inc)}`);
      if (data.bad) continue;
      const t = (data.animethemes || [])[0];
      return t && t.anime ? { anime: t.anime, option: themeOption(t) } : null;
    }
    return null;
  }

  // Un anime au hasard parmi ceux d'une année (avec tous ses openings)
  async function randomAnimeOfYear(y) {
    const incs = ['animethemes.animethemeentries.videos.audio,animethemes.song.artists', 'animethemes.animethemeentries.videos.audio,animethemes.song'];
    if (yearTotals[y] === undefined) {
      const data = await getJson(`${API}/anime?filter[year]=${y}&page[size]=1`);
      if (data.bad) { yearApi = false; return null; }
      yearTotals[y] = lastPage(data) || ((data.anime || []).length ? 1 : 0);
    }
    if (!yearTotals[y]) return null;
    const n = 1 + Math.floor(Math.random() * yearTotals[y]);
    for (const inc of incs) {
      const data = await getJson(`${API}/anime?filter[year]=${y}&page[size]=1&page[number]=${n}&include=${encodeURIComponent(inc)}`);
      if (data.bad) continue;
      return (data.anime || [])[0] || null;
    }
    return null;
  }

  function makeSource() {
    const pool = usablePool();
    const queues = { easy: shuffle(pool.filter((f) => f.tier === 'easy')), medium: shuffle(pool.filter((f) => f.tier === 'medium')) };
    const curated = new Set(POOL.map((f) => f.slug));
    const used = new Set();
    const bag = [];
    LEVELS.forEach((l) => { if (levels.has(l)) for (let k = 0; k < WEIGHT[l]; k++) bag.push(l); });
    const thisYear = new Date().getFullYear() + 1;
    return {
      // Renvoie { title, tier, c } ; undefined = rien de bon cette fois (on réessaie) ; null = plus rien à tirer
      async next() {
        const live = bag.filter((l) => l === 'hard' || (queues[l] && queues[l].length));
        if (!live.length) return null;
        const level = live[Math.floor(Math.random() * live.length)];
        if (level === 'hard') {
          let anime = null, c = null;
          if ((years.min || years.max) && yearApi) {
            const lo = years.min || 1960, hi = years.max || thisYear;
            anime = await randomAnimeOfYear(lo + Math.floor(Math.random() * (hi - lo + 1)));
            c = anime ? pickTheme(anime) : null;
          } else {
            const r = await randomCatalogTheme();
            anime = r && r.anime;
            c = r && r.option;
          }
          if (!anime || !c || curated.has(anime.slug) || OV_EXCLUDED_ANIMES.has(anime.slug) || used.has(anime.slug) || !yearOk(anime.year)) return undefined;
          used.add(anime.slug);
          return { title: anime.name || anime.slug, tier: 'hard', c };
        }
        const f = queues[level].shift();
        const anime = await fetchAnime(f.slug);
        if (!anime || !yearOk(anime.year)) return undefined;
        const c = pickTheme(anime);
        return c ? { title: f.title, tier: f.tier, c } : undefined;
      }
    };
  }

  let source = null;

  function itemFrom(cand) {
    const c = cand.c;
    const song = c.t.song || null;
    const artists = song && Array.isArray(song.artists) ? song.artists.map((x) => x.name).filter(Boolean) : [];
    const m = /(\d+)/.exec(c.t.slug || '');
    const item = { anime: cand.title, tier: cand.tier, song: song ? song.title : '', artists, num: m ? Number(m[1]) : 1, vids: c.vids, audioUrl: c.audioUrl, urls: [], ui: 0, audio: null };
    item.urls = urlsFor(item, quality);
    return item;
  }

  function startLoader(id) {
    loaderDone = false;
    source = makeSource();
    let fails = 0, got = 0, inflight = 0, noVideo = 0, misses = 0;
    const setProgress = () => {
      $('tn-load-text').textContent = 'Préparation des openings… ' + Math.min(got, SIZE - 1) + ' / ' + SIZE;   // le dernier se valide quand le 1er duel est prêt
      $('tn-load-bar').style.width = Math.round(Math.min(got, SIZE - 1) / SIZE * 100) + '%';
    };
    setProgress();
    const worker = async () => {
      while (id === runId) {
        if (got >= SIZE) return;
        if (got + inflight >= SIZE) { await sleep(200); continue; }          // les autres s'en occupent
        if (fails > 80 || misses > 400) return;
        inflight++;
        try {
          const cand = await source.next();
          if (id !== runId) return;
          if (cand === null) return;
          if (!cand) { misses++; continue; }
          // Pas de vidéo : on préfère un autre opening, sauf si on en manque
          if (!cand.c.hasVideo && ++noVideo < 25) continue;
          const item = itemFrom(cand);
          slots[got++] = item;
          items.push(item);
          if (got <= 2) ensure(item);                                         // les deux premiers : on commence tout de suite
          setProgress();
        } catch (e) { fails++; await sleep(400); }
        finally { inflight--; }
      }
    };
    Promise.all([worker(), worker(), worker(), worker(), worker()]).then(() => { if (id === runId) loaderDone = true; });
  }


  // Remplace un opening impossible à télécharger par un autre
  async function drawReplacement(id) {
    for (let k = 0; id === runId && k < 60; k++) {
      try {
        const cand = await source.next();
        if (cand === null) return null;
        if (!cand || !cand.c.hasVideo) continue;
        return itemFrom(cand);
      } catch (e) { await sleep(300); }
    }
    return null;
  }

  // Télécharge en entier toutes les vidéos de la liste : on ne montre rien tant que tout n'est pas sûr de se lancer.
  // replaceable : si une vidéo est vraiment introuvable, on tire un autre opening à sa place.
  async function prepareAll(id, list, replaceable, from = 0, to = list.length, quiet = false, fracOf = () => 1, byTier = false) {
    if (!quiet) show('tn-load');
    const total = to - from;
    let run = true;
    let shown = 0;
    const t0 = Date.now();
    const draw = async () => {
      while (run && id === runId) {
        if (!replaceable && Date.now() - t0 > 60000) list.forEach((it) => { if (it && it.pct < 1 && !it.skip) { it.skip = true; if (it.abort) it.abort(); } });
        const part = list.slice(from, to);
        const okIt = (it) => it && (it.mode === 'blob' || it.halfDone);
        const done = part.filter(okIt).length;
        const raw = part.reduce((a, it) => a + (it ? (okIt(it) ? 1 : Math.min(0.99, (it.pct || 0) / (it.frac || 1))) : 0), 0) / total;
        shown = Math.max(shown, raw);
        const frac = shown;
        $('tn-load-text').textContent = replaceable ? 'Préparation des openings… ' + done + ' / ' + total
          : 'Chargement des vidéos du duel… ' + Math.round(frac * 100) + ' %';
        $('tn-load-bar').style.width = Math.round(frac * 100) + '%';
        await sleep(150);
      }
    };
    if (!quiet) draw();
    let next = 0;
    const taken = new Set();
    const rank = (it) => (it.tier === 'hard' ? 0 : it.tier === 'medium' ? 1 : 2);
    // difficiles d'abord, puis moyens, puis faciles (les plus connus) — parmi ceux déjà arrivés
    const pickIndex = async () => {
      for (;;) {
        if (id !== runId) return -1;
        let best = -1;
        for (let k = from; k < to; k++) {
          if (taken.has(k) || !list[k]) continue;
          if (best < 0 || rank(list[k]) < rank(list[best])) best = k;
        }
        if (best >= 0) { taken.add(best); return best; }
        let left = false;
        for (let k = from; k < to; k++) if (!taken.has(k)) left = true;
        if (!left || loaderDone) return -1;
        await sleep(150);
      }
    };
    const worker = async () => {
      while (id === runId) {
        let i;
        if (byTier) { i = await pickIndex(); if (i < 0) return; }
        else { i = from + next++; if (i >= to) return; }
        let it = list[i];
        while (!it && id === runId) {                                                // l'opening n'est pas encore arrivé
          if (loaderDone && !list[i]) return;
          await sleep(150);
          it = list[i];
        }
        if (!it) return;
        for (let attempt = 0; id === runId; attempt++) {
          await ensure(it, fracOf(i));
          if (it.mode === 'blob' || it.halfDone || (!replaceable && it.mode === 'stream')) break;
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
    await Promise.all(Array.from({ length: quiet ? 3 : 4 }, () => worker()));
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
      if (it.blobUrl || it.partUrl) {                // fichier (ou début) déjà en mémoire : on reconstruit juste le lecteur
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
    let p = [current[ia], current[ia + 1]];
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
    if (!$('tn-match').classList.contains('hidden')) {                // le duel en cours repart tout de suite, dans la nouvelle qualité
      const alive = current.slice(pairIdx * 2).concat(next).filter(Boolean);
      showPair();
      prepareAll(runId, alive, false, 0, alive.length, true);          // et les vidéos se retéléchargent en arrière-plan
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
    if (!levels.has('hard') && usablePool().length < SIZE) { $('tn-start-msg').textContent = 'Pas assez d\'animes avec ces difficultés : coches-en d\'autres.'; return; }
    items.forEach(release);
    items = [];
    slots = new Array(SIZE);
    current = slots; next = []; pairIdx = 0; history = [];
    show('tn-load');
    startLoader(id);
    (async () => {                                   // 1) on trouve les 16 openings  2) on télécharge le premier duel  3) c'est parti
      while (id === runId && !loaderDone) await sleep(200);
      if (id !== runId) return;
      if (slots.filter(Boolean).length < SIZE) { show('tn-start'); $('tn-start-msg').textContent = failText(); return; }
      const first = [slots[0], slots[1]];
      let ready = false;
      Promise.all(first.map((it) => ensure(it))).then(() => { ready = true; });
      const t0 = Date.now();
      while (id === runId && !ready) {
        if (Date.now() - t0 > 60000) first.forEach((it) => { if (it.pct < 1 && !it.skip) { it.skip = true; if (it.abort) it.abort(); } });   // trop long : lecture directe
        const pct = ((first[0].pct || 0) + (first[1].pct || 0)) / 2;
        $('tn-load-bar').style.width = Math.round((SIZE - 1 + pct) / SIZE * 100) + '%';
        await sleep(150);
      }
      if (id !== runId) return;
      showPair();
    })();
  }

  function quit() { runId++; stopAll(); items.forEach(release); items = []; show('tn-start'); }

  $('tn-go').addEventListener('click', start);
  $('tn-again').addEventListener('click', () => { stopAll(); start(); });
  $('tn-cancel').addEventListener('click', quit);
  $('tn-quit').addEventListener('click', () => { if (confirm('Abandonner ce tournoi ?')) quit(); });
})();
