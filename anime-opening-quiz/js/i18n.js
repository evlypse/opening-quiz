/*
 * LANGUES DU SITE (français, anglais, espagnol, portugais, allemand)
 * ------------------------------------------------------------------
 * Le site est écrit en français : ce fichier traduit l'affichage à la volée, sans toucher au reste du code.
 *   - js/i18n-data.js (généré) contient les traductions : phrases exactes (I18N_ROWS), phrases avec des nombres ou
 *     des noms (I18N_RULES) et les paragraphes d'aide avec mise en forme (I18N_HTML).
 *   - Le choix de langue est retenu dans le navigateur ; sans choix, la langue du navigateur est utilisée
 *     (français, espagnol, portugais, allemand… et anglais pour toutes les autres).
 *   - Les titres d'animes, noms de chansons et pseudos ne sont jamais traduits.
 * Ce fichier doit être chargé AVANT js/app.js.
 */
(() => {
  'use strict';

  const LANGS = { fr: 'Français', en: 'English', es: 'Español', pt: 'Português', de: 'Deutsch' };
  const IDX = { en: 0, es: 1, pt: 2, de: 3 };
  const KEY = 'opening-quiz-lang';
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* ignoré */ } }
  };

  function detect() {
    const saved = store.get();
    if (saved && LANGS[saved]) return saved;
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    for (const l of list) {
      const c = String(l || '').slice(0, 2).toLowerCase();
      if (LANGS[c]) return c;
    }
    return 'en';
  }

  let lang = detect();

  /* ------------------------------------------------------------------
   * Dictionnaires
   * ------------------------------------------------------------------ */
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const MAP = new Map();
  (window.I18N_ROWS || []).forEach((r) => { MAP.set(norm(r[0]), r.slice(1)); });
  const RULES = (window.I18N_RULES || []).map((r) => ({ re: new RegExp(r[0]), to: r.slice(1) }));
  const HTMLS = window.I18N_HTML || {};

  // Traduit une chaîne (sans espaces de début/fin) : phrase exacte, puis règles à nombres ; sinon inchangée
  function conv(s, depth) {
    if (lang === 'fr' || !s) return s;
    const hit = MAP.get(s);
    if (hit) { const v = hit[IDX[lang]]; return v === undefined || v === null || v === '' ? s : v; }
    if ((depth || 0) > 3) return s;
    for (const r of RULES) {
      const m = r.re.exec(s);
      if (!m) continue;
      const tpl = r.to[IDX[lang]];
      if (tpl === undefined || tpl === null) continue;
      // $1 = groupe tel quel ; §1 = groupe traduit à son tour
      return tpl.replace(/([$§])(\d)/g, (_, k, n) => {
        const g = m[Number(n)] === undefined ? '' : m[Number(n)];
        return k === '§' ? conv(g, (depth || 0) + 1) : g;
      });
    }
    // Liste de mots connus séparés par des virgules (ex. genres : « Comédie, Ecchi »)
    if (s.indexOf(', ') > 0) {
      const parts = s.split(', ');
      if (parts.every((p) => MAP.has(p))) return parts.map((p) => conv(p, 9)).join(', ');
    }
    return s;
  }

  function t(str) {
    const s = String(str === null || str === undefined ? '' : str);
    if (lang === 'fr') return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m[2]) return s;
    return m[1] + conv(norm(m[2])) + m[3];
  }

  /* ------------------------------------------------------------------
   * Parcours du document : nœuds de texte et attributs
   * ------------------------------------------------------------------ */
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
  const textRec = new WeakMap();      // nœud -> { src (français), out (affiché) }
  const attrRec = new WeakMap();      // élément -> { attr: { src, out } }

  const skipped = (node) => {
    let inCount = false;                       // les nombres du texte d'aide se traduisent à part
    for (let n = node; n; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute('data-count')) inCount = true;
      if (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n')) return true;
      if (n.hasAttribute('data-i18n-html')) return !inCount;
    }
    return false;
  };

  function doText(n) {
    if (skipped(n)) return;
    const cur = n.nodeValue;
    const r = textRec.get(n);
    const src = r && cur === r.out ? r.src : cur;
    if (!/[A-Za-zÀ-ÿ]/.test(src)) { if (r) textRec.delete(n); return; }
    const out = t(src);
    if (out !== cur) n.nodeValue = out;
    textRec.set(n, { src, out });
  }

  function doAttr(el, a) {
    if (!el.hasAttribute || !el.hasAttribute(a) || skipped(el)) return;
    const cur = el.getAttribute(a);
    let rec = attrRec.get(el);
    if (!rec) { rec = {}; attrRec.set(el, rec); }
    const r = rec[a];
    const src = r && cur === r.out ? r.src : cur;
    const out = t(src);
    if (out !== cur) el.setAttribute(a, out);
    rec[a] = { src, out };
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (SKIP.has(root.tagName)) return;
      ATTRS.forEach((a) => doAttr(root, a));
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    let n = tw.nextNode();
    while (n) {
      if (n.nodeType === 3) doText(n); else ATTRS.forEach((a) => doAttr(n, a));
      n = tw.nextNode();
    }
  }

  /* ------------------------------------------------------------------
   * Paragraphes avec mise en forme (aide) : on remplace tout le contenu
   * ------------------------------------------------------------------ */
  const htmlOrig = new WeakMap();
  function applyHtml() {
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      if (!htmlOrig.has(el)) htmlOrig.set(el, el.innerHTML);
      const counts = {};
      el.querySelectorAll('[data-count]').forEach((c) => { counts[c.getAttribute('data-count')] = c.textContent; });
      const tr = HTMLS[el.getAttribute('data-i18n-html')];
      const html = lang === 'fr' ? htmlOrig.get(el) : ((tr && tr[IDX[lang]]) || htmlOrig.get(el));
      if (el.innerHTML !== html) el.innerHTML = html;
      el.querySelectorAll('[data-count]').forEach((c) => {
        const k = c.getAttribute('data-count');
        if (counts[k] !== undefined) c.textContent = counts[k];
      });
    });
  }

  let observer = null;
  function observe() {
    if (observer || !document.body) return;
    observer = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
        else r.addedNodes.forEach((n) => walk(n));
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function refresh() {
    document.documentElement.lang = lang;
    document.title = t(titleSrc);
    applyHtml();
    walk(document.body);
    const sel = document.getElementById('lang-select');
    if (sel && sel.value !== lang) sel.value = lang;
  }

  /* ------------------------------------------------------------------
   * Boîtes de dialogue du navigateur
   * ------------------------------------------------------------------ */
  ['alert', 'confirm', 'prompt'].forEach((name) => {
    const orig = window[name].bind(window);
    window[name] = (msg, def) => (name === 'prompt' ? orig(t(msg), def) : orig(t(msg)));
  });

  /* ------------------------------------------------------------------
   * API publique
   * ------------------------------------------------------------------ */
  let titleSrc = document.title;
  const api = {
    t,
    langs: LANGS,
    get lang() { return lang; },
    set(l) {
      if (!LANGS[l] || l === lang) return;
      lang = l;
      store.set(l);
      refresh();
      document.dispatchEvent(new CustomEvent('oq:lang', { detail: l }));
    }
  };
  window.I18N = api;

  function init() {
    titleSrc = document.title;
    const sel = document.getElementById('lang-select');
    if (sel) {
      Object.keys(LANGS).forEach((code) => {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = LANGS[code];
        o.setAttribute('data-no-i18n', '');
        sel.appendChild(o);
      });
      sel.value = lang;
      sel.addEventListener('change', () => api.set(sel.value));
    }
    refresh();
    observe();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
