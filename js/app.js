(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Réglages
   * ------------------------------------------------------------------ */
  const API = 'https://api.animethemes.moe';
  const DEFAULT_LENGTH = 5;       // durée par défaut de l'extrait (secondes)
  const MIN_LENGTH = 1;
  const MAX_LENGTH = 30;          // durée maximale de l'extrait
  const MAX_ATTEMPTS = 12;        // essais max pour trouver un opening qui charge
  const RECENT_MEMORY = 15;       // nb d'animes récents évités pour ne pas répéter
  const SEARCH_DELAY = 250;       // délai (ms) avant de lancer la recherche en ligne
  const FALLBACK_TOTAL = 1000;    // si le nombre total d'openings est introuvable
  const LEVELS = ['easy', 'medium', 'hard'];

  // Variantes de "include" : si l'API refuse la première (ex. artistes), on tente la suivante.
  const INCLUDES = {
    theme: [
      'anime,animethemeentries.videos.audio,song.artists',
      'anime,animethemeentries.videos.audio,song'
    ],
    anime: [
      'animethemes.animethemeentries.videos.audio,animethemes.song.artists',
      'animethemes.animethemeentries.videos.audio,animethemes.song'
    ]
  };
  let includeLevel = 0;

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
  const resultCard = $('result');
  const verdictEl = $('verdict');
  const detailsEl = $('result-details');
  const nextBtn = $('next-btn');
  const helpWrap = $('help');
  const helpBtn = $('help-btn');
  const levelBtns = { easy: $('lvl-easy'), medium: $('lvl-medium'), hard: $('lvl-hard') };
  const modeCount = $('mode-count');

  /* ------------------------------------------------------------------
   * Outils
   * ------------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) =>
    String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* ignoré */ }
    }
  };

  /* ------------------------------------------------------------------
   * Données : liste d'animes connus (js/animes.js) répartie en facile / moyen
   * ------------------------------------------------------------------ */
  const EASY = new Set(typeof EASY_SLUGS !== 'undefined' ? EASY_SLUGS : []);

  ANIMES.forEach((a) => {
    a.id = a.slug;
    a.local = true;
    a.keys = [a.title, ...(a.aliases || [])].map(norm);
    a.tier = EASY.has(a.slug) ? 'easy' : 'medium';
  });

  const curatedSlugs = new Set(ANIMES.map((a) => a.slug));
  const curatedNames = new Set(ANIMES.flatMap((a) => a.keys));
  const easyCount = ANIMES.filter((a) => a.tier === 'easy').length;
  const mediumCount = ANIMES.length - easyCount;

  const unavailable = new Set();   // animes de la liste introuvables sur l'API
  const recent = [];               // derniers animes joués

  /* ------------------------------------------------------------------
   * État
   * ------------------------------------------------------------------ */
  const audio = new Audio();
  audio.preload = 'auto';

  const clampLength = (v) => {
    if (!Number.isFinite(v)) return DEFAULT_LENGTH;
    return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(v)));
  };
  let snippetSeconds = clampLength(parseInt(store.get('opening-quiz-length', String(DEFAULT_LENGTH)), 10));

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
  let round = null;                // { url, number, songTitle, artists, anime: {title, slugs, names} }
  let snippetStart = 0;
  let ready = false;
  let fullUnlocked = false;
  let lettersShown = false;
  let answered = false;
  let selectedAnime = null;
  let dragging = false;
  let rafId = 0;
  let reloadTimer = 0;

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
  const fmt = (s) => {
    const t = Math.max(0, Math.floor(s));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };

  // Durée réellement jouable de l'extrait (au cas où l'audio serait plus court)
  function snippetLength() {
    const d = audio.duration;
    if (!Number.isFinite(d)) return snippetSeconds;
    return Math.max(0.5, Math.min(snippetSeconds, d - snippetStart));
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
    const pct = length ? (pos / length) * 100 : 0;
    seek.style.setProperty('--p', pct + '%');
    timeCur.textContent = fmt(pos);
    timeMax.textContent = fmt(length);
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
   * Durée de l'extrait (1 à 30 secondes)
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
      timeMax.textContent = fmt(snippetSeconds);
    }
  }

  lengthInput.value = String(snippetSeconds);
  lengthInput.addEventListener('change', () => applyLength(parseInt(lengthInput.value, 10)));
  lenMinus.addEventListener('click', () => applyLength(snippetSeconds - 1));
  lenPlus.addEventListener('click', () => applyLength(snippetSeconds + 1));

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

  // Tente les variantes de "include" jusqu'à ce que l'API en accepte une.
  async function fetchWithIncludes(kind, path, params, signal) {
    const variants = INCLUDES[kind];
    for (let lvl = Math.min(includeLevel, variants.length - 1); lvl < variants.length; lvl++) {
      const res = await apiFetch(path, { ...params, include: variants[lvl] }, signal);
      if (res.status === 400 || res.status === 422) {
        includeLevel = Math.max(includeLevel, lvl + 1);
        continue;
      }
      return res;
    }
    return null;
  }

  // Transforme un "theme" de l'API en candidat jouable (null si pas d'audio ou NSFW).
  function candidateFromTheme(theme) {
    if (!theme || theme.type !== 'OP') return null;

    let url = null;
    (theme.animethemeentries || []).forEach((entry) => {
      if (entry.nsfw) return;                      // on ignore les versions NSFW
      (entry.videos || []).forEach((video) => {
        if (!url && video.audio && video.audio.link) url = video.audio.link;
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
      number: theme.sequence || 1,                 // un seul opening => "1"
      songTitle: song && song.title ? song.title : '',
      artists
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

    levelBtns.easy.title = easyCount + ' animes très connus';
    levelBtns.medium.title = mediumCount + ' animes connus';
    levelBtns.hard.title = 'Tout le reste du catalogue AnimeThemes';

    const curated = (levels.has('easy') ? easyCount : 0) + (levels.has('medium') ? mediumCount : 0);
    const parts = [];
    if (curated) parts.push(curated + ' animes');
    if (levels.has('hard')) {
      parts.push(totalKnown && totalOPs && !curated
        ? 'catalogue (' + totalOPs.toLocaleString('fr-FR') + ' openings)'
        : 'catalogue entier');
    }
    modeCount.textContent = parts.join(' + ');
  }

  function flashCount(text) {
    modeCount.textContent = text;
    setTimeout(updateLevelUI, 1600);
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadRound, 500);   // laisse le temps de cliquer plusieurs difficultés
  }

  LEVELS.forEach((l) => {
    levelBtns[l].addEventListener('click', () => {
      if (levels.has(l)) {
        if (levels.size === 1) {
          flashCount('Garde au moins une difficulté');
          return;
        }
        levels.delete(l);
      } else {
        levels.add(l);
      }
      store.set('opening-quiz-levels', LEVELS.filter((x) => levels.has(x)).join(','));
      updateLevelUI();
      scheduleReload();
    });
  });

  /* --- Facile / moyen : animes de js/animes.js --- */

  function pickCurated(level) {
    let pool = ANIMES.filter((a) => a.tier === level && !unavailable.has(a.id) && !recent.includes(a.slug));
    if (pool.length === 0) pool = ANIMES.filter((a) => a.tier === level && !unavailable.has(a.id));
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Cherche l'anime par son slug ; si le slug est faux (404), tente une recherche par nom.
  async function getCuratedAnimeData(anime) {
    let res = await fetchWithIncludes('anime', `/anime/${encodeURIComponent(anime.slug)}`, {});
    if (res && res.ok) {
      const data = await res.json();
      return data.anime || null;
    }
    if (res && res.status !== 404) throw new Error('HTTP ' + res.status);

    const query = anime.query || anime.slug.replace(/_/g, ' ');
    res = await fetchWithIncludes('anime', '/anime', { q: query, 'page[size]': 10 });
    if (!res || !res.ok) return null;

    const data2 = await res.json();
    const list = data2.anime || [];
    const nq = norm(query);
    return (
      list.find((a) => a.slug === anime.slug) ||
      list.find((a) => norm(a.name) === nq) ||
      list.find((a) => norm(a.name).startsWith(nq)) ||
      null
    );
  }

  async function randomOpeningCurated(level) {
    const anime = pickCurated(level);
    if (!anime) return null;

    const data = await getCuratedAnimeData(anime);
    if (!data) {
      console.warn('[Opening Quiz] Anime introuvable :', anime.title, `(slug "${anime.slug}")`);
      unavailable.add(anime.id);
      return null;
    }

    const candidates = (data.animethemes || []).map(candidateFromTheme).filter(Boolean);
    if (candidates.length === 0) {
      console.warn('[Opening Quiz] Aucun opening audio pour :', anime.title);
      unavailable.add(anime.id);
      return null;
    }

    const cand = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      ...cand,
      recentKey: anime.slug,
      anime: {
        title: anime.title,
        slugs: [anime.slug, data.slug].filter(Boolean),
        names: [...anime.keys, norm(data.name)]
      }
    };
  }

  /* --- Difficile : un opening au hasard dans tout le reste du catalogue --- */

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

  async function randomOpeningHard() {
    if (!totalOPs) {
      totalOPs = await probeTotal();
      updateLevelUI();
    }
    const n = 1 + Math.floor(Math.random() * totalOPs);
    const res = await fetchWithIncludes('theme', '/animetheme', {
      'filter[type]': 'OP',
      'page[size]': 1,
      'page[number]': n
    });
    if (!res || !res.ok) throw new Error('Réponse API invalide');

    const data = await res.json();
    const theme = (data.animethemes || [])[0];
    if (!theme || !theme.anime) return null;

    const a = theme.anime;
    if (recent.includes(a.slug)) return null;                                   // déjà joué récemment
    if (curatedSlugs.has(a.slug) || curatedNames.has(norm(a.name))) return null; // appartient à facile/moyen

    const cand = candidateFromTheme(theme);
    if (!cand) return null;

    return {
      ...cand,
      recentKey: a.slug,
      anime: { title: a.name, slugs: [a.slug], names: [norm(a.name)] }
    };
  }

  // Tire une difficulté parmi celles activées, puis un opening de cette difficulté.
  async function fetchRandomOpening() {
    const active = LEVELS.filter((l) => levels.has(l));
    const level = active[Math.floor(Math.random() * active.length)];
    return level === 'hard' ? randomOpeningHard() : randomOpeningCurated(level);
  }

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

    setHintBtn(fullBtn, 'Opening entier', 'locked');
    setHintBtn(lettersBtn, 'Initiales', 'locked');
    setLengthEnabled(true);
    lettersEl.classList.add('hidden');
    lettersEl.textContent = '';

    seek.disabled = true;
    seek.max = String(snippetSeconds);
    seek.value = '0';
    seek.style.setProperty('--p', '0%');
    timeCur.textContent = '0:00';
    timeMax.textContent = fmt(snippetSeconds);

    animeInput.value = '';
    animeInput.disabled = false;
    openingInput.value = '1';
    openingInput.disabled = false;
    submitBtn.disabled = true;
    answerMsg.textContent = '';
    closeSuggestions();

    resultCard.classList.add('hidden');
    updatePlayBtn();
  }

  async function loadRound() {
    clearTimeout(reloadTimer);
    const id = ++roundId;
    resetUI();
    updateLevelUI();
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
        updatePlayBtn();
        animeInput.focus({ preventScroll: true });
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
      resultCard.classList.remove('hidden');
    }
  }

  /* ------------------------------------------------------------------
   * Autocomplétion : liste locale tout de suite, puis recherche dans tout le catalogue
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
    ANIMES.forEach((a) => {
      if (a.keys.some((k) => k.startsWith(q))) starts.push(a);
      else if (a.keys.some((k) => k.includes(q))) contains.push(a);
    });
    return [...starts, ...contains].slice(0, 5);
  }

  async function remoteSearch(query, seq) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const signal = searchAbort.signal;

    try {
      let res = await apiFetch('/anime', {
        q: query,
        'page[size]': 8,
        'filter[has]': 'animethemes',
        'fields[anime]': 'id,name,slug'
      }, signal);
      if (!res.ok) res = await apiFetch('/anime', { q: query, 'page[size]': 8 }, signal);
      if (!res.ok) return;

      const data = await res.json();
      if (seq !== searchSeq || selectedAnime) return;   // résultat périmé

      const remote = (data.anime || []).map((a) => ({
        title: a.name,
        slug: a.slug,
        keys: [norm(a.name)]
      }));
      mergeSuggestions(remote);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('[Opening Quiz] Recherche impossible :', err);
    }
  }

  function mergeSuggestions(remote) {
    const base = suggestions.filter((s) => s.local);
    const extras = remote.filter((r) =>
      !base.some((b) => b.slug === r.slug || b.keys.includes(r.keys[0])));
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
   * Validation de la réponse
   * ------------------------------------------------------------------ */
  function sameAnime(guess, truth) {
    return truth.slugs.includes(guess.slug) || guess.keys.some((k) => truth.names.includes(k));
  }

  function addDetail(label, value) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = label;
    li.appendChild(strong);
    li.appendChild(document.createTextNode(' ' + value));
    detailsEl.appendChild(li);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!round || answered) return;

    // Anime : soit choisi dans la liste, soit tapé exactement
    let guess = selectedAnime;
    if (!guess) {
      const typed = norm(animeInput.value);
      guess = typed
        ? (suggestions.find((s) => s.keys.includes(typed)) || ANIMES.find((a) => a.keys.includes(typed)))
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

    answered = true;
    answerMsg.textContent = '';
    animeInput.disabled = true;
    openingInput.disabled = true;
    submitBtn.disabled = true;
    closeSuggestions();

    const animeOk = sameAnime(guess, round.anime);
    const numOk = num === round.number;

    let label, cls;
    if (animeOk && numOk) { label = 'Correct'; cls = 'correct'; }
    else if (animeOk) { label = 'Presque'; cls = 'presque'; }
    else { label = 'Faux'; cls = 'faux'; }

    verdictEl.textContent = label;
    verdictEl.className = 'verdict ' + cls;

    detailsEl.textContent = '';
    addDetail('Anime', round.anime.title);
    addDetail('Opening', String(round.number));

    const song = [round.songTitle, round.artists.length ? '— ' + round.artists.join(', ') : '']
      .filter(Boolean).join(' ');
    if (song) addDetail('Musique', song);

    resultCard.classList.remove('hidden');
    nextBtn.focus({ preventScroll: true });
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Petite fête quand tout est bon (effet défini dans js/fx.js)
    if (cls === 'correct' && typeof window.fxBurst === 'function') {
      const r = verdictEl.getBoundingClientRect();
      window.fxBurst(r.left + r.width / 2, r.top + r.height / 2, 34);
    }
  });

  nextBtn.addEventListener('click', loadRound);

  /* ------------------------------------------------------------------
   * Démarrage
   * ------------------------------------------------------------------ */
  updateLevelUI();
  loadRound();
})();
