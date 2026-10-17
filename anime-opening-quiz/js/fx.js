/*
 * EFFETS INTERACTIFS (purement décoratifs)
 * ----------------------------------------
 * 1. Des petits points apparaissent là où passe la souris, puis s'envolent et disparaissent.
 * 2. Un clic (ou une touche sur téléphone) fait jaillir quelques points.
 * 3. Les grosses formes du fond s'écartent doucement quand la souris s'en approche.
 * 4. window.fxBurst(x, y, n) : gerbe de confettis (utilisée quand la réponse est "Correct").
 *
 * Pour tout désactiver : retire la ligne <script src="js/fx.js"></script> dans index.html.
 * Les effets sont aussi coupés si le système demande de réduire les animations.
 */
(() => {
  'use strict';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    window.fxBurst = () => {};
    return;
  }

  // Réglages faciles à modifier
  const COLORS = ['#8c6cf0', '#c8b6ff', '#7c86f2', '#6a47d8', '#cbcbdb'];
  const TRAIL_STEP = 60;      // distance (px) entre deux points de la traînée (plus grand = moins de points)
  const MAX_DOTS = 40;       // nombre maximal de points affichés en même temps
  const REPEL_REACH = 260;    // distance (px) à partir de laquelle les formes s'écartent
  const REPEL_FORCE = 90;     // déplacement maximal (px) des formes

  let live = 0;

  function dot(x, y, opts = {}) {
    if (live >= MAX_DOTS) return;

    const el = document.createElement('div');
    el.className = 'fx-dot';

    const size = opts.size || 3 + Math.random() * 3;
    const life = opts.life || 500 + Math.random() * 400;
    const angle = Math.random() * Math.PI * 2;
    const dist = opts.dist || 8 + Math.random() * 16;
    const rise = opts.rise === undefined ? 10 : opts.rise;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.background = color;
    el.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    el.style.setProperty('--dy', Math.sin(angle) * dist - rise + 'px');
    el.style.setProperty('--life', life + 'ms');
    if (Math.random() < 0.3) el.style.borderRadius = '2px';   // quelques petits carrés

    document.body.appendChild(el);
    live++;
    setTimeout(() => {
      el.remove();
      live--;
    }, life + 80);
  }

  function burst(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) dot(x, y, opts);
  }

  window.fxBurst = (x, y, n = 18) => {
    burst(x, y, n, { size: 4 + Math.random() * 4, dist: 40 + Math.random() * 70, rise: 24, life: 800 + Math.random() * 500 });
  };

  /* --- 1. Traînée de points sous la souris --- */
  let lastX = -1000;
  let lastY = -1000;

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;     // sur téléphone, on ne gêne pas le défilement
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (dx * dx + dy * dy < TRAIL_STEP * TRAIL_STEP) return;
    lastX = e.clientX;
    lastY = e.clientY;
    dot(lastX, lastY);
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    scheduleRepel();
  }, { passive: true });

  /* --- 2. Petite gerbe au clic / à la touche --- */
  window.addEventListener('pointerdown', (e) => {
    burst(e.clientX, e.clientY, 4, { dist: 14 + Math.random() * 20, life: 500 + Math.random() * 300 });
  }, { passive: true });

  /* --- 3. Les formes du fond s'écartent de la souris --- */
  const shapes = Array.from(document.querySelectorAll('.deco span'));
  let centers = [];
  const pointer = { x: -9999, y: -9999 };
  let queued = false;

  function measure() {
    // offsetLeft/offsetTop ne dépendent pas des animations : pas d'effet de boucle
    centers = shapes.map((el) => ({
      el,
      x: el.offsetLeft + el.offsetWidth / 2,
      y: el.offsetTop + el.offsetHeight / 2,
      r: el.offsetWidth / 2
    }));
  }

  function applyRepel() {
    queued = false;
    centers.forEach((c) => {
      const dx = c.x - pointer.x;
      const dy = c.y - pointer.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = REPEL_REACH + c.r;
      if (d < reach) {
        const push = (1 - d / reach) * REPEL_FORCE;
        c.el.style.transform = `translate(${(dx / d) * push}px, ${(dy / d) * push}px)`;
      } else {
        c.el.style.transform = '';
      }
    });
  }

  function scheduleRepel() {
    if (queued || !centers.length) return;
    queued = true;
    requestAnimationFrame(applyRepel);
  }

  measure();
  window.addEventListener('resize', measure);
  document.addEventListener('mouseleave', () => {
    pointer.x = pointer.y = -9999;
    scheduleRepel();
  });
})();
