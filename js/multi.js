/*
 * MODE MULTIJOUEUR
 * ----------------
 * Un joueur crée une room (code à 5 caractères), les autres la rejoignent avec ce code.
 * L'hôte règle les openings à venir (difficultés, nombre de 1 à 100, durée de l'extrait,
 * années, indices) et lance la partie. Tout le monde entend le même extrait ; l'opening n'est
 * révélé que lorsque TOUS les joueurs ont validé (ou abandonné). 1 point par réponse "Correct".
 *
 * Les navigateurs se parlent directement (WebRTC) grâce à PeerJS, chargé uniquement quand on
 * ouvre le multijoueur. Il n'y a aucun serveur de jeu : si l'hôte ferme la page, la room s'arrête.
 * Ce fichier a besoin de js/app.js (objet window.OQ).
 */
(() => {
  'use strict';

  const OQ = window.OQ;
  if (!OQ) return;

  const $ = (id) => document.getElementById(id);
  const MAX_PLAYERS = 20;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PEER_PREFIX = 'oqz-';
  const PEER_URLS = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ];
  const PEER_CONFIG = {
    debug: 0,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] }
  };
  const VERDICT_LABEL = { correct: 'Correct', presque: 'Presque', faux: 'Faux', gaveup: 'Abandon' };
  const LEVEL_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };

  const S = {
    role: null,            // 'host' | 'guest' | null
    peer: null,
    hostConn: null,
    code: '',
    myId: '',
    name: '',
    players: new Map(),    // id -> { id, name, score, conn? }
    settings: defaultSettings(),
    phase: 'idle',         // idle | lobby | loading | playing | reveal | ended
    n: 0,
    total: 0,
    answers: new Map(),    // (hôte) id -> verdict
    progress: null         // (invité) { answered, total }
  };

  function defaultSettings() {
    return { levels: ['easy', 'medium', 'hard'], rounds: 10, length: 5, yearMin: null, yearMax: null, hints: true };
  }

  /* ------------------------------------------------------------------
   * Outils
   * ------------------------------------------------------------------ */
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignoré */ } }
  };

  function setMsg(text) {
    $('mp-msg').textContent = text || '';
    $('mp-lobby-msg').textContent = text || '';
  }

  function loadPeerLib() {
    return new Promise((resolve, reject) => {
      if (window.Peer) { resolve(window.Peer); return; }
      let i = 0;
      const tryNext = () => {
        if (i >= PEER_URLS.length) { reject(new Error('PeerJS indisponible')); return; }
        const s = document.createElement('script');
        s.src = PEER_URLS[i++];
        s.onload = () => (window.Peer ? resolve(window.Peer) : tryNext());
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  // Ouvre une connexion au service de mise en relation ; id facultatif (hôte : id fixé par le code)
  function openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, PEER_CONFIG) : new Peer(PEER_CONFIG);
      const timer = setTimeout(() => { try { peer.destroy(); } catch (e) { /* ignoré */ } reject({ type: 'timeout' }); }, 12000);
      peer.on('open', () => { clearTimeout(timer); resolve(peer); });
      peer.on('error', (err) => { clearTimeout(timer); try { peer.destroy(); } catch (e) { /* ignoré */ } reject(err || { type: 'unknown' }); });
    });
  }

  function safeSend(conn, obj) {
    try { if (conn && conn.open !== false) conn.send(obj); } catch (e) { /* connexion fermée */ }
  }

  function broadcast(obj) {
    S.players.forEach((p) => { if (p.conn) safeSend(p.conn, obj); });
  }

  /* ------------------------------------------------------------------
   * Réglages de la partie (formulaire de l'hôte)
   * ------------------------------------------------------------------ */
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

  function readSettings() {
    const levels = ['easy', 'medium', 'hard'].filter((l) => $('mp-lvl-' + l).checked);
    const rounds = Math.min(100, Math.max(1, num($('mp-rounds').value) || 10));
    const length = Math.min(20, Math.max(0.1, Math.round((parseFloat(String($('mp-length').value).replace(',', '.')) || 5) * 10) / 10));
    let yearMin = num($('mp-year-min').value);
    let yearMax = num($('mp-year-max').value);
    if (yearMin && yearMax && yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
    return {
      levels: levels.length ? levels : ['easy', 'medium', 'hard'],
      rounds, length, yearMin, yearMax,
      hints: !!$('mp-hints').checked
    };
  }

  function writeSettings(s) {
    ['easy', 'medium', 'hard'].forEach((l) => { $('mp-lvl-' + l).checked = s.levels.includes(l); });
    $('mp-rounds').value = String(s.rounds);
    $('mp-length').value = String(s.length);
    $('mp-year-min').value = s.yearMin ? String(s.yearMin) : '';
    $('mp-year-max').value = s.yearMax ? String(s.yearMax) : '';
    $('mp-hints').checked = !!s.hints;
  }

  function summary(s) {
    const years = s.yearMin || s.yearMax ? ' · années ' + (s.yearMin || '…') + '–' + (s.yearMax || '…') : '';
    return 'Difficultés : ' + s.levels.map((l) => LEVEL_LABEL[l]).join(', ')
      + ' · ' + s.rounds + ' opening' + (s.rounds > 1 ? 's' : '')
      + ' · extrait ' + String(s.length).replace('.', ',') + ' s' + years
      + ' · indices ' + (s.hints ? 'autorisés' : 'désactivés');
  }

  /* ------------------------------------------------------------------
   * Affichage : salon, bandeau, tableau des scores
   * ------------------------------------------------------------------ */
  function showView(name) {
    $('mp-start').classList.toggle('hidden', name !== 'start');
    $('mp-lobby').classList.toggle('hidden', name !== 'lobby');
  }

  function playersList() {
    return Array.from(S.players.values()).map((p) => ({ id: p.id, name: p.name, score: p.score }));
  }

  function renderLobby() {
    $('mp-room-code').textContent = S.code;
    $('mp-count').textContent = '(' + S.players.size + ')';

    const ul = $('mp-players');
    ul.textContent = '';
    S.players.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p.name + (p.id === S.myId ? ' (toi)' : '');
      if (S.role === 'host' && p.id === S.myId) li.className = 'is-host';
      if (S.phase !== 'lobby') {
        const sc = document.createElement('b');
        sc.textContent = ' ' + p.score + ' pt' + (p.score > 1 ? 's' : '');
        li.appendChild(sc);
      }
      ul.appendChild(li);
    });

    const inLobby = S.phase === 'lobby';
    const isHost = S.role === 'host';
    $('mp-settings').classList.toggle('hidden', !(isHost && inLobby));
    $('mp-summary').classList.toggle('hidden', isHost && inLobby);
    $('mp-summary').textContent = summary(S.settings);
    $('mp-begin').classList.toggle('hidden', !(isHost && inLobby));
    $('mp-wait-host').classList.toggle('hidden', !(S.role === 'guest' && inLobby));
  }

  function renderBar(override) {
    const bar = $('mp-bar');
    bar.classList.toggle('hidden', !OQ.mp.active);
    if (!OQ.mp.active) return;

    let text = override;
    if (!text) {
      const prog = S.role === 'host' ? { answered: S.answers.size, total: S.players.size } : S.progress;
      text = 'Room ' + S.code + ' · Opening ' + S.n + '/' + S.total;
      if (S.phase === 'playing' && prog) text += ' · Réponses ' + prog.answered + '/' + prog.total;
      if (S.phase === 'reveal') text += ' · Résultat';
      if (S.phase === 'ended') text += ' · Terminé';
    }
    $('mp-bar-text').textContent = text;
    $('mp-force').classList.toggle('hidden', !(S.role === 'host' && S.phase === 'playing'));
  }

  function renderScoreboard(title, rows, final) {
    $('sb-title').textContent = title;
    const list = $('sb-list');
    list.textContent = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.id === S.myId) li.className = 'me';
      const name = document.createElement('span');
      name.className = 'sb-name';
      name.textContent = (final ? (i + 1) + '. ' : '') + r.name;
      li.appendChild(name);
      if (r.verdict) {
        const v = document.createElement('span');
        v.className = 'sb-verdict ' + r.verdict;
        v.textContent = VERDICT_LABEL[r.verdict] || r.verdict;
        li.appendChild(v);
      }
      const sc = document.createElement('b');
      sc.className = 'sb-score';
      sc.textContent = r.score + ' pt' + (r.score > 1 ? 's' : '');
      li.appendChild(sc);
      list.appendChild(li);
    });
    $('scoreboard').classList.remove('hidden');
  }

  /* ------------------------------------------------------------------
   * Démarrage / arrêt de la partie côté interface
   * ------------------------------------------------------------------ */
  function startLocalGame() {
    OQ.enterMulti(S.settings);
    OQ.mp.onAnswer = onLocalAnswer;
    OQ.mp.onNext = onLocalNext;
    OQ.panel.close();
    renderBar();
  }

  function leaveGame(message) {
    try { if (S.role === 'guest' && S.hostConn) safeSend(S.hostConn, { t: 'leave' }); } catch (e) { /* ignoré */ }
    if (S.role === 'host') broadcast({ t: 'error', msg: 'L\'hôte a fermé la room.' });
    try { if (S.peer) S.peer.destroy(); } catch (e) { /* ignoré */ }

    const wasActive = OQ.mp.active;
    S.role = null; S.peer = null; S.hostConn = null; S.code = ''; S.myId = '';
    S.players = new Map(); S.answers = new Map(); S.progress = null;
    S.phase = 'idle'; S.n = 0; S.total = 0;

    $('mp-bar').classList.add('hidden');
    showView('start');
    setMsg(message || '');
    if (wasActive) OQ.exitMulti();
  }

  /* ------------------------------------------------------------------
   * HÔTE
   * ------------------------------------------------------------------ */
  async function createRoom() {
    const name = clean($('mp-name').value);
    if (!name) { setMsg('Choisis d\'abord un pseudo.'); return; }
    store.set('opening-quiz-name', name);
    setMsg('Création de la room…');

    let Peer;
    try { Peer = await loadPeerLib(); } catch (err) { setMsg('Module multijoueur indisponible (connexion ?).'); return; }

    let peer = null;
    let code = '';
    for (let i = 0; i < 6 && !peer; i++) {
      code = randomCode();
      try {
        peer = await openPeer(Peer, PEER_PREFIX + code);
      } catch (err) {
        if (err && err.type !== 'unavailable-id') { setMsg('Impossible de créer la room (' + (err.type || 'erreur') + ').'); return; }
      }
    }
    if (!peer) { setMsg('Impossible de créer la room, réessaie.'); return; }

    S.role = 'host';
    S.peer = peer;
    S.code = code;
    S.myId = peer.id;
    S.name = name;
    S.players = new Map([[peer.id, { id: peer.id, name, score: 0 }]]);
    S.settings = readSettings();
    S.phase = 'lobby';
    peer.on('connection', onGuestConnection);
    peer.on('error', (err) => console.warn('[Opening Quiz] Multijoueur :', err));

    setMsg('');
    writeSettings(S.settings);
    renderLobby();
    showView('lobby');
  }

  function onGuestConnection(conn) {
    conn.on('data', (msg) => hostOnMessage(conn, msg));
    conn.on('close', () => removePlayer(conn.peer));
    conn.on('error', () => removePlayer(conn.peer));
  }

  function uniqueName(name) {
    const taken = new Set(Array.from(S.players.values()).map((p) => p.name.toLowerCase()));
    let n = name; let i = 2;
    while (taken.has(n.toLowerCase())) n = name.slice(0, 13) + ' ' + i++;
    return n;
  }

  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (S.phase !== 'lobby') {
        safeSend(conn, { t: 'denied', reason: 'La partie a déjà commencé.' });
        setTimeout(() => { try { conn.close(); } catch (e) { /* ignoré */ } }, 300);
        return;
      }
      if (S.players.size >= MAX_PLAYERS) {
        safeSend(conn, { t: 'denied', reason: 'La room est pleine.' });
        return;
      }
      S.players.set(conn.peer, { id: conn.peer, name: uniqueName(clean(msg.name) || 'Joueur'), score: 0, conn });
      broadcastLobby();
    } else if (msg.t === 'answered') {
      if (S.phase !== 'playing' || !S.players.has(conn.peer)) return;
      S.answers.set(conn.peer, VERDICT_LABEL[msg.verdict] ? msg.verdict : 'faux');
      afterAnswer();
    } else if (msg.t === 'leave') {
      removePlayer(conn.peer);
    }
  }

  function broadcastLobby() {
    broadcast({ t: 'lobby', players: playersList(), settings: S.settings, hostId: S.myId, phase: S.phase });
    renderLobby();
  }

  function removePlayer(id) {
    if (S.role !== 'host' || !S.players.has(id) || id === S.myId) return;
    S.players.delete(id);
    S.answers.delete(id);
    if (S.phase === 'lobby') broadcastLobby();
    else if (S.phase === 'playing') afterAnswer();
    else { renderLobby(); renderBar(); }
  }

  function hostBegin() {
    if (S.role !== 'host' || S.phase !== 'lobby') return;
    S.settings = readSettings();
    S.total = S.settings.rounds;
    S.n = 0;
    S.players.forEach((p) => { p.score = 0; });
    S.phase = 'loading';
    broadcast({ t: 'start', settings: S.settings, total: S.total });
    startLocalGame();
    nextRound();
  }

  async function nextRound() {
    S.n++;
    S.answers.clear();
    S.phase = 'loading';
    broadcast({ t: 'loading', n: S.n, total: S.total });
    renderBar('Chargement de l\'opening ' + S.n + '/' + S.total + '…');

    const info = await OQ.hostRound({ levels: S.settings.levels, yearMin: S.settings.yearMin, yearMax: S.settings.yearMax });
    if (S.role !== 'host' || S.phase !== 'loading') return;      // la room a été fermée entre-temps
    if (!info) {
      broadcast({ t: 'error', msg: 'Impossible de charger un opening : la partie est interrompue.' });
      leaveGame('Impossible de charger un opening : la partie est interrompue.');
      return;
    }

    S.phase = 'playing';
    broadcast({ t: 'round', n: S.n, total: S.total, info: OQ.serializeInfo(info) });
    afterAnswer();                                               // met à jour le compteur (0/N)
  }

  function onLocalAnswer(verdict) {
    if (S.role === 'host') {
      S.answers.set(S.myId, verdict);
      afterAnswer();
    } else if (S.role === 'guest') {
      safeSend(S.hostConn, { t: 'answered', verdict });
    }
  }

  function afterAnswer() {
    if (S.phase !== 'playing') return;
    const total = S.players.size;
    broadcast({ t: 'progress', answered: S.answers.size, total });
    renderBar();
    if (S.answers.size >= total) reveal();
  }

  // L'hôte peut débloquer la partie si quelqu'un ne répond plus (les absents comptent comme abandon)
  function forceReveal() {
    if (S.role !== 'host' || S.phase !== 'playing') return;
    reveal();
  }

  function reveal() {
    if (S.phase !== 'playing') return;
    S.phase = 'reveal';
    const results = [];
    S.players.forEach((p) => {
      const verdict = S.answers.get(p.id) || 'gaveup';
      if (verdict === 'correct') p.score++;
      results.push({ id: p.id, name: p.name, verdict, score: p.score });
    });
    const last = S.n >= S.total;
    broadcast({ t: 'reveal', n: S.n, total: S.total, results, last });
    applyReveal(results, last);
  }

  function applyReveal(results, last) {
    S.phase = 'reveal';
    // Si on n'avait pas encore répondu (révélation forcée), on abandonne en silence
    if (!OQ.isAnswered()) {
      const keep = OQ.mp.onAnswer;
      OQ.mp.onAnswer = null;
      OQ.forceGiveUp();
      OQ.mp.onAnswer = keep;
    }
    OQ.showResult();

    const sorted = results.slice().sort((a, b) => b.score - a.score);
    renderScoreboard('Opening ' + S.n + '/' + S.total, sorted, false);

    const nextMsg = $('mp-next-msg');
    if (S.role === 'host') {
      OQ.nextBtn.classList.remove('hidden');
      OQ.nextBtn.textContent = last ? 'Voir le classement ➜' : 'Opening suivant ➜';
      nextMsg.classList.add('hidden');
    } else {
      OQ.nextBtn.classList.add('hidden');
      nextMsg.textContent = last ? 'En attente de l\'hôte pour le classement…' : 'En attente de l\'hôte pour la suite…';
      nextMsg.classList.remove('hidden');
    }
    renderLobby();
    renderBar();
  }

  function onLocalNext() {
    if (S.phase === 'ended') { leaveGame(); return; }
    if (S.role !== 'host' || S.phase !== 'reveal') return;
    if (S.n >= S.total) endGame(); else nextRound();
  }

  function endGame() {
    S.phase = 'ended';
    const ranking = playersList().sort((a, b) => b.score - a.score);
    broadcast({ t: 'end', ranking });
    applyEnd(ranking);
  }

  function applyEnd(ranking) {
    S.phase = 'ended';
    renderScoreboard('Classement final', ranking, true);
    $('mp-next-msg').classList.add('hidden');
    OQ.nextBtn.classList.remove('hidden');
    OQ.nextBtn.textContent = 'Quitter la partie';
    renderBar();
  }

  /* ------------------------------------------------------------------
   * INVITÉ
   * ------------------------------------------------------------------ */
  async function joinRoom() {
    const name = clean($('mp-name').value);
    const code = String($('mp-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!name) { setMsg('Choisis d\'abord un pseudo.'); return; }
    if (code.length !== 5) { setMsg('Le code de la room contient 5 caractères.'); return; }
    store.set('opening-quiz-name', name);
    setMsg('Connexion à la room…');

    let Peer;
    try { Peer = await loadPeerLib(); } catch (err) { setMsg('Module multijoueur indisponible (connexion ?).'); return; }

    let peer;
    try { peer = await openPeer(Peer); } catch (err) { setMsg('Connexion impossible (' + ((err && err.type) || 'erreur') + ').'); return; }

    S.peer = peer;
    S.code = code;
    S.myId = peer.id;
    S.name = name;

    let joined = false;
    const fail = (text) => {
      clearTimeout(timer);
      if (S.role === null || !joined) {
        try { peer.destroy(); } catch (e) { /* ignoré */ }
        S.peer = null; S.hostConn = null; S.role = null; S.phase = 'idle';
        setMsg(text);
      }
    };
    const timer = setTimeout(() => { if (!joined) fail('Room introuvable ou injoignable.'); }, 12000);

    peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') fail('Room introuvable. Vérifie le code.');
      else if (!joined) fail('Connexion impossible (' + ((err && err.type) || 'erreur') + ').');
    });

    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    S.hostConn = conn;
    conn.on('open', () => safeSend(conn, { t: 'hello', name }));
    conn.on('data', (msg) => {
      if (!joined && msg && msg.t === 'denied') { fail(msg.reason || 'Accès refusé.'); return; }
      if (!joined) { joined = true; clearTimeout(timer); S.role = 'guest'; }
      guestOnMessage(msg);
    });
    conn.on('close', () => { if (S.role === 'guest') leaveGame('L\'hôte a quitté la room.'); });
    conn.on('error', () => { if (S.role === 'guest') leaveGame('Connexion perdue.'); });
  }

  function guestOnMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'denied':
        leaveGame(msg.reason || 'Accès refusé.');
        break;
      case 'lobby':
        S.players = new Map(msg.players.map((p) => [p.id, p]));
        S.settings = msg.settings;
        if (S.phase === 'idle') S.phase = 'lobby';
        showView('lobby');
        setMsg('');
        renderLobby();
        break;
      case 'start':
        S.settings = msg.settings;
        S.total = msg.total;
        S.n = 0;
        S.phase = 'loading';
        startLocalGame();
        break;
      case 'loading':
        S.n = msg.n; S.total = msg.total; S.phase = 'loading'; S.progress = null;
        OQ.prepareWaiting('Opening ' + msg.n + '/' + msg.total + ' en préparation…');
        renderBar();
        break;
      case 'round':
        S.n = msg.n; S.total = msg.total; S.phase = 'playing'; S.progress = null;
        renderBar();
        OQ.guestRound(OQ.deserializeInfo(msg.info));
        break;
      case 'progress':
        S.progress = { answered: msg.answered, total: msg.total };
        renderBar();
        break;
      case 'reveal':
        msg.results.forEach((r) => { const p = S.players.get(r.id); if (p) p.score = r.score; else S.players.set(r.id, { id: r.id, name: r.name, score: r.score }); });
        S.n = msg.n; S.total = msg.total;
        applyReveal(msg.results, msg.last);
        break;
      case 'end':
        applyEnd(msg.ranking);
        break;
      case 'error':
        leaveGame(msg.msg || 'La partie a été interrompue.');
        break;
      default:
    }
  }

  /* ------------------------------------------------------------------
   * Boutons et formulaire
   * ------------------------------------------------------------------ */
  $('mp-name').value = store.get('opening-quiz-name', '');
  writeSettings(S.settings);

  $('mp-create').addEventListener('click', createRoom);
  $('mp-join').addEventListener('click', joinRoom);
  $('mp-code').addEventListener('input', () => {
    const el = $('mp-code');
    el.value = String(el.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });
  $('mp-begin').addEventListener('click', hostBegin);
  $('mp-leave').addEventListener('click', () => leaveGame());
  $('mp-bar-leave').addEventListener('click', () => leaveGame());
  $('mp-force').addEventListener('click', forceReveal);

  // Les réglages de l'hôte sont envoyés aux invités dès qu'ils changent
  $('mp-settings').addEventListener('change', () => {
    if (S.role !== 'host' || S.phase !== 'lobby') return;
    S.settings = readSettings();
    broadcastLobby();
  });

  $('mp-copy').addEventListener('click', async () => {
    const link = location.origin + location.pathname + '?room=' + S.code;
    try {
      await navigator.clipboard.writeText(link);
      $('mp-copy').textContent = 'Lien copié ✓';
    } catch (err) {
      $('mp-copy').textContent = S.code;
    }
    setTimeout(() => { $('mp-copy').textContent = 'Copier le lien'; }, 1800);
  });

  window.addEventListener('beforeunload', () => {
    if (S.role === 'guest') safeSend(S.hostConn, { t: 'leave' });
    if (S.role === 'host') broadcast({ t: 'error', msg: 'L\'hôte a fermé la room.' });
  });

  // Lien d'invitation : ...?room=ABCDE ouvre directement le multijoueur avec le code prérempli
  try {
    const wanted = new URLSearchParams(location.search).get('room');
    if (wanted) {
      $('mp-code').value = wanted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      OQ.panel.open('multi');
    }
  } catch (err) { /* ignoré */ }

  showView('start');
})();
