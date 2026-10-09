/*
 * BIBLIOTHÈQUE + PANNEAU
 * ----------------------
 * - Le panneau (onglets Bibliothèque / Listes / Multijoueur / Compte) s'ouvre depuis le menu.
 * - Bibliothèque : tous les openings possibles. Sans recherche, on parcourt les animes "faciles"
 *   et "moyens" ; en tapant un nom, on cherche dans TOUT le catalogue (openings difficiles compris).
 *   La difficulté est indiquée sur chaque OPENING (pas sur le nom de l'anime).
 * Ce fichier a besoin de js/app.js et js/lists.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ) return;

  const $ = (id) => document.getElementById(id);
  const TIER_LABEL = OQ.TIER_LABEL;
  const SEARCH_DELAY = 300;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ------------------------------------------------------------------
   * Panneau (onglets)
   * ------------------------------------------------------------------ */
  const panel = $('panel');
  const tabBtns = Array.from(document.querySelectorAll('.tab'));
  const panes = Array.from(document.querySelectorAll('.tabpane'));
  let currentTab = 'library';

  function showTab(name) {
    currentTab = name;
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    panes.forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
    if (name === 'library') initLibrary();
    document.dispatchEvent(new CustomEvent('oq:tab', { detail: name }));
  }

  OQ.panel = {
    open(tab) {
      panel.classList.remove('hidden');
      document.body.classList.add('panel-open');
      showTab(tab || currentTab);
    },
    close() {
      panel.classList.add('hidden');
      document.body.classList.remove('panel-open');
      stopPreview();
    }
  };

  tabBtns.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('panel-close').addEventListener('click', () => OQ.panel.close());
  panel.addEventListener('click', (e) => { if (e.target === panel) OQ.panel.close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden') && $('picker').classList.contains('hidden')) OQ.panel.close();
  });

  $('nav-library').addEventListener('click', () => OQ.panel.open('library'));
  $('nav-lists').addEventListener('click', () => OQ.panel.open('lists'));
  $('nav-multi').addEventListener('click', () => OQ.panel.open('multi'));
  $('nav-account').addEventListener('click', () => OQ.panel.open('account'));

  /* ------------------------------------------------------------------
   * Écoute d'un extrait (bibliothèque et listes)
   * ------------------------------------------------------------------ */
  const pAudio = new Audio();
  let pBtn = null;

  function stopPreview() {
    pAudio.pause();
    if (pBtn) { pBtn.textContent = '▶'; pBtn = null; }
  }
  pAudio.addEventListener('ended', stopPreview);
  document.addEventListener('oq:gameaudio', stopPreview);

  async function togglePreview(btn, themeId, knownUrl) {
    if (pBtn === btn) { stopPreview(); return; }
    stopPreview();
    OQ.pauseGame();
    pBtn = btn;
    btn.textContent = '…';
    try {
      let url = knownUrl;
      if (!url) {
        const cand = OQ.candidateFromTheme(await OQ.fetchTheme(themeId));
        url = cand && cand.url;
      }
      if (!url) throw new Error('pas d\'audio');
      if (pBtn !== btn) return;                 // l'utilisateur a cliqué ailleurs entre-temps
      pAudio.src = url;
      await pAudio.play();
      btn.textContent = '⏸';
    } catch (err) {
      console.warn('[Opening Quiz] Écoute impossible :', err);
      if (pBtn === btn) { btn.textContent = '✕'; pBtn = null; }
    }
  }
  OQ.preview = { toggle: togglePreview, stop: stopPreview };

  /* ------------------------------------------------------------------
   * Lignes d'opening
   * ------------------------------------------------------------------ */
  let listSyncs = [];                           // pour mettre à jour les boutons « ajouter à une liste »
  OQ.lists.subscribe(() => listSyncs.forEach((fn) => fn()));

  function renderRow(row) {
    const li = el('li', 'lib-row');
    li.appendChild(el('span', 'lib-num', '#' + row.number));

    const info = el('div', 'lib-song');
    info.appendChild(el('b', '', row.songTitle || 'Titre inconnu'));
    const meta = [row.artists.join(', '), OQ.fmtDate(row.season, row.year), row.entry].filter(Boolean).join(' · ');
    if (meta) info.appendChild(el('small', '', meta));
    li.appendChild(info);

    // La difficulté est affichée sur l'opening
    li.appendChild(el('span', 'pill ' + row.tier, TIER_LABEL[row.tier]));

    const play = el('button', 'btn secondary mini', '▶');
    play.type = 'button';
    play.title = 'Écouter';
    play.addEventListener('click', () => togglePreview(play, row.themeId, row.audio));
    li.appendChild(play);

    const add = el('button', 'btn secondary mini');
    add.type = 'button';
    const sync = () => {
      const n = OQ.lists.countFor(row.themeId);
      add.textContent = n ? '✓' : '＋';
      add.classList.toggle('on', n > 0);
      add.title = n ? 'Dans ' + n + ' liste(s) : modifier' : 'Ajouter à une liste';
    };
    sync();
    listSyncs.push(sync);
    add.addEventListener('click', () => {
      OQ.lists.openPicker({
        id: row.themeId, title: row.title, number: row.number, songTitle: row.songTitle,
        artists: row.artists, year: row.year, season: row.season, slug: row.slug, tier: row.tier,
        mal: '', cover: '', audio: '', video: ''
      });
    });
    li.appendChild(add);
    return li;
  }

  // Transforme les saisons d'une franchise en lignes (numéros continus, difficulté de chaque opening)
  function buildRows(members, anchorSlug, f, title) {
    const byTheme = new Map();
    members.forEach((m) => m.themes.forEach((t) => byTheme.set(t.id, { t, m })));
    const anchor = members.find((m) => m.slug === anchorSlug);
    return OQ.computeOps(members, anchorSlug).map((op) => {
      const ref = byTheme.get(op.themeId);
      const song = ref && ref.t.song;
      return {
        themeId: op.themeId,
        number: op.number,
        title,
        songTitle: song && song.title ? song.title : '',
        artists: song && Array.isArray(song.artists) ? song.artists.map((a) => a.name).filter(Boolean) : [],
        year: op.year,
        season: ref ? ref.m.season : '',
        slug: ref ? ref.m.slug : '',
        // l'entrée d'origine, quand ce n'est pas l'anime de départ (utile pour repérer une erreur)
        entry: ref && anchor && ref.m.slug !== anchor.slug ? ref.m.name : '',
        tier: f ? OQ.opTier(f, op) : 'hard'
      };
    });
  }

  /* ------------------------------------------------------------------
   * Bibliothèque
   * ------------------------------------------------------------------ */
  const libQ = $('lib-q');
  const libList = $('lib-list');
  const libInfo = $('lib-info');
  const chips = Array.from(document.querySelectorAll('.lib-chip'));
  const activeTiers = new Set(['easy', 'medium', 'hard']);
  let libReady = false;
  let libSeq = 0;
  let libTimer = 0;

  function chipsChanged() {
    chips.forEach((c) => c.classList.toggle('active', activeTiers.has(c.dataset.tier)));
    refreshLibrary();
  }
  chips.forEach((c) => c.addEventListener('click', () => {
    const t = c.dataset.tier;
    if (activeTiers.has(t)) { if (activeTiers.size > 1) activeTiers.delete(t); } else activeTiers.add(t);
    chipsChanged();
  }));

  libQ.addEventListener('input', () => {
    clearTimeout(libTimer);
    libTimer = setTimeout(refreshLibrary, SEARCH_DELAY);
  });

  function initLibrary() {
    if (libReady) return;
    libReady = true;
    chipsChanged();
  }

  function refreshLibrary() {
    const q = OQ.norm(libQ.value);
    if (q.length >= 2) searchCatalog(libQ.value.trim());
    else browseCurated();
  }

  // Sans recherche : la liste des animes faciles / moyens (sans étiquette de difficulté sur les animes)
  function browseCurated() {
    libSeq++;
    libList.textContent = '';
    listSyncs = [];
    const list = OQ.ANIMES
      .filter((f) => !f._dead)
      .filter((f) => Array.from(OQ.tierSet(f)).some((t) => activeTiers.has(t)))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));

    libInfo.textContent = activeTiers.has('hard') && activeTiers.size === 1
      ? 'Les openings difficiles sont les plus nombreux : écris un nom d\'anime dans la barre pour les chercher.'
      : list.length + ' animes. Écris un nom pour chercher dans tout le catalogue.';

    list.forEach((f) => {
      const d = el('details', 'lib-item');
      const s = el('summary');
      s.appendChild(el('span', 'lib-title', f.title));
      d.appendChild(s);
      const body = el('ul', 'lib-rows');
      d.appendChild(body);
      let loaded = false;
      d.addEventListener('toggle', async () => {
        if (!d.open || loaded) return;
        loaded = true;
        body.appendChild(el('li', 'lib-msg', 'Chargement…'));
        try {
          const rows = await loadCurated(f);
          body.textContent = '';
          const shown = rows.filter((r) => activeTiers.has(r.tier));
          if (!shown.length) body.appendChild(el('li', 'lib-msg', 'Aucun opening dans les difficultés sélectionnées.'));
          shown.forEach((r) => body.appendChild(renderRow(r)));
        } catch (err) {
          loaded = false;
          body.textContent = '';
          body.appendChild(el('li', 'lib-msg', 'Chargement impossible, réessaie.'));
        }
      });
      libList.appendChild(d);
    });
  }

  async function loadCurated(f) {
    const q = f.query || f.slug.replace(/_/g, ' ');
    const res = await OQ.fetchVariants('lib', '/anime', { q, 'filter[has]': 'animethemes', 'page[size]': 30 });
    if (!res || !res.ok) throw new Error('HTTP');
    const list = ((await res.json()).anime || []).map(OQ.entryInfo);
    OQ.indexEntries(list);
    const anchor = list.find((e) => e.slug === f.slug)
      || list.find((e) => f.keys.includes(OQ.keyOf(e.name)) && !OQ.BAD_FORMATS.has(e.format))
      || list.find((e) => f.keys.includes(OQ.keyOf(e.name)));
    if (!anchor) return [];
    const key = OQ.keyOf(anchor.name);
    const members = list.filter((e) => OQ.keyOf(e.name) === key);
    if (!members.some((m) => m.slug === anchor.slug)) members.push(anchor);
    return buildRows(members, anchor.slug, f, f.title);
  }

  // Avec une recherche : tout le catalogue, saisons regroupées
  async function searchCatalog(query) {
    const seq = ++libSeq;
    libList.textContent = '';
    listSyncs = [];
    libInfo.textContent = 'Recherche…';
    try {
      let res = await OQ.fetchVariants('lib', '/anime', { q: query, 'filter[has]': 'animethemes', 'page[size]': 20 });
      if (res && (res.status === 400 || res.status === 422)) {
        res = await OQ.fetchVariants('lib', '/anime', { q: query, 'page[size]': 20 });
      }
      if (seq !== libSeq) return;
      if (!res || !res.ok) throw new Error('HTTP');
      const entries = ((await res.json()).anime || []).map(OQ.entryInfo);
      OQ.indexEntries(entries);

      const groups = new Map();
      entries.forEach((e) => {
        const k = OQ.keyOf(e.name);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
      });

      let shownGroups = 0;
      groups.forEach((members) => {
        const sorted = members.slice().sort((a, b) => (a.year - b.year));
        const anchor = sorted.find((m) => !OQ.BAD_FORMATS.has(m.format)) || sorted[0];
        const f = OQ.findCurated(anchor);
        const title = f ? f.title : OQ.cleanTitle(anchor.english || anchor.name);
        const rows = buildRows(members, anchor.slug, f, title).filter((r) => activeTiers.has(r.tier));
        if (!rows.length) return;

        const d = el('details', 'lib-item');
        if (shownGroups < 2) d.open = true;
        const s = el('summary');
        s.appendChild(el('span', 'lib-title', title));
        s.appendChild(el('span', 'lib-count', rows.length + ' opening' + (rows.length > 1 ? 's' : '')));
        d.appendChild(s);
        const body = el('ul', 'lib-rows');
        rows.forEach((r) => body.appendChild(renderRow(r)));
        d.appendChild(body);
        libList.appendChild(d);
        shownGroups++;
      });

      libInfo.textContent = shownGroups
        ? shownGroups + ' anime' + (shownGroups > 1 ? 's' : '') + ' trouvé' + (shownGroups > 1 ? 's' : '')
        : 'Aucun résultat dans les difficultés sélectionnées.';
    } catch (err) {
      if (seq !== libSeq) return;
      libInfo.textContent = 'Recherche impossible pour le moment (connexion ?).';
    }
  }
})();
