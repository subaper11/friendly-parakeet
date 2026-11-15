// Room chat (V6 request 3): the word log doubles as a chat box while playing online.
//   * Who: the players and the Judge. A spectator neither writes nor reads (the Tahkim discussion is private too).
//   * Ephemeral by design: nothing is stored on the server. A message travels in my PRESENCE state (the only channel browsers may speak on: Supabase presence, allowed to
//     players and the Judge by the database policy; broadcasts are server-only). It disappears on a refresh and a latecomer sees at most the last CHAT_KEEP lines the others still hold.
//   * Notification: only in the chat itself: a badge on the "chat" tab (and on the log button / drawer toggle when the log is closed) and a screen-reader line. Nothing is ever
//     written into the word log or the decision log.
//   * Known limit: presence keys are chosen by the client, so a member could forge the sender of a line. Names are always looked up from the room's roster by key; unknown keys are
//     ignored; text is only ever rendered with textContent. (Same limit as the live tile preview; nothing in the game depends on it.)
const $ = s => document.querySelector(s);
const CHAT_KEEP = 12, MAX_LEN = 200, MIN_GAP = 600, LOG_MAX = 200;
const clean = t => String(t ?? '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

const st = { net: null, track: null, out: [], n: 0, log: [], last: {}, seeded: {}, unread: 0, tab: 'words', lastSend: 0, wired: false };

export function initChat(net, track) { st.net = net; st.track = track; wire(); refresh(); }
const canChat = () => !!st.net?.snap && ['player', 'judge'].includes(st.net.snap.me.role) && ['lobby', 'active', 'tahkim_pending', 'finished'].includes(st.net.snap.game.status);

function who(key) {   // the room's own roster decides who a key is
  const s = st.net.snap; if (!s) return null;
  const p = s.players.find(x => x.player_id === key); if (p) return { nick: p.nickname, role: 'player', seat: p.seat };
  if (s.judge && s.judge.player_id === key) return { nick: s.judge.nickname, role: 'judge', seat: null };
  return null;
}

// Called with {playerId: presenceMeta} for everybody else in the channel on every presence change.
export function onPeers(map) {
  if (!canChat()) return;
  let added = 0;
  for (const [key, meta] of Object.entries(map || {})) {
    const w = who(key); if (!w || key === st.net.userId) continue;
    const list = Array.isArray(meta?.chat) ? meta.chat : [], first = !st.seeded[key]; st.seeded[key] = true;
    for (const m of list) {
      if (!m || !Number.isInteger(m.n) || m.n <= (st.last[key] ?? 0)) continue;
      const x = clean(m.x); if (!x) continue;
      st.last[key] = m.n;
      st.log.push({ key, nick: w.nick, role: w.role, n: m.n, t: Number.isFinite(m.t) ? m.t : Date.now(), x, mine: false, old: first });   // old: already in their state when I arrived (no badge)
      if (!first) added++;
    }
  }
  if (!added && !st.log.some(m => m.old && !m.shown)) return;
  st.log.sort((a, b) => a.t - b.t || a.n - b.n); if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  const fresh = st.log.filter(m => !m.mine && !m.old && !m.counted);
  if (fresh.length) {
    const visible = st.tab === 'chat' && chatVisible();
    for (const m of fresh) { m.counted = true; if (!visible) st.unread++; }
    if (!visible) announce(fresh[fresh.length - 1]);
  }
  paint();
}

export function sendChat(text) {
  const x = clean(text), now = Date.now();
  if (!x || !canChat() || now - st.lastSend < MIN_GAP) return false;
  st.lastSend = now; st.n += 1;
  const m = { n: st.n, t: now, x };
  st.out.push(m); if (st.out.length > CHAT_KEEP) st.out.shift();
  st.log.push({ key: st.net.userId, nick: st.net.snap.me.role === 'judge' ? (st.net.snap.judge?.nickname || '') : (who(st.net.userId)?.nick || ''), role: st.net.snap.me.role, n: m.n, t: now, x, mine: true, counted: true });
  st.track({ chat: st.out }); paint(); return true;
}

const chatVisible = () => { const h = $('#hist'); return !!h && !h.hidden && h.getClientRects().length > 0 && !$('#hChat').hidden; };

function announce(m) {   // a short line for screen readers + a toast; never an entry in the word log or the decision log
  const sr = $('#hBadgeSr'); if (sr) sr.textContent = `رسالة جديدة من ${m.nick}`;
  st.net.toast?.(`💬 ${m.nick}: ${m.x.length > 60 ? m.x.slice(0, 60) + '…' : m.x}`);
}

function setTab(tab) {
  st.tab = tab;
  const chat = tab === 'chat';
  for (const [id, on] of [['hTabW', !chat], ['hTabC', chat]]) { const b = $('#' + id); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const sel of ['#hBag', '#hList', '#hTk', '#hBest']) { const e = $(sel); if (e) e.classList.toggle('hHideTab', chat); }
  $('#hChat').hidden = !chat;
  document.documentElement.dataset.hTab = chat ? 'chat' : 'words';
  if (chat) { st.unread = 0; paintBadge(); const l = $('#hChatL'); l.scrollTop = l.scrollHeight; if (!matchMedia('(pointer:coarse)').matches) $('#hChatIn').focus(); }
}

function paintBadge() {
  const b = $('#hBadge'); if (!b) return;
  b.hidden = st.unread === 0; b.textContent = st.unread > 9 ? '9+' : String(st.unread);
  for (const sel of ['#bLog', '#hToggle']) { const e = $(sel); if (e) e.classList.toggle('hasChat', st.unread > 0 && st.tab !== 'chat' || (st.unread > 0 && !chatVisible())); }
}

function paint() {
  const L = $('#hChatL'); if (!L) return;
  const atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 40;
  const sig = st.log.map(m => m.key + m.n).join(',') + '|' + (st.net.snap?.judge?.nickname || '');
  if (L.dataset.sig !== sig) {
    L.dataset.sig = sig;
    L.replaceChildren(...st.log.map(m => {
      const li = document.createElement('li'); li.className = 'hcm' + (m.mine ? ' mine' : '') + (m.role === 'judge' ? ' judge' : '');
      const who_ = document.createElement('span'); who_.className = 'hcWho'; who_.textContent = (m.role === 'judge' ? '⚖ ' : '') + m.nick + (m.mine ? ' (أنت)' : '');
      const tx = document.createElement('span'); tx.className = 'hcTx'; tx.setAttribute('dir', 'auto'); tx.textContent = m.x;
      const at = document.createElement('span'); at.className = 'hcAt'; at.textContent = hhmm(m.t);
      li.append(who_, tx, at); return li;
    }));
    if (!st.log.length) { const e = document.createElement('li'); e.className = 'hcEmpty'; e.textContent = 'لا رسائل بعد. الدردشة مؤقتة وتختفي عند تحديث الصفحة.'; L.append(e); }
    if (atEnd || st.tab === 'chat') L.scrollTop = L.scrollHeight;
  }
  paintBadge();
}

// Show / hide the tabs for the viewer's role and keep the input state right (called from the session whenever a snapshot is applied).
export function refresh() {
  const tabs = $('#hTabs'); if (!tabs) return;
  const on = document.documentElement.dataset.online === 'true' && !!st.net?.snap && ['player', 'judge'].includes(st.net.snap.me.role);
  if (tabs.hidden === on) tabs.hidden = !on;
  if (!on) { if (st.tab === 'chat') setTab('words'); return; }
  const live = canChat(); $('#hChatIn').disabled = !live; $('#hChatSend').disabled = !live;
  $('#hChatNote').textContent = live ? 'الدردشة بين اللاعبين والحكم فقط، وتختفي عند تحديث الصفحة.' : 'الدردشة متاحة أثناء الغرفة فقط.';
  paint();
}

function wire() {
  if (st.wired) return; st.wired = true;
  $('#hTabW').addEventListener('click', () => setTab('words'));
  $('#hTabC').addEventListener('click', () => setTab('chat'));
  $('#hTabs').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setTab(st.tab === 'chat' ? 'words' : 'chat'); $('#' + (st.tab === 'chat' ? 'hTabC' : 'hTabW')).focus(); } });
  $('#hChatF').addEventListener('submit', e => { e.preventDefault(); const i = $('#hChatIn'); if (sendChat(i.value)) i.value = ''; i.focus(); });
  // the log button (drawer / floating) may open the log: when the chat tab is already selected it becomes visible, so the unread count clears
  document.addEventListener('click', () => { if (st.tab === 'chat' && st.unread && chatVisible()) { st.unread = 0; paintBadge(); } }, true);
}
