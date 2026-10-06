(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Réglages
   * ------------------------------------------------------------------ */
  const API = 'https://api.animethemes.moe';
  const DEFAULT_LENGTH = 5;       // durée par défaut de l'extrait (secondes)
  const MIN_LENGTH = 0.1;
  const MAX_LENGTH = 20;          // durée maximale de l'extrait
  const MAX_ATTEMPTS = 12;        // essais max pour trouver un opening qui charge
  const RECENT_MEMORY = 15;       // nb d'animes récents évités pour ne pas répéter
  const SEARCH_DELAY = 250;       // délai (ms) avant de lancer la recherche en ligne
  const FALLBACK_TOTAL = 1000;    // si le nombre total d'openings est introuvable
  const LEVELS = ['easy', 'medium', 'hard'];
  const HISTORY_MAX = 14;

  // Index des franchises (mis en cache dans le navigateur pour ne pas tout recalculer)
  const INDEX_KEY = 'opening-quiz-index-v2';
  const INDEX_TTL = 14 * 24 * 3600 * 1000;   // 14 jours
  const INDEX_DELAY = 1100;                  // pause (ms) entre deux requêtes d'indexation

  // Variantes de "include" : si l'API en refuse une, on passe à la suivante (moins riche).
  const INC = {
    theme: [   // détails d'un opening (audio, vidéo, couverture, lien MAL, noms anglais)
      'anime.images,anime.resources,anime.animesynonyms,animethemeentries.videos.audio,song.artists',
      'anime.images,anime.resources,animethemeentries.videos.audio,song.artists',
      'anime.images,animethemeentries.videos.audio,song.artists',
      'anime,animethemeentries.videos.audio,song'
    ],
    members: ['animethemes,animesynonyms', 'animethemes'],   // saisons d'une même franchise
    search: ['animesynonyms', '']                            // suggestions de la recherche
  };
  const incLevel = { theme: 0, members: 0, search: 0 };

  /* ------------------------------------------------------------------
   * Éléments du DOM
   * ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const playerCard = $('player-card');
  const playBtn = $('play-btn');
  const volumeWrap = document.querySelector('.volume');
  const volBtn = $('vol-btn');
  const volPanel = $('vol-panel');
  const volRange = $('vol-range');
  const volVal = $('vol-val');
  const seek = $('seek');
  const timeCur = $('time-cur');
  const timeMax = $('time-max');
  const lengthInput = $('length-input');
  const lenMinus = $('len-minus');
  const lenPlus = $('len-plus');
  const statusEl = $('status');
  const noticeEl = $('notice');
  const fullBtn = $('full-btn');
  const lettersBtn = $('letters-btn');
  const lettersEl = $('letters');
  const form = $('answer-form');
  const animeInput = $('anime-input');
  const openingInput = $('opening-input');
  const suggestionsEl = $('suggestions');
  const answerMsg = $('answer-msg');
  const submitBtn = $('submit-btn');
  const giveUpBtn = $('giveup-btn');
  const resultCard = $('result');
  const verdictEl = $('verdict');
  const detailsEl = $('result-details');
  const nextBtn = $('next-btn');
  const resCover = $('res-cover');
  const resMal = $('res-mal');
  const resVideoBtn = $('res-video-btn');
  const resVideo = $('res-video');
  const helpWrap = $('help');
  const helpBtn = $('help-btn');
  const historyEl = $('history');
  const streakEl = $('streak');
  const levelBtns = { easy: $('lvl-easy'), medium: $('lvl-medium'), hard: $('lvl-hard') };

  /* ------------------------------------------------------------------
   * Outils : textes, noms, stockage
   * ------------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  const norm = (s) =>
    String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // Clé "de franchise" : le nom sans les marqueurs de saison ("2nd Season", "Part 2", "(2009)"…)
  function baseKey(name) {
    let s = norm(name);
    s = s.replace(/\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|final|new) season\b/g, ' ')
         .replace(/\bseason \d+\b/g, ' ')
         .replace(/\b(?:part|cour) \d+\b/g, ' ')
         .replace(/\b(?:19|20)\d{2}\b/g, ' ')
         .replace(/\btv\b/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+(?:ii|iii|iv)$/, '').replace(/\s+the$/, '');
    return s.trim();
  }

  // Titre propre à afficher (même idée, mais en gardant la casse et la ponctuation)
  function cleanTitle(s) {
    return String(s || '')
      .replace(/\s*[:\-–—]?\s*\(?(?:the\s+)?(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|final|new)\s+season\)?/gi, '')
      .replace(/\s*[:\-–—]?\s*season\s*\d+/gi, '')
      .replace(/\s*[:\-–—]?\s*(?:part|cour)\s*\d+/gi, '')
      .replace(/\s*\((?:19|20)\d{2}\)/g, '')
      .replace(/\s*\(tv\)/gi, '')
      .replace(/\s+(?:II|III|IV)$/, '')
      .replace(/\s*[:\-–—]\s*$/, '')
      .trim();
  }

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* ignoré */ }
    }
  };

  /* ------------------------------------------------------------------
   * Données : franchises faciles / moyennes (js/animes.js)
   * ------------------------------------------------------------------ */
  ANIMES.forEach((f) => {
    f.id = f.slug;
    f.local = true;
    f.nkeys = [f.title, ...(f.aliases || [])].map(norm);
    f.anchorBase = baseKey(f.query || f.slug.replace(/_/g, ' '));
  });

  // Pour les franchises "prefix", tout nom qui commence par l'ancre est regroupé avec elle.
  const prefixAnchors = ANIMES.filter((f) => f.prefix).map((f) => f.anchorBase)
    .sort((a, b) => b.length - a.length);
  const canon = (k) => {
    for (const a of prefixAnchors) if (k === a || k.startsWith(a + ' ')) return a;
    return k;
  };
  const keyOf = (name) => canon(baseKey(name));

  ANIMES.forEach((f) => {
    f.anchor = canon(f.anchorBase);
    f.keys = Array.from(new Set([...[f.title, ...(f.aliases || [])].map(keyOf), f.anchor].filter(Boolean)));
  });

  const curatedBySlug = new Map(ANIMES.map((f) => [f.slug, f]));
  const curatedByKey = new Map();
  ANIMES.forEach((f) => f.keys.forEach((k) => { if (!curatedByKey.has(k)) curatedByKey.set(k, f); }));

  function findCurated(entry) {
    return curatedBySlug.get(entry.slug)
      || curatedByKey.get(keyOf(entry.name))
      || (entry.english ? curatedByKey.get(keyOf(entry.english)) : null)
      || null;
  }

  const DEMOTE = { easy: 'medium', medium: 'hard', hard: 'hard' };

  // Difficulté d'un opening précis (numéro continu) : réglage manuel, sinon celle de l'anime,
  // et un cran de plus pour les openings d'avant 1996 (sauf les "keep").
  function opTier(f, op) {
    let t = (f.ops && f.ops[op.number]) || f.tier;
    if (!f.keep && op.year && op.year <= 1995) t = DEMOTE[t];
    return t;
  }

  /* ------------------------------------------------------------------
   * État
   * ------------------------------------------------------------------ */
  const audio = new Audio();
  audio.preload = 'auto';

  const clampLength = (v) => {
    if (!Number.isFinite(v)) return DEFAULT_LENGTH;
    return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(v * 10) / 10));
  };
  let snippetSeconds = clampLength(parseFloat(store.get('opening-quiz-length', String(DEFAULT_LENGTH))));

  function loadLevels() {
    const raw = store.get('opening-quiz-levels', LEVELS.join(','));
    const set = new Set(raw.split(',').filter((l) => LEVELS.includes(l)));
    if (set.size === 0) LEVELS.forEach((l) => set.add(l));
    return set;
  }
  const levels = loadLevels();

  let totalOPs = 0;
  let totalKnown = false;

  let roundId = 0;
  let round = null;          // voir infoFromTheme()
  let snippetStart = 0;
  let ready = false;
  let fullUnlocked = false;
  let lettersShown = false;
  let answered = false;
  let selectedAnime = null;
  let dragging = false;
  let rafId = 0;
  let reloadTimer = 0;

  const recent = [];                 // derniers animes joués
  const history = [];                // résultats récents (pour la petite frise)
  let streak = 0;

  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  /* ------------------------------------------------------------------
   * Compatibilité (téléphone / navigateurs)
   * ------------------------------------------------------------------ */
  const canOgg = ['audio/ogg; codecs="vorbis"', 'audio/ogg; codecs="opus"', 'audio/ogg']
    .some((t) => audio.canPlayType(t));
  if (!canOgg) {
    noticeEl.textContent =
      'Ton navigateur ne semble pas lire le format audio .ogg utilisé par les musiques (fréquent sur iPhone). ' +
      'Essaie avec Chrome ou Firefox, ou sur ordinateur.';
    noticeEl.classList.remove('hidden');
  }

  // Sur iPhone, le volume ne se règle pas depuis la page : on masque alors le bouton.
  audio.volume = 0.5;
  if (Math.abs(audio.volume - 0.5) > 0.01) volumeWrap.classList.add('hidden');

  /* ------------------------------------------------------------------
   * Aide : survol sur ordinateur, appui sur téléphone
   * ------------------------------------------------------------------ */
  helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    helpWrap.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!helpWrap.contains(e.target)) helpWrap.classList.remove('open');
  });

  /* ------------------------------------------------------------------
   * Boutons d'indice
   * state : 'locked' (grisé) | 'ready' (cliquable) | 'done' (débloqué)
   * ------------------------------------------------------------------ */
  function setHintBtn(btn, label, state) {
    btn.textContent = (state === 'locked' ? '🔒 ' : '') + label;
    btn.disabled = state === 'locked';
    btn.classList.toggle('done', state === 'done');
  }

  /* ------------------------------------------------------------------
   * Volume
   * ------------------------------------------------------------------ */
  function setVolume(percent) {
    const v = Math.min(100, Math.max(0, percent));
    audio.volume = v / 100;
    volRange.value = v;
    volRange.style.setProperty('--p', v + '%');
    volVal.textContent = v + '%';
    volBtn.textContent = v === 0 ? '🔇' : v < 50 ? '🔉' : '🔊';
    store.set('opening-quiz-volume', v);
  }

  const savedVolume = parseInt(store.get('opening-quiz-volume', '50'), 10);
  setVolume(Number.isNaN(savedVolume) ? 50 : savedVolume);

  volRange.addEventListener('input', () => setVolume(Number(volRange.value)));
  volBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    volPanel.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!volPanel.contains(e.target) && e.target !== volBtn) volPanel.classList.add('hidden');
  });

  /* ------------------------------------------------------------------
   * Barre de lecture
   * - Extrait : la barre couvre uniquement la durée de l'extrait
   * - Opening entier : la barre couvre toute la durée
   * ------------------------------------------------------------------ */
  const fmtClock = (s) => {
    const t = Math.max(0, Math.floor(s));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  // Pour les durées courtes (< 10 s), on affiche les dixièmes de seconde
  const fmtTime = (s, len) => (len < 10 ? Math.max(0, s).toFixed(1) + ' s' : fmtClock(s));

  // Durée réellement jouable de l'extrait (au cas où l'audio serait plus court)
  function snippetLength() {
    const d = audio.duration;
    if (!Number.isFinite(d)) return snippetSeconds;
    return Math.max(0.1, Math.min(snippetSeconds, d - snippetStart));
  }

  function seekWindow() {
    if (fullUnlocked) {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      return { offset: 0, length: d };
    }
    return { offset: snippetStart, length: snippetLength() };
  }

  function refreshSeek() {
    const { offset, length } = seekWindow();
    seek.max = String(length || snippetSeconds);
    const pos = dragging
      ? Number(seek.value)
      : Math.min(length, Math.max(0, audio.currentTime - offset));
    if (!dragging) seek.value = String(pos);
    seek.style.setProperty('--p', (length ? (pos / length) * 100 : 0) + '%');
    timeCur.textContent = fmtTime(pos, length);
    timeMax.textContent = fmtTime(length, length);
  }

  seek.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; refreshSeek(); });
  window.addEventListener('pointercancel', () => { dragging = false; });

  seek.addEventListener('input', () => {
    if (!ready) return;
    const { offset, length } = seekWindow();
    const pos = Math.min(length, Math.max(0, Number(seek.value)));
    audio.currentTime = offset + pos;
    refreshSeek();
  });

  /* ------------------------------------------------------------------
   * Durée de l'extrait (0,1 à 20 secondes)
   * ------------------------------------------------------------------ */
  function setLengthEnabled(enabled) {
    lengthInput.disabled = !enabled;
    lenMinus.disabled = !enabled;
    lenPlus.disabled = !enabled;
  }

  function applyLength(value) {
    snippetSeconds = clampLength(value);
    lengthInput.value = String(snippetSeconds);
    store.set('opening-quiz-length', snippetSeconds);

    if (round && ready && !fullUnlocked) {
      // On garde le même point de départ, sauf s'il ne laisse plus assez de place
      const d = audio.duration;
      if (Number.isFinite(d)) snippetStart = Math.max(0, Math.min(snippetStart, d - snippetSeconds - 0.5));
      audio.pause();
      audio.currentTime = snippetStart;
      refreshSeek();
      updatePlayBtn();
    } else {
      timeMax.textContent = fmtTime(snippetSeconds, snippetSeconds);
    }
  }

  lengthInput.value = String(snippetSeconds);
  lengthInput.addEventListener('change', () => applyLength(parseFloat(String(lengthInput.value).replace(',', '.'))));
  // Boutons − / + : 1 seconde ; en dessous de 1 s, on passe directement à 0,1 s (et inversement)
  lenMinus.addEventListener('click', () => applyLength(snippetSeconds > 1 ? snippetSeconds - 1 : MIN_LENGTH));
  lenPlus.addEventListener('click', () => applyLength(snippetSeconds < 1 ? 1 : snippetSeconds + 1));

  /* ------------------------------------------------------------------
   * Lecture audio
   * ------------------------------------------------------------------ */
  function updatePlayBtn() {
    playerCard.classList.toggle('playing', ready && !audio.paused);
    if (!ready) {
      playBtn.textContent = 'Chargement…';
      playBtn.disabled = true;
      return;
    }
    playBtn.disabled = false;
    playBtn.textContent = audio.paused ? '▶ Écouter' : '⏸ Pause';
  }

  function tick() {
    if (audio.paused) return;
    const end = snippetStart + snippetLength();
    if (!fullUnlocked && audio.currentTime >= end) {
      audio.pause();
      audio.currentTime = end;
      refreshSeek();
      updatePlayBtn();
      return;
    }
    refreshSeek();
    rafId = requestAnimationFrame(tick);
  }

  audio.addEventListener('play', () => {
    resVideo.pause();                 // jamais deux sons en même temps
    updatePlayBtn();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  });
  audio.addEventListener('pause', () => { updatePlayBtn(); refreshSeek(); });
  audio.addEventListener('ended', () => { updatePlayBtn(); refreshSeek(); });
  audio.addEventListener('seeked', refreshSeek);
  audio.addEventListener('loadedmetadata', refreshSeek);

  playBtn.addEventListener('click', () => {
    if (!ready) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    if (!fullUnlocked) {
      // Extrait : on repart du début si on est hors de la fenêtre ou à la fin
      const end = snippetStart + snippetLength();
      if (audio.currentTime < snippetStart || audio.currentTime >= end - 0.05) {
        audio.currentTime = snippetStart;
      }
    }
    audio.play();
  });

  fullBtn.addEventListener('click', () => {
    if (!ready || fullUnlocked) return;
    fullUnlocked = true;
    setLengthEnabled(false);
    setHintBtn(fullBtn, 'Opening entier', 'done');
    setHintBtn(lettersBtn, 'Initiales', 'ready');
    audio.currentTime = 0;
    refreshSeek();
    audio.play();
  });

  /* ------------------------------------------------------------------
   * Indice : initiales
   * ------------------------------------------------------------------ */
  function buildHint(title) {
    lettersEl.textContent = '';
    title.split(/\s+/).forEach((word) => {
      const shown = Array.from(word).map((ch, i) => {
        if (i === 0) return ch;
        return /[\p{L}\p{N}]/u.test(ch) ? '_' : ch;
      });
      const span = document.createElement('span');
      span.textContent = shown.join(' ');
      lettersEl.appendChild(span);
    });
  }

  lettersBtn.addEventListener('click', () => {
    if (!round || !fullUnlocked || lettersShown) return;
    lettersShown = true;
    buildHint(round.anime.title);
    lettersEl.classList.remove('hidden');
    setHintBtn(lettersBtn, 'Initiales', 'done');
  });

  /* ------------------------------------------------------------------
   * API AnimeThemes
   * ------------------------------------------------------------------ */
  async function apiFetch(path, params, signal) {
    const qs = Object.entries(params || {})
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const res = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { signal });
    if (res.status === 429) {          // trop de requêtes : on laisse souffler l'API
      await sleep(1500);
      throw new Error('Trop de requêtes (429)');
    }
    return res;
  }

  // Essaie les variantes de "include" de la plus riche à la plus simple.
  async function fetchVariants(kind, path, params, signal) {
    const list = INC[kind];
    for (let i = Math.min(incLevel[kind], list.length - 1); i < list.length; i++) {
      const p = { ...params };
      if (list[i]) p.include = list[i];
      const res = await apiFetch(path, p, signal);
      if ((res.status === 400 || res.status === 422) && i < list.length - 1) {
        incLevel[kind] = i + 1;
        continue;
      }
      return res;
    }
    return null;
  }

  function pickEnglish(syns) {
    if (!Array.isArray(syns)) return '';
    const e = syns.find((s) => s && s.text && /english|^2$/i.test(String(s.type)));
    return e ? e.text : '';
  }

  function entryInfo(a) {
    return {
      id: a.id,
      name: a.name || '',
      slug: a.slug,
      year: a.year || 0,
      season: a.season || '',
      english: pickEnglish(a.animesynonyms),
      themes: Array.isArray(a.animethemes) ? a.animethemes : []
    };
  }

  const seasonOrder = (s) => ({ winter: 0, spring: 1, summer: 2, fall: 3 }[String(s).toLowerCase()] ?? 4);

  // Numérote les openings "à la suite" à travers les saisons d'une franchise.
  function computeOps(members) {
    members.sort((a, b) => (a.year - b.year) || (seasonOrder(a.season) - seasonOrder(b.season)));
    let offset = 0;
    const ops = [];
    members.forEach((m) => {
      const opThemes = m.themes.filter((t) => t.type === 'OP');
      if (!opThemes.length) return;
      const seqs = opThemes.map((t) => t.sequence || 1);
      const minSeq = Math.min(...seqs);
      const maxSeq = Math.max(...seqs);
      const continuous = minSeq > 1;      // la saison continue déjà la numérotation : on la garde telle quelle
      opThemes.forEach((t) => {
        const seq = t.sequence || 1;
        ops.push({ themeId: t.id, number: continuous ? seq : offset + seq, year: m.year });
      });
      offset = continuous ? Math.max(offset, maxSeq) : offset + maxSeq;
    });
    return ops;
  }

  // Recherche d'animes par nom (avec leurs openings), pour retrouver toutes les saisons.
  async function getMembersList(q) {
    let res = await fetchVariants('members', '/anime', { q, 'filter[has]': 'animethemes', 'page[size]': 30 });
    if (res && (res.status === 400 || res.status === 422)) {
      res = await fetchVariants('members', '/anime', { q, 'page[size]': 30 });
    }
    if (!res || !res.ok) return [];
    const data = await res.json();
    return (data.anime || []).map(entryInfo);
  }

  // Franchise "tout-venant" (difficile) : regroupe les saisons d'un anime tiré au hasard.
  const looseCache = new Map();
  async function franchiseFor(entry, theme) {
    const key = keyOf(entry.name);
    if (looseCache.has(key)) return looseCache.get(key);

    let members = [];
    try {
      const list = await getMembersList(cleanTitle(entry.name));
      members = list.filter((e) => keyOf(e.name) === key);
    } catch (err) {
      console.warn('[Opening Quiz] Saisons introuvables :', err);
    }
    if (!members.some((m) => m.slug === entry.slug)) {
      members.push({ ...entry, themes: [{ id: theme.id, type: 'OP', sequence: theme.sequence }] });
    }
    const fr = { ops: computeOps(members) };
    looseCache.set(key, fr);
    return fr;
  }

  /* --- Franchises de la liste (facile / moyen) --- */

  function resolveCurated(f) {
    if (f._data !== undefined) return Promise.resolve(f._data);
    if (!f._p) {
      f._p = doResolveCurated(f).then(
        (d) => { f._data = d; if (!d) f._dead = true; return d; },
        (err) => { f._p = null; throw err; }
      );
    }
    return f._p;
  }

  async function doResolveCurated(f) {
    const q = f.query || f.slug.replace(/_/g, ' ');
    const list = await getMembersList(q);

    let anchor = list.find((e) => e.slug === f.slug)
      || list.find((e) => f.keys.includes(keyOf(e.name)))
      || null;

    if (!anchor) {                                   // dernier recours : le slug exact
      const res = await fetchVariants('members', `/anime/${encodeURIComponent(f.slug)}`, {});
      if (res && res.ok) {
        const data = await res.json();
        if (data.anime) { anchor = entryInfo(data.anime); list.push(anchor); }
      }
    }
    if (!anchor) return null;

    const key = keyOf(anchor.name);
    const members = list.filter((e) => keyOf(e.name) === key);
    if (!members.some((m) => m.slug === anchor.slug)) members.push(anchor);

    const ops = computeOps(members);
    if (!ops.length) return null;
    return { name: anchor.name, ops };
  }

  /* --- Détails d'un opening --- */

  async function fetchTheme(themeId) {
    const res = await fetchVariants('theme', `/animetheme/${themeId}`, {});
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    const data = await res.json();
    return data.animetheme || null;
  }

  // Extrait audio, vidéo et infos musicales d'un "theme" (null si pas d'audio ou NSFW).
  function candidateFromTheme(theme) {
    if (!theme || theme.type !== 'OP') return null;

    let url = null;
    let video = null;
    (theme.animethemeentries || []).forEach((entry) => {
      if (entry.nsfw) return;                      // on ignore les versions NSFW
      (entry.videos || []).forEach((v) => {
        if (!url && v.audio && v.audio.link) url = v.audio.link;
        if (v.link && (!video || (v.nc && !video.nc))) video = v;   // on préfère la version sans crédits
      });
    });
    if (!url) return null;

    const song = theme.song || null;
    const artists = [];
    if (song && Array.isArray(song.artists)) {
      song.artists.forEach((a) => { if (a && a.name) artists.push(a.name); });
    }
    if (!artists.length && song && Array.isArray(song.performances)) {
      song.performances.forEach((p) => { if (p && p.artist && p.artist.name) artists.push(p.artist.name); });
    }

    return {
      url,
      videoUrl: video ? video.link : '',
      songTitle: song && song.title ? song.title : '',
      artists
    };
  }

  function pickCover(images) {
    if (!Array.isArray(images) || !images.length) return '';
    const large = images.find((i) => /large/i.test(String(i.facet)));
    return (large || images[0]).link || '';
  }

  function pickMal(resources) {
    if (!Array.isArray(resources)) return '';
    const r = resources.find((x) => /myanimelist/i.test(String(x.site)));
    if (!r) return '';
    return r.link || (r.external_id ? `https://myanimelist.net/anime/${r.external_id}` : '');
  }

  // Assemble tout ce qu'il faut pour un round.
  function infoFromTheme(theme, number, f) {
    const cand = candidateFromTheme(theme);
    if (!cand) return null;
    const a = theme.anime || {};
    const english = pickEnglish(a.animesynonyms);
    const title = f ? f.title : cleanTitle(english || a.name || '');
    const keys = new Set([...(f ? f.keys : []), keyOf(a.name), english ? keyOf(english) : null].filter(Boolean));

    return {
      ...cand,
      number,
      recentKey: f ? f.slug : keyOf(a.name),
      cover: pickCover(a.images),
      mal: pickMal(a.resources),
      anime: { title, keys, name: a.name || '', year: a.year || 0 }
    };
  }

  /* ------------------------------------------------------------------
   * Difficultés
   * ------------------------------------------------------------------ */
  function updateLevelUI() {
    LEVELS.forEach((l) => {
      levelBtns[l].classList.toggle('active', levels.has(l));
      levelBtns[l].setAttribute('aria-pressed', String(levels.has(l)));
    });
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadRound, 500);   // laisse le temps de cliquer plusieurs difficultés
  }

  LEVELS.forEach((l) => {
    levelBtns[l].addEventListener('click', () => {
      if (levels.has(l)) {
        if (levels.size === 1) return;          // il faut toujours au moins une difficulté
        levels.delete(l);
      } else {
        levels.add(l);
      }
      store.set('opening-quiz-levels', LEVELS.filter((x) => levels.has(x)).join(','));
      updateLevelUI();
      scheduleReload();
    });
  });

  // Facile / moyen : on choisit une franchise de la liste, puis un de ses openings de cette difficulté.
  async function randomOpeningCurated(level) {
    const hasLevel = (f) => f.tier === level
      || (!f.keep && DEMOTE[f.tier] === level)
      || Object.values(f.ops || {}).includes(level);

    let pool = ANIMES.filter((f) => hasLevel(f) && !f._dead && !recent.includes(f.slug));
    if (!pool.length) pool = ANIMES.filter((f) => hasLevel(f) && !f._dead);
    if (!pool.length) return null;

    const f = pick(pool);
    const data = await resolveCurated(f);
    if (!data) {
      console.warn('[Opening Quiz] Anime introuvable :', f.title, `(slug "${f.slug}")`);
      return null;
    }

    const candidates = data.ops.filter((o) => opTier(f, o) === level);
    if (!candidates.length) return null;
    const op = pick(candidates);

    const theme = await fetchTheme(op.themeId);
    return infoFromTheme(theme, op.number, f);
  }

  // Nombre total d'openings : avec une page de 1 résultat, la dernière page = le total.
  async function probeTotal() {
    try {
      const res = await apiFetch('/animetheme', { 'filter[type]': 'OP', 'page[size]': 1 });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const last = data.links && data.links.last;
      const m = last && /page(?:\[number\]|%5Bnumber%5D)=(\d+)/i.exec(last);
      if (m) { totalKnown = true; return Number(m[1]); }
      if (data.meta && data.meta.last_page) { totalKnown = true; return Number(data.meta.last_page); }
      if (data.meta && data.meta.total) { totalKnown = true; return Number(data.meta.total); }
    } catch (err) {
      console.warn('[Opening Quiz] Total des openings introuvable :', err);
    }
    totalKnown = false;
    return FALLBACK_TOTAL;
  }

  // Difficile : un opening au hasard dans tout le catalogue, hors openings déjà classés facile / moyen.
  async function randomOpeningHard() {
    if (!totalOPs) {
      totalOPs = await probeTotal();
      renderCounts();
    }
    const n = 1 + rand(totalOPs);
    const res = await fetchVariants('theme', '/animetheme', {
      'filter[type]': 'OP',
      'page[size]': 1,
      'page[number]': n
    });
    if (!res || !res.ok) throw new Error('Réponse API invalide');

    const data = await res.json();
    const theme = (data.animethemes || [])[0];
    if (!theme || !theme.anime) return null;

    const entry = entryInfo(theme.anime);
    const f = findCurated(entry);
    let number;

    if (f) {
      // Anime de la liste : on ne garde que ses openings classés "difficile"
      if (recent.includes(f.slug)) return null;
      const fdata = await resolveCurated(f);
      const op = fdata && fdata.ops.find((o) => o.themeId === theme.id);
      if (!op || opTier(f, op) !== 'hard') return null;
      number = op.number;
    } else {
      if (recent.includes(keyOf(entry.name))) return null;
      const fr = await franchiseFor(entry, theme);
      const op = fr.ops.find((o) => o.themeId === theme.id);
      number = op ? op.number : (theme.sequence || 1);
    }
    return infoFromTheme(theme, number, f);
  }

  // Tire une difficulté parmi celles activées, puis un opening de cette difficulté.
  async function fetchRandomOpening() {
    const level = pick(LEVELS.filter((l) => levels.has(l)));
    return level === 'hard' ? randomOpeningHard() : randomOpeningCurated(level);
  }

  /* ------------------------------------------------------------------
   * Nombre d'openings par difficulté (calculé en arrière-plan puis mis en cache)
   * ------------------------------------------------------------------ */
  function setCount(name, text) {
    document.querySelectorAll(`[data-count="${name}"]`).forEach((el) => { el.textContent = text; });
  }

  function renderCounts() {
    let easy = 0;
    let medium = 0;
    let done = 0;
    ANIMES.forEach((f) => {
      if (f._data) {
        done++;
        f._data.ops.forEach((o) => {
          const t = opTier(f, o);
          if (t === 'easy') easy++;
          else if (t === 'medium') medium++;
        });
      } else if (f._dead) {
        done++;
      }
    });
    const finished = done >= ANIMES.length;
    const suffix = finished ? '' : ' (calcul en cours…)';
    setCount('easy', easy + suffix);
    setCount('medium', medium + suffix);
    setCount('hard', totalKnown
      ? '≈ ' + Math.max(0, totalOPs - easy - medium).toLocaleString('fr-FR') + suffix
      : 'des milliers');
  }

  let indexStamp = Date.now();

  function loadIndexCache() {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || Date.now() - c.t > INDEX_TTL) return;
      indexStamp = c.t;
      ANIMES.forEach((f) => {
        const d = c.d && c.d[f.slug];
        if (d === null) {
          f._dead = true;
        } else if (d) {
          f._data = { name: d.n, ops: d.o.map(([themeId, number, year]) => ({ themeId, number, year })) };
        }
      });
      if (c.total) { totalOPs = c.total; totalKnown = !!c.known; }
    } catch (err) { /* cache illisible : on repart de zéro */ }
  }

  function saveIndexCache() {
    try {
      const d = {};
      ANIMES.forEach((f) => {
        if (f._data) d[f.slug] = { n: f._data.name, o: f._data.ops.map((o) => [o.themeId, o.number, o.year]) };
        else if (f._dead) d[f.slug] = null;
      });
      localStorage.setItem(INDEX_KEY, JSON.stringify({ t: indexStamp, d, total: totalOPs, known: totalKnown }));
    } catch (err) { /* ignoré */ }
  }

  async function runIndex() {
    if (!totalOPs) {
      totalOPs = await probeTotal();
    }
    renderCounts();

    const todo = ANIMES.filter((f) => f._data === undefined && !f._dead);
    for (let i = todo.length - 1; i > 0; i--) {           // ordre aléatoire
      const j = rand(i + 1);
      [todo[i], todo[j]] = [todo[j], todo[i]];
    }

    let sinceSave = 0;
    for (const f of todo) {
      if (f._data !== undefined || f._dead) continue;
      try {
        await resolveCurated(f);
      } catch (err) {
        console.warn('[Opening Quiz] Indexation :', err);
        await sleep(2000);
        continue;
      }
      renderCounts();
      if (++sinceSave >= 8) { saveIndexCache(); sinceSave = 0; }
      await sleep(INDEX_DELAY);
    }
    saveIndexCache();
    renderCounts();
  }

  window.addEventListener('beforeunload', saveIndexCache);

  /* ------------------------------------------------------------------
   * Chargement audio
   * ------------------------------------------------------------------ */
  function prepareAudio(url) {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('error', onError);
        resolve(ok);
      };
      const onReady = () => {
        const d = audio.duration;
        if (!Number.isFinite(d) && audio.readyState < 3) return;   // durée pas encore connue

        // Point de départ aléatoire, n'importe où dans l'opening (avec la place pour tout l'extrait)
        const maxStart = Number.isFinite(d) ? Math.max(0, d - snippetSeconds - 0.5) : 30;
        snippetStart = Math.random() * maxStart;
        finish(true);
      };
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(false), 15000);

      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('canplay', onReady);
      audio.addEventListener('error', onError);
      audio.pause();
      audio.src = url;
      audio.load();
    });
  }

  /* ------------------------------------------------------------------
   * Nouveau round
   * ------------------------------------------------------------------ */
  function resetVideo() {
    resVideo.pause();
    resVideo.removeAttribute('src');
    resVideo.load();
    resVideo.classList.add('hidden');
    resVideoBtn.textContent = '▶ Voir l\'opening';
  }

  function resetUI() {
    audio.pause();
    cancelAnimationFrame(rafId);
    round = null;
    ready = false;
    fullUnlocked = false;
    lettersShown = false;
    answered = false;
    selectedAnime = null;
    dragging = false;

    playerCard.classList.remove('answered');
    setHintBtn(fullBtn, 'Opening entier', 'locked');
    setHintBtn(lettersBtn, 'Initiales', 'locked');
    setLengthEnabled(true);
    lettersEl.classList.add('hidden');
    lettersEl.textContent = '';

    seek.disabled = true;
    seek.max = String(snippetSeconds);
    seek.value = '0';
    seek.style.setProperty('--p', '0%');
    timeCur.textContent = fmtTime(0, snippetSeconds);
    timeMax.textContent = fmtTime(snippetSeconds, snippetSeconds);

    animeInput.value = '';
    animeInput.disabled = false;
    openingInput.value = '1';
    openingInput.disabled = false;
    submitBtn.disabled = true;
    giveUpBtn.disabled = true;
    answerMsg.textContent = '';
    closeSuggestions();

    resultCard.classList.add('hidden');
    resetVideo();
    updatePlayBtn();
  }

  async function loadRound() {
    clearTimeout(reloadTimer);
    const id = ++roundId;
    resetUI();
    statusEl.textContent = 'Chargement…';

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const info = await fetchRandomOpening();
        if (id !== roundId) return;
        if (!info) continue;

        const ok = await prepareAudio(info.url);
        if (id !== roundId) return;
        if (!ok) {
          console.warn('[Opening Quiz] Audio impossible à charger :', info.anime.title);
          continue;
        }

        round = info;
        recent.push(info.recentKey);
        if (recent.length > RECENT_MEMORY) recent.shift();

        ready = true;
        audio.currentTime = snippetStart;
        seek.disabled = false;
        refreshSeek();
        setHintBtn(fullBtn, 'Opening entier', 'ready');
        statusEl.textContent = '';
        submitBtn.disabled = false;
        giveUpBtn.disabled = false;
        updatePlayBtn();
        // Sur téléphone, on ne met pas le curseur dans le champ : cela ouvrirait le clavier tout seul
        if (!coarsePointer) animeInput.focus({ preventScroll: true });
        return;
      } catch (err) {
        console.warn('[Opening Quiz] Erreur de chargement :', err);
        if (id !== roundId) return;
        await sleep(400);
      }
    }

    if (id === roundId) {
      statusEl.textContent = 'Impossible de charger un opening (connexion ?). Clique sur « Suivant » pour réessayer.';
      verdictEl.className = 'verdict hidden';
      detailsEl.textContent = '';
      resCover.classList.add('hidden');
      resMal.classList.add('hidden');
      resVideoBtn.classList.add('hidden');
      resultCard.classList.remove('hidden');
    }
  }

  /* ------------------------------------------------------------------
   * Autocomplétion : liste locale tout de suite, puis recherche dans tout le catalogue
   * (les saisons d'un même anime sont regroupées en une seule suggestion)
   * ------------------------------------------------------------------ */
  let suggestions = [];
  let activeIndex = -1;
  let searchSeq = 0;
  let searchTimer = 0;
  let searchAbort = null;

  function searchLocal(query) {
    const q = norm(query);
    if (!q) return [];
    const starts = [];
    const contains = [];
    ANIMES.forEach((f) => {
      if (f.nkeys.some((k) => k.startsWith(q))) starts.push(f);
      else if (f.nkeys.some((k) => k.includes(q))) contains.push(f);
    });
    return [...starts, ...contains].slice(0, 5);
  }

  function groupRemote(list) {
    const groups = new Map();
    list.forEach((e) => {
      const k = keyOf(e.name);
      const g = groups.get(k);
      if (!g) {
        groups.set(k, { first: e, entries: [e] });
      } else {
        g.entries.push(e);
        if (e.year && (!g.first.year || e.year < g.first.year)) g.first = e;
      }
    });
    return Array.from(groups.values()).map((g) => {
      const e = g.first;
      const title = cleanTitle(e.english || e.name);
      const keys = new Set();
      g.entries.forEach((x) => {
        keys.add(keyOf(x.name));
        if (x.english) keys.add(keyOf(x.english));
      });
      return { title, slug: e.slug, keys: Array.from(keys), nkeys: [norm(title), norm(e.name)] };
    });
  }

  async function remoteSearch(query, seq) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;

    try {
      let res = await fetchVariants('search', '/anime', {
        q: query,
        'page[size]': 12,
        'filter[has]': 'animethemes'
      }, signal);
      if (res && (res.status === 400 || res.status === 422)) {
        res = await fetchVariants('search', '/anime', { q: query, 'page[size]': 12 }, signal);
      }
      if (!res || !res.ok) return;

      const data = await res.json();
      if (seq !== searchSeq || selectedAnime) return;   // résultat périmé

      mergeSuggestions(groupRemote((data.anime || []).map(entryInfo)));
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('[Opening Quiz] Recherche impossible :', err);
    }
  }

  function mergeSuggestions(remote) {
    const base = suggestions.filter((s) => s.local);
    const extras = remote.filter((r) => !base.some((b) => b.keys.some((k) => r.keys.includes(k))));
    suggestions = [...base, ...extras].slice(0, 10);
    if (activeIndex < 0 || activeIndex >= suggestions.length) activeIndex = suggestions.length ? 0 : -1;
    renderSuggestions();
  }

  function renderSuggestions() {
    suggestionsEl.textContent = '';
    suggestions.forEach((a, i) => {
      const li = document.createElement('li');
      li.textContent = a.title;
      li.setAttribute('role', 'option');
      if (i === activeIndex) li.classList.add('active');
      // "mousedown" évite de perdre le focus du champ (et fonctionne aussi au toucher)
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        chooseSuggestion(a);
      });
      suggestionsEl.appendChild(li);
    });
    const open = suggestions.length > 0;
    suggestionsEl.classList.toggle('hidden', !open);
    animeInput.setAttribute('aria-expanded', String(open));
  }

  function closeSuggestions() {
    suggestions = [];
    activeIndex = -1;
    suggestionsEl.classList.add('hidden');
    suggestionsEl.textContent = '';
    animeInput.setAttribute('aria-expanded', 'false');
  }

  function chooseSuggestion(anime) {
    selectedAnime = anime;
    animeInput.value = anime.title;
    answerMsg.textContent = '';
    searchSeq++;                                    // annule les recherches en cours
    clearTimeout(searchTimer);
    closeSuggestions();
  }

  animeInput.addEventListener('input', () => {
    selectedAnime = null;
    answerMsg.textContent = '';
    const query = animeInput.value;
    const seq = ++searchSeq;

    suggestions = searchLocal(query);
    activeIndex = suggestions.length ? 0 : -1;
    renderSuggestions();

    clearTimeout(searchTimer);
    if (norm(query).length >= 2) {
      searchTimer = setTimeout(() => remoteSearch(query, seq), SEARCH_DELAY);
    }
  });

  animeInput.addEventListener('keydown', (e) => {
    if (suggestionsEl.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      renderSuggestions();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  animeInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

  /* ------------------------------------------------------------------
   * Historique des réponses (petite frise)
   * ------------------------------------------------------------------ */
  const HIST_LABEL = { correct: 'Correct', presque: 'Presque', faux: 'Faux', gaveup: 'Abandon' };

  function pushHistory(cls) {
    history.push(cls);
    if (history.length > HISTORY_MAX) history.shift();
    streak = cls === 'correct' ? streak + 1 : 0;

    historyEl.textContent = '';
    history.forEach((c) => {
      const s = document.createElement('span');
      s.className = 'h ' + c;
      s.title = HIST_LABEL[c];
      historyEl.appendChild(s);
    });
    streakEl.textContent = streak > 1 ? 'Série : ' + streak : '';
  }

  /* ------------------------------------------------------------------
   * Fin d'un round : validation ou abandon
   * ------------------------------------------------------------------ */
  function sameAnime(guess, truthKeys) {
    return guess.keys.some((k) => truthKeys.has(k));
  }

  function addDetail(label, value) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = label;
    li.appendChild(strong);
    li.appendChild(document.createTextNode(' ' + value));
    detailsEl.appendChild(li);
  }

  function finishRound(guess, num, gaveUp) {
    answered = true;
    answerMsg.textContent = '';
    animeInput.disabled = true;
    openingInput.disabled = true;
    submitBtn.disabled = true;
    giveUpBtn.disabled = true;
    closeSuggestions();

    let label;
    let cls;
    if (gaveUp) {
      label = 'Abandon';
      cls = 'gaveup';
    } else {
      const animeOk = sameAnime(guess, round.anime.keys);
      const numOk = num === round.number;
      if (animeOk && numOk) { label = 'Correct'; cls = 'correct'; }
      else if (animeOk) { label = 'Presque'; cls = 'presque'; }
      else { label = 'Faux'; cls = 'faux'; }
    }

    verdictEl.textContent = label;
    verdictEl.className = 'verdict ' + cls;

    detailsEl.textContent = '';
    addDetail('Anime', round.anime.title + (round.anime.year ? ' (' + round.anime.year + ')' : ''));
    addDetail('Opening', String(round.number));
    const song = [round.songTitle, round.artists.length ? '— ' + round.artists.join(', ') : '']
      .filter(Boolean).join(' ');
    if (song) addDetail('Musique', song);

    // Couverture et liens
    if (round.cover) {
      resCover.src = round.cover;
      resCover.alt = 'Couverture : ' + round.anime.title;
      resCover.classList.remove('hidden');
    } else {
      resCover.classList.add('hidden');
    }
    if (round.mal) {
      resMal.href = round.mal;
      resMal.classList.remove('hidden');
    } else {
      resMal.classList.add('hidden');
    }
    resVideoBtn.classList.toggle('hidden', !round.videoUrl);

    resultCard.classList.remove('hidden');
    nextBtn.focus({ preventScroll: true });
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Le lecteur passe sur l'opening entier, sans le lancer : on reste à l'endroit de l'extrait
    fullUnlocked = true;
    setLengthEnabled(false);
    playerCard.classList.add('answered');
    refreshSeek();

    pushHistory(cls);

    // Petite fête quand tout est bon (effet défini dans js/fx.js)
    if (cls === 'correct' && typeof window.fxBurst === 'function') {
      const r = verdictEl.getBoundingClientRect();
      window.fxBurst(r.left + r.width / 2, r.top + r.height / 2, 22);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!round || answered) return;

    // Anime : soit choisi dans la liste, soit tapé exactement
    let guess = selectedAnime;
    if (!guess) {
      const typed = norm(animeInput.value);
      guess = typed
        ? (suggestions.find((s) => s.nkeys.includes(typed)) || ANIMES.find((f) => f.nkeys.includes(typed)))
        : null;
    }
    if (!guess) {
      answerMsg.textContent = 'Choisis un anime dans la liste.';
      animeInput.focus();
      return;
    }

    const num = parseInt(openingInput.value, 10);
    if (Number.isNaN(num) || num < 1) {
      answerMsg.textContent = 'Numéro d\'opening invalide.';
      openingInput.focus();
      return;
    }

    finishRound(guess, num, false);
  });

  giveUpBtn.addEventListener('click', () => {
    if (!round || answered) return;
    finishRound(null, null, true);
  });

  nextBtn.addEventListener('click', loadRound);

  /* ------------------------------------------------------------------
   * Vidéo de l'opening (affichée après la réponse, chargée seulement au clic)
   * ------------------------------------------------------------------ */
  resVideoBtn.addEventListener('click', () => {
    if (!round || !round.videoUrl) return;
    if (resVideo.classList.contains('hidden')) {
      audio.pause();
      resVideo.src = round.videoUrl;
      resVideo.classList.remove('hidden');
      resVideoBtn.textContent = '✕ Masquer la vidéo';
      const p = resVideo.play();
      if (p && p.catch) p.catch(() => { /* lecture refusée : l'utilisateur peut cliquer sur lecture */ });
    } else {
      resetVideo();
    }
  });

  /* TEST_HOOK */

  /* ------------------------------------------------------------------
   * Démarrage
   * ------------------------------------------------------------------ */
  loadIndexCache();
  updateLevelUI();
  renderCounts();
  loadRound();
  setTimeout(runIndex, 2500);       // l'indexation démarre après le premier chargement
})();
