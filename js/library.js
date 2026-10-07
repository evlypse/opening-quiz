/*
 * BIBLIOTHÈQUE + FAVORIS
 * ----------------------
 * - Bibliothèque : tous les openings possibles. Sans recherche, on parcourt les animes "faciles"
 *   et "moyens" ; en tapant un nom, on cherche dans TOUT le catalogue (openings difficiles compris).
 *   Chaque opening affiche son numéro, sa musique, sa date et sa difficulté.
 * - Favoris : les openings marqués d'un cœur à la fin d'un round (ou ici).
 * Ce fichier a besoin de js/app.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ) return;

  const $ = (id) => document.getElementById(id);
  const TIER_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };
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
    if (name === 'favs') renderFavs();
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
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) OQ.panel.close();
  });

  $('nav-library').addEventListener('click', () => OQ.panel.open('library'));
  $('nav-favs').addEventListener('click', () => OQ.panel.open('favs'));
  $('nav-multi').addEventListener('click', () => OQ.panel.open('multi'));

  /* ------------------------------------------------------------------
   * Écoute d'un extrait (bibliothèque et favoris)
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

  /* ------------------------------------------------------------------
   * Lignes d'opening
   * ------------------------------------------------------------------ */
  function renderRow(row) {
    const li = el('li', 'lib-row');
    li.appendChild(el('span', 'lib-num', '#' + row.number));

    const info = el('div', 'lib-song');
    info.appendChild(el('b', '', row.songTitle || 'Titre inconnu'));
    const meta = [row.artists.join(', '), OQ.fmtDate(row.season, row.year)].filter(Boolean).join(' · ');
    if (meta) info.appendChild(el('small', '', meta));
    li.appendChild(info);

    li.appendChild(el('span', 'pill ' + row.tier, TIER_LABEL[row.tier]));

    const play = el('button', 'btn secondary mini', '▶');
    play.type = 'button';
    play.title = 'Écouter';
    play.addEventListener('click', () => togglePreview(play, row.themeId, row.audio));
    li.appendChild(play);

    if (row.id !== undefined) {
      const heart = el('button', 'btn secondary mini heart-mini');
      heart.type = 'button';
      const sync = () => {
        const on = OQ.favs.has(row.themeId);
        heart.textContent = on ? '♥' : '♡';
        heart.classList.toggle('on', on);
        heart.title = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
      };
      sync();
      heart.addEventListener('click', () => {
        OQ.favs.toggle({
          id: row.themeId, title: row.title, number: row.number, songTitle: row.songTitle,
          artists: row.artists, year: row.year, season: row.season, slug: row.slug, tier: row.tier,
          mal: '', cover: '', audio: '', video: ''
        });
        sync();
      });
      li.appendChild(heart);
    }
    return li;
  }

  // Transforme les saisons d'une franchise en lignes (numéros continus, difficulté de chaque opening)
  function buildRows(members, anchorSlug, f, title) {
    const byTheme = new Map();
    members.forEach((m) => m.themes.forEach((t) => byTheme.set(t.id, { t, m })));
    return OQ.computeOps(members, anchorSlug).map((op) => {
      const ref = byTheme.get(op.themeId);
      const song = ref && ref.t.song;
      return {
        id: op.themeId,
        themeId: op.themeId,
        number: op.number,
        title,
        songTitle: song && song.title ? song.title : '',
        artists: song && Array.isArray(song.artists) ? song.artists.map((a) => a.name).filter(Boolean) : [],
        year: op.year,
        season: ref ? ref.m.season : '',
        slug: ref ? ref.m.slug : '',
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

  // Sans recherche : la liste des animes faciles / moyens
  function browseCurated() {
    libSeq++;
    libList.textContent = '';
    const list = OQ.ANIMES
      .filter((f) => !f._dead)
      .filter((f) => activeTiers.has(f.tier)
        || (!f.keep && f.tier === 'easy' && activeTiers.has('medium'))
        || Object.values(f.ops || {}).some((t) => activeTiers.has(t)))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));

    libInfo.textContent = activeTiers.has('hard') && activeTiers.size === 1
      ? 'Les openings difficiles sont les plus nombreux : écris un nom d\'anime dans la barre pour les chercher.'
      : list.length + ' animes. Écris un nom pour chercher dans tout le catalogue.';

    list.forEach((f) => {
      const d = el('details', 'lib-item');
      const s = el('summary');
      s.appendChild(el('span', 'lib-title', f.title));
      s.appendChild(el('span', 'pill ' + f.tier, TIER_LABEL[f.tier]));
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
    libInfo.textContent = 'Recherche…';
    try {
      let res = await OQ.fetchVariants('lib', '/anime', { q: query, 'filter[has]': 'animethemes', 'page[size]': 20 });
      if (res && (res.status === 400 || res.status === 422)) {
        res = await OQ.fetchVariants('lib', '/anime', { q: query, 'page[size]': 20 });
      }
      if (seq !== libSeq) return;
      if (!res || !res.ok) throw new Error('HTTP');
      const entries = ((await res.json()).anime || []).map(OQ.entryInfo);

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

  /* ------------------------------------------------------------------
   * Favoris
   * ------------------------------------------------------------------ */
  const favsList = $('favs-list');
  const favsInfo = $('favs-info');
  const navFavs = $('nav-favs');

  function updateNavCount() {
    const n = OQ.favs.list().length;
    navFavs.textContent = '♥ Favoris' + (n ? ' (' + n + ')' : '');
  }

  function renderFavs() {
    favsList.textContent = '';
    const list = OQ.favs.list();
    favsInfo.textContent = list.length
      ? list.length + ' opening' + (list.length > 1 ? 's' : '') + ' en favori'
      : 'Aucun favori pour l\'instant. Clique sur le cœur après avoir répondu à un opening, ou dans la bibliothèque.';

    list.forEach((fav) => {
      const li = el('li', 'lib-row fav-row');
      li.appendChild(el('span', 'lib-num', '#' + fav.number));

      const info = el('div', 'lib-song');
      info.appendChild(el('b', '', fav.title));
      const meta = [fav.songTitle, (fav.artists || []).join(', '), OQ.fmtDate(fav.season, fav.year)]
        .filter(Boolean).join(' · ');
      if (meta) info.appendChild(el('small', '', meta));
      li.appendChild(info);

      if (fav.tier) li.appendChild(el('span', 'pill ' + fav.tier, TIER_LABEL[fav.tier]));

      const play = el('button', 'btn secondary mini', '▶');
      play.type = 'button';
      play.title = 'Écouter';
      play.addEventListener('click', () => togglePreview(play, fav.id, fav.audio));
      li.appendChild(play);

      if (fav.video) {
        const v = el('a', 'btn secondary mini', '🎬');
        v.href = fav.video;
        v.target = '_blank';
        v.rel = 'noopener noreferrer';
        v.title = 'Voir la vidéo';
        li.appendChild(v);
      }
      if (fav.mal) {
        const m = el('a', 'btn secondary mini', 'MAL');
        m.href = fav.mal;
        m.target = '_blank';
        m.rel = 'noopener noreferrer';
        m.title = 'Fiche MyAnimeList';
        li.appendChild(m);
      }

      const rm = el('button', 'btn secondary mini heart-mini on', '♥');
      rm.type = 'button';
      rm.title = 'Retirer des favoris';
      rm.addEventListener('click', () => { OQ.favs.remove(fav.id); });
      li.appendChild(rm);

      favsList.appendChild(li);
    });
  }

  OQ.favs.subscribe(() => {
    updateNavCount();
    if (currentTab === 'favs' && !panel.classList.contains('hidden')) renderFavs();
  });
  updateNavCount();
})();
