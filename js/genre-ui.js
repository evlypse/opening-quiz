/*
 * GENRES : interface (cases à cocher)
 * -----------------------------------
 * - Sous le lecteur : le bloc « 🎭 Genres » (mode solo). Rien de coché = tous les openings.
 * - OQ.buildGenreChips(...) est aussi utilisé par le multijoueur (réglages de l'hôte).
 * Les données (liste des genres, genres de chaque anime) sont dans js/genres.js.
 * Ce fichier a besoin de js/app.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ) return;

  const $ = (id) => document.getElementById(id);
  const LIST = Array.isArray(window.GENRES) ? window.GENRES : [];
  const labelOf = (id) => { const g = LIST.find((x) => x.id === id); return g ? g.label : id; };

  OQ.genreLabel = labelOf;

  // Construit les pastilles dans `container`. getSet() donne l'ensemble coché, onToggle(id) est appelé au clic.
  // Renvoie une fonction qui remet les pastilles à jour.
  OQ.buildGenreChips = (container, getSet, onToggle) => {
    container.textContent = '';
    const chips = LIST.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lib-chip genre-chip';
      b.textContent = g.label;
      b.dataset.genre = g.id;
      b.addEventListener('click', () => onToggle(g.id));
      container.appendChild(b);
      return b;
    });
    const sync = () => {
      const set = getSet();
      chips.forEach((b) => {
        const on = set.has(b.dataset.genre);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    };
    sync();
    return sync;
  };

  /* ------------------------------------------------------------------
   * Mode solo
   * ------------------------------------------------------------------ */
  const box = $('genre-box');
  if (!box) return;
  const label = $('genre-label');
  const info = $('genre-info');

  function render() {
    const sel = OQ.getGenres();
    label.textContent = sel.length ? sel.map(labelOf).join(', ') : 'tous';
    box.classList.toggle('filtering', sel.length > 0);
    info.textContent = sel.length
      ? OQ.genreCount(sel) + ' anime(s) de la liste ont l\'un de ces genres. Les difficultés cochées en haut s\'appliquent toujours.'
      : 'Coche un ou plusieurs genres pour ne jouer que des openings de ce style. Rien de coché : tout le catalogue.';
    sync();
  }

  const sync = OQ.buildGenreChips($('genre-chips'), () => new Set(OQ.getGenres()), (id) => {
    const s = new Set(OQ.getGenres());
    if (s.has(id)) s.delete(id); else s.add(id);
    OQ.setGenres(Array.from(s));
    render();
  });

  $('genre-clear').addEventListener('click', () => { OQ.setGenres([]); render(); });

  // Si des genres étaient déjà cochés (gardés d'une visite à l'autre), on ouvre le bloc
  if (OQ.getGenres().length) box.open = true;
  render();

  /* ------------------------------------------------------------------
   * Années (mode solo) : ne jouer que les openings sortis entre deux années
   * ------------------------------------------------------------------ */
  const ybox = $('year-box');
  if (ybox) {
    const ymin = $('year-min'), ymax = $('year-max'), ylabel = $('year-label'), yinfo = $('year-info');
    const yrender = () => {
      const y = OQ.getYears();
      ylabel.textContent = y.min && y.max ? y.min + ' – ' + y.max : y.min ? 'depuis ' + y.min : y.max ? 'jusqu\'à ' + y.max : 'toutes';
      ybox.classList.toggle('filtering', !!(y.min || y.max));
      yinfo.textContent = 'Laisse vide pour ne pas limiter. Les difficultés cochées en haut s\'appliquent toujours.';
      if (document.activeElement !== ymin) ymin.value = y.min || '';
      if (document.activeElement !== ymax) ymax.value = y.max || '';
    };
    const apply = () => { OQ.setYears(parseInt(ymin.value, 10) || 0, parseInt(ymax.value, 10) || 0); yrender(); };
    ymin.addEventListener('change', apply);
    ymax.addEventListener('change', apply);
    $('year-clear').addEventListener('click', () => { ymin.value = ''; ymax.value = ''; apply(); });
    const y0 = OQ.getYears();
    if (y0.min || y0.max) ybox.open = true;
    yrender();
  }
})();
