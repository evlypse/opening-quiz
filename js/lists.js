/*
 * COMPTES + LISTES
 * ----------------
 * - Chacun peut créer un compte (pseudo, mot de passe facultatif) : les listes d'openings sont
 *   propres à chaque compte. Sans compte, on est en mode « invité ».
 * - Les comptes sont enregistrés DANS LE NAVIGATEUR (il n'y a pas de serveur) : pour retrouver ses
 *   listes sur un autre appareil, on les exporte puis on les importe depuis l'onglet Compte.
 * - Un opening peut être rangé dans plusieurs listes ; on peut créer, renommer et supprimer des listes.
 * Ce fichier a besoin de js/app.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ) return;

  const $ = (id) => document.getElementById(id);
  const ACC_KEY = 'oq-accounts-v1';
  const DATA_PREFIX = 'oq-lists-';
  const OLD_FAVS = 'opening-quiz-favs-v1';     // anciens favoris (avant les listes)

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignoré */ } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 30);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ------------------------------------------------------------------
   * Comptes
   * ------------------------------------------------------------------ */
  function loadAcc() {
    try {
      const o = JSON.parse(store.get(ACC_KEY, ''));
      if (o && Array.isArray(o.accounts)) return o;
    } catch (e) { /* données illisibles */ }
    return { accounts: [], current: null };
  }
  let acc = loadAcc();
  const saveAcc = () => store.set(ACC_KEY, JSON.stringify(acc));
  const pid = () => acc.current || 'guest';
  const currentAccount = () => acc.accounts.find((a) => a.id === acc.current) || null;

  async function hash(salt, pw) {
    const bytes = new TextEncoder().encode(salt + ':' + pw);
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;                       // repli simple si le navigateur n'a pas WebCrypto
    bytes.forEach((b) => { h ^= b; h = Math.imul(h, 16777619); });
    return 'f' + (h >>> 0).toString(16);
  }

  /* ------------------------------------------------------------------
   * Listes de l'utilisateur courant
   * ------------------------------------------------------------------ */
  const emptyData = () => ({ lists: [{ id: uid(), name: 'Favoris', items: [] }] });

  function loadData(id) {
    let d = null;
    try { d = JSON.parse(store.get(DATA_PREFIX + id, '')); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.lists)) d = { lists: [] };
    if (id === 'guest' && !d.lists.length) {          // reprise des anciens favoris
      try {
        const old = JSON.parse(store.get(OLD_FAVS, '[]')) || [];
        if (old.length) d.lists.push({ id: uid(), name: 'Favoris', items: old });
      } catch (e) { /* ignoré */ }
    }
    if (!d.lists.length) d = emptyData();
    return d;
  }
  let data = loadData(pid());
  const saveData = () => store.set(DATA_PREFIX + pid(), JSON.stringify(data));

  const listeners = [];
  const notify = () => listeners.forEach((fn) => fn());
  const commit = () => { saveData(); notify(); };

  const api = {
    all: () => data.lists,
    get: (id) => data.lists.find((l) => l.id === id),
    create(name) {
      const n = cleanName(name);
      if (!n) return null;
      const existing = data.lists.find((l) => l.name.toLowerCase() === n.toLowerCase());
      if (existing) return existing;
      const l = { id: uid(), name: n, items: [] };
      data.lists.push(l);
      commit();
      return l;
    },
    rename(id, name) {
      const l = api.get(id);
      const n = cleanName(name);
      if (!l || !n) return false;
      l.name = n;
      commit();
      return true;
    },
    remove(id) {
      if (data.lists.length <= 1) return false;         // il reste toujours au moins une liste
      data.lists = data.lists.filter((l) => l.id !== id);
      commit();
      return true;
    },
    has: (listId, itemId) => !!(api.get(listId) && api.get(listId).items.some((i) => i.id === itemId)),
    add(listId, entry) {
      const l = api.get(listId);
      if (!l || api.has(listId, entry.id)) return;
      l.items.unshift(entry);
      commit();
    },
    removeItem(listId, itemId) {
      const l = api.get(listId);
      if (!l) return;
      l.items = l.items.filter((i) => i.id !== itemId);
      commit();
    },
    countFor: (itemId) => data.lists.filter((l) => l.items.some((i) => i.id === itemId)).length,
    totalItems() {
      const ids = new Set();
      data.lists.forEach((l) => l.items.forEach((i) => ids.add(i.id)));
      return ids.size;
    },
    accountName() { const a = currentAccount(); return a ? a.name : null; },
    subscribe: (fn) => listeners.push(fn),
    openPicker: (entry) => openPicker(entry)
  };
  OQ.lists = api;

  /* ------------------------------------------------------------------
   * Fenêtre « Ajouter à une liste »
   * ------------------------------------------------------------------ */
  const picker = $('picker');
  let pickerEntry = null;

  function renderPicker() {
    $('picker-entry').textContent = pickerEntry
      ? pickerEntry.title + ' — opening ' + pickerEntry.number + (pickerEntry.songTitle ? ' · ' + pickerEntry.songTitle : '')
      : '';
    const ul = $('picker-lists');
    ul.textContent = '';
    api.all().forEach((l) => {
      const li = el('li');
      const label = el('label', 'picker-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = api.has(l.id, pickerEntry.id);
      cb.addEventListener('change', () => {
        if (cb.checked) api.add(l.id, pickerEntry); else api.removeItem(l.id, pickerEntry.id);
      });
      label.appendChild(cb);
      label.appendChild(el('span', 'picker-name', l.name));
      label.appendChild(el('small', '', l.items.length + ' opening' + (l.items.length > 1 ? 's' : '')));
      li.appendChild(label);
      ul.appendChild(li);
    });
  }

  function openPicker(entry) {
    if (!entry) return;
    pickerEntry = entry;
    $('picker-new').value = '';
    renderPicker();
    picker.classList.remove('hidden');
  }
  function closePicker() { picker.classList.add('hidden'); pickerEntry = null; }

  $('picker-close').addEventListener('click', closePicker);
  picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !picker.classList.contains('hidden')) closePicker(); });

  function createFromPicker() {
    const name = $('picker-new').value;
    if (!cleanName(name) || !pickerEntry) return;
    const l = api.create(name);
    if (l) api.add(l.id, pickerEntry);
    $('picker-new').value = '';
  }
  $('picker-create').addEventListener('click', createFromPicker);
  $('picker-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createFromPicker(); } });

  // Bouton de la fiche de résultat
  const listBtn = $('list-btn');
  function updateListBtn() {
    const r = OQ.getRound();
    const n = r ? api.countFor(r.themeId) : 0;
    listBtn.textContent = n ? '✓ Dans ' + n + ' liste' + (n > 1 ? 's' : '') : '＋ Ajouter à une liste';
    listBtn.classList.toggle('on', n > 0);
  }
  listBtn.addEventListener('click', () => openPicker(OQ.entryFromRound()));
  document.addEventListener('oq:result', updateListBtn);

  /* ------------------------------------------------------------------
   * Onglet « Listes »
   * ------------------------------------------------------------------ */
  let selectedListId = null;

  function currentList() {
    let l = api.get(selectedListId);
    if (!l) { l = api.all()[0]; selectedListId = l.id; }
    return l;
  }

  function renderLists() {
    const sel = $('lists-select');
    const cur = currentList();
    sel.textContent = '';
    api.all().forEach((l) => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.name + ' (' + l.items.length + ')';
      if (l.id === cur.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.value = cur.id;

    const who = api.accountName();
    $('lists-info').textContent = (who ? 'Compte : ' + who + ' · ' : 'Mode invité · ')
      + cur.items.length + ' opening' + (cur.items.length > 1 ? 's' : '') + ' dans « ' + cur.name + ' »';

    const ul = $('lists-rows');
    ul.textContent = '';
    if (!cur.items.length) {
      ul.appendChild(el('li', 'lib-msg', 'Cette liste est vide. Utilise « Ajouter à une liste » après une réponse, ou le bouton ＋ dans la bibliothèque.'));
    }
    cur.items.forEach((it) => {
      const li = el('li', 'lib-row fav-row');
      li.appendChild(el('span', 'lib-num', '#' + it.number));

      const info = el('div', 'lib-song');
      info.appendChild(el('b', '', it.title));
      const meta = [it.songTitle, (it.artists || []).join(', '), OQ.fmtDate(it.season, it.year)].filter(Boolean).join(' · ');
      if (meta) info.appendChild(el('small', '', meta));
      li.appendChild(info);

      if (it.tier) li.appendChild(el('span', 'pill ' + it.tier, OQ.TIER_LABEL[it.tier]));

      const play = el('button', 'btn secondary mini', '▶');
      play.type = 'button';
      play.title = 'Écouter';
      play.addEventListener('click', () => OQ.preview && OQ.preview.toggle(play, it.id, it.audio));
      li.appendChild(play);

      if (it.video) {
        const v = el('a', 'btn secondary mini', '🎬');
        v.href = it.video; v.target = '_blank'; v.rel = 'noopener noreferrer'; v.title = 'Voir la vidéo';
        li.appendChild(v);
      }
      if (it.mal) {
        const m = el('a', 'btn secondary mini', 'MAL');
        m.href = it.mal; m.target = '_blank'; m.rel = 'noopener noreferrer'; m.title = 'Fiche MyAnimeList';
        li.appendChild(m);
      }

      const rm = el('button', 'btn secondary mini', '✕');
      rm.type = 'button';
      rm.title = 'Retirer de cette liste';
      rm.addEventListener('click', () => api.removeItem(cur.id, it.id));
      li.appendChild(rm);

      ul.appendChild(li);
    });
  }

  $('lists-select').addEventListener('change', () => { selectedListId = $('lists-select').value; renderLists(); });
  $('lists-create').addEventListener('click', () => {
    const l = api.create($('lists-new').value);
    if (l) { selectedListId = l.id; $('lists-new').value = ''; renderLists(); }
  });
  $('lists-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lists-create').click(); } });
  $('lists-rename').addEventListener('click', () => {
    const cur = currentList();
    const name = window.prompt('Nouveau nom de la liste :', cur.name);
    if (name) api.rename(cur.id, name);
  });
  $('lists-delete').addEventListener('click', () => {
    const cur = currentList();
    if (api.all().length <= 1) { window.alert('Il doit rester au moins une liste.'); return; }
    if (window.confirm('Supprimer la liste « ' + cur.name + ' » et ses ' + cur.items.length + ' opening(s) ?')) api.remove(cur.id);
  });

  /* ------------------------------------------------------------------
   * Onglet « Compte »
   * ------------------------------------------------------------------ */
  const accMsg = (t) => { $('acc-msg').textContent = t || ''; };

  function renderAccount() {
    const a = currentAccount();
    $('acc-current').textContent = a ? 'Connecté : ' + a.name : 'Mode invité : tes listes sont gardées sur cet appareil, sans compte.';
    $('acc-logout').classList.toggle('hidden', !a);
    $('acc-delete').classList.toggle('hidden', !a);

    const sel = $('acc-select');
    sel.textContent = '';
    acc.accounts.forEach((x) => {
      const o = document.createElement('option');
      o.value = x.id;
      o.textContent = x.name + (x.hash ? ' 🔒' : '');
      sel.appendChild(o);
    });
    $('acc-login-block').classList.toggle('hidden', !acc.accounts.length);
    $('acc-keep-row').classList.toggle('hidden', !!a);
  }

  function afterSwitch(message) {
    selectedListId = null;
    renderAll();
    notify();
    accMsg(message || '');
  }

  function switchTo(id) {
    saveData();
    acc.current = id;
    saveAcc();
    data = loadData(pid());
    afterSwitch(id ? 'Connecté.' : 'Déconnecté : mode invité.');
  }

  async function createAccount() {
    const name = cleanName($('acc-name').value);
    if (name.length < 2) { accMsg('Choisis un pseudo (2 caractères minimum).'); return; }
    if (acc.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) { accMsg('Ce pseudo existe déjà sur cet appareil.'); return; }

    const pw = $('acc-newpass').value;
    const a = { id: uid(), name, salt: uid(), hash: null };
    if (pw) a.hash = await hash(a.salt, pw);

    const keep = !!$('acc-keep').checked && pid() === 'guest';
    const guestData = data;
    saveData();
    acc.accounts.push(a);
    acc.current = a.id;
    saveAcc();
    data = keep ? JSON.parse(JSON.stringify(guestData)) : emptyData();
    saveData();
    if (keep) store.set(DATA_PREFIX + 'guest', JSON.stringify(emptyData()));   // les listes ont été déplacées

    $('acc-name').value = '';
    $('acc-newpass').value = '';
    afterSwitch('Compte « ' + name + ' » créé.');
  }

  async function login() {
    const a = acc.accounts.find((x) => x.id === $('acc-select').value);
    if (!a) return;
    if (a.hash) {
      const h = await hash(a.salt, $('acc-pass').value);
      if (h !== a.hash) { accMsg('Mot de passe incorrect.'); return; }
    }
    $('acc-pass').value = '';
    switchTo(a.id);
  }

  function deleteAccount() {
    const a = currentAccount();
    if (!a) return;
    if (!window.confirm('Supprimer le compte « ' + a.name + ' » et toutes ses listes ?')) return;
    store.remove(DATA_PREFIX + a.id);
    acc.accounts = acc.accounts.filter((x) => x.id !== a.id);
    acc.current = null;
    saveAcc();
    data = loadData('guest');
    afterSwitch('Compte supprimé.');
  }

  function exportLists() {
    const a = currentAccount();
    const payload = { app: 'opening-quiz', version: 1, account: a ? a.name : 'invité', lists: data.lists };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'listes-openings-' + (a ? a.name : 'invite') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    accMsg('Sauvegarde téléchargée.');
  }

  function importLists(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (!payload || !Array.isArray(payload.lists)) throw new Error('format');
        let added = 0;
        payload.lists.forEach((src) => {
          if (!src || !src.name || !Array.isArray(src.items)) return;
          let l = data.lists.find((x) => x.name.toLowerCase() === String(src.name).toLowerCase());
          if (!l) { l = { id: uid(), name: cleanName(src.name), items: [] }; data.lists.push(l); }
          src.items.forEach((it) => {
            if (it && it.id !== undefined && !l.items.some((x) => x.id === it.id)) { l.items.push(it); added++; }
          });
        });
        commit();
        accMsg(added + ' opening(s) importé(s).');
      } catch (err) {
        accMsg('Fichier illisible : choisis une sauvegarde exportée par ce site.');
      }
    };
    reader.readAsText(file);
  }

  $('acc-create').addEventListener('click', createAccount);
  $('acc-login').addEventListener('click', login);
  $('acc-logout').addEventListener('click', () => switchTo(null));
  $('acc-delete').addEventListener('click', deleteAccount);
  $('acc-export').addEventListener('click', exportLists);
  $('acc-import').addEventListener('change', () => { importLists($('acc-import').files[0]); $('acc-import').value = ''; });

  /* ------------------------------------------------------------------
   * Menu : libellés des boutons
   * ------------------------------------------------------------------ */
  function updateNav() {
    const n = api.totalItems();
    $('nav-lists').textContent = 'Listes' + (n ? ' (' + n + ')' : '');
    const who = api.accountName();
    $('nav-account').textContent = '👤 ' + (who || 'Compte');
  }

  function renderAll() {
    renderLists();
    renderAccount();
    updateNav();
    updateListBtn();
    if (!picker.classList.contains('hidden') && pickerEntry) renderPicker();
  }

  api.subscribe(renderAll);
  document.addEventListener('oq:tab', (e) => {
    if (e.detail === 'lists') renderLists();
    if (e.detail === 'account') renderAccount();
  });
  renderAll();
})();
