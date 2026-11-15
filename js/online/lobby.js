// Online lobby: a full-screen flow instead of a modal dialog.
//   1. start   nickname, then "create a room" or "join with a code" (a ?room=CODE link opens here with the code filled in)
//   2. room    the waiting room: the code (copy / share a link), the player seats, the Judge slot and the spectator count (V6.0), the host's rules, ready / start
//   Joining asks for a ROLE (player / judge / spectator). The server decides what the joiner gets; the answer says which role they ended up with, and a refused player is offered "watch instead" (never switched silently).
// The lobby only renders snapshots and sends requests; the server owns every rule (who is host, who is ready, whether the game may start).
import { DURATIONS } from '../config.js';
import { TILE_MODES } from '../modes.js';
import { $ } from '../state.js';
import { esc } from '../names.js';
import { net, connect, enter, configured, resumeOpenGame } from './session.js';
import { rulesDetails } from '../wordrules.js';

const NICK = 'scrabble.online.nick';
let onBack = null, shown = '', busy = false, msg = '', tech = '', wired = false, snapNow = null, typedCode = '', typedRole = 'player', canWatch = false;
const SPEC_CAPS = [0, 5, 10, 20];
const ROLE_AR = { player: ['لاعب', 'Pemain'], judge: ['حَكَم', 'Wasit'], spectator: ['متفرّج', 'Penonton'] };

const root = () => $('#lobby');
const savedNick = () => { try { return localStorage.getItem(NICK) || ''; } catch { return ''; } };
const saveNick = v => { try { localStorage.setItem(NICK, v); } catch { /* storage unavailable */ } };
const linkFor = code => `${location.origin}${location.pathname}?room=${code}`;
const codeFromUrl = () => { try { return (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); } catch { return ''; } };

function open(back, auto = false) {
  onBack = back || null;
  const r = root(); r.hidden = false; document.body.classList.add('lobbyOn'); document.querySelector('.app').inert = true;
  wire();
  if (!configured()) return paint('off');
  paint('connecting');
  connect().then(() => resumeOpenGame()).then(resumed => { if (resumed) return; if (auto && !hasRoomLink()) return close(); paint('start'); })   // an automatic attempt with nothing to resume just shows the cover again
    .catch(e => { if (auto && !hasRoomLink()) return close(); msg = e?.info?.text || 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.'; tech = e?.info?.detail || ''; paint('error'); });
}
function close() {
  const r = root(); if (!r || r.hidden) return;
  r.hidden = true; shown = ''; snapNow = null; document.body.classList.remove('lobbyOn'); document.querySelector('.app').inert = false;
}
function show(snap) {   // called by the session for every lobby/starting snapshot
  snapNow = snap; const r = root();
  if (r.hidden) { r.hidden = false; document.body.classList.add('lobbyOn'); document.querySelector('.app').inert = true; wire(); }
  paint('room');
}

// ---------- rendering ----------
function paint(view) {
  const r = root(); let html;
  if (view === 'off') html = card('اللعب عبر الإنترنت', '<p class="lbNote">اللعب عبر الإنترنت غير مُفعّل في هذه النسخة: لم تُضبط قيمتا SUPABASE_URL وSUPABASE_ANON_KEY عند النشر. أضفهما في إعدادات المنصة (Vercel ← Settings ← Environment Variables) ثم أعد النشر. اللعب المحلي يعمل كالمعتاد.</p>', '<button class="btn" data-a="back">رجوع</button>');
  else if (view === 'connecting') html = card('اللعب عبر الإنترنت', '<p class="lbNote" role="status">جارٍ الاتصال…</p>', '<button class="btn" data-a="back">رجوع</button>');
  else if (view === 'error') html = card('اللعب عبر الإنترنت', `<p class="lbNote bad" role="alert">${esc(msg)}</p>${tech ? `<p class="lbNote tech">${esc(tech)}</p>` : ''}`, '<button class="btn yes" data-a="retry">إعادة المحاولة</button><button class="btn" data-a="back">رجوع</button>');
  else if (view === 'start') html = startView();
  else html = roomView(snapNow);
  const key = view + '|' + html;
  if (key === shown) return;
  shown = key; r.innerHTML = html;
  const f = r.querySelector('[data-focus]'); if (f && view !== 'room') f.focus({ preventScroll: true });
}
const card = (title, body, foot) => `<div class="lbCard"><h2 class="lbT">${title}</h2>${body}<div class="lbFoot">${foot}</div></div>`;
const startView = () => {
  const code = typedCode || codeFromUrl();
  return card('اللعب عبر الإنترنت', `
    <label class="lbLabel" for="lbNick">اسمك</label>
    <input id="lbNick" class="lbInput" maxlength="16" autocomplete="off" spellcheck="false" placeholder="لاعب" value="${esc(savedNick())}">
    <div class="lbSplit">
      <section class="lbBox"><h3>غرفة جديدة</h3><p class="lbNote">أنشئ غرفة وأرسل الرمز إلى صديقك.</p><button class="btn yes" data-a="create"${busy ? ' disabled' : ''}>إنشاء غرفة</button></section>
      <section class="lbBox"><h3>الانضمام</h3><label class="lbLabel" for="lbCode">رمز الغرفة</label>
        <input id="lbCode" class="lbInput lbCodeIn" maxlength="7" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" value="${esc(code)}"${code ? ' data-focus' : ''}>
        <span class="lbLabel" id="lbRoleL">انضم بصفتك</span>
        <div class="lbRow" role="group" aria-labelledby="lbRoleL">${Object.entries(ROLE_AR).map(([r, [ar, id]]) => `<button class="btn lbOpt" data-a="role" data-v="${r}" aria-pressed="${typedRole === r}">${ar} <small lang="id">${id}</small></button>`).join('')}</div>
        <button class="btn" data-a="join"${busy ? ' disabled' : ''}>انضمام</button>
        ${canWatch ? `<button class="btn yes" data-a="watch"${busy ? ' disabled' : ''}>المشاهدة بدلًا من اللعب</button>` : ''}</section>
    </div>
    <p class="lbNote bad" role="alert">${esc(msg)}</p>`, '<button class="btn" data-a="back">رجوع</button>');
};
function roomView(snap) {
  if (!snap) return card('الغرفة', '<p class="lbNote">…</p>', '');
  const g = snap.game, role = snap.me.role || 'player', host = snap.me.player_id === g.host_player_id, meSeat = snap.me.seat;
  // The room as a row of SLOTS (like a custom-match lobby): every seat the room is made for is a card; an empty one is a button that takes you there. Seats only say where you sit:
  // the turn order is drawn when the game starts. The Judge's chair and the gallery come in their own row underneath.
  const initial = nm => esc([...String(nm || '?')][0] || '?');
  const nSeats = Math.max(2, g.max_players || 2), canMove = role === 'player' || role === 'judge' || role === 'spectator';
  const seatRow = i => {
    const p = snap.players.find(x => x.seat === i);
    if (!p) return `<li class="lbSeat empty" data-slot="${i}"><button type="button" class="lbSlotBtn" data-a="slot" data-k="player" data-v="${i}"${canMove && !busy ? '' : ' disabled'} aria-label="الجلوس في المقعد ${i + 1}"><span class="lbAv plus" aria-hidden="true">+</span><span class="lbNo">${i + 1}</span><span class="lbWho">اجلس هنا <small lang="id">Duduk di sini</small></span><span class="lbTag wait">مقعد فارغ</span></button></li>`;
    const on = p.connection_state !== 'offline' && (p.idle_ms ?? 0) < 60000, isMe = p.player_id === snap.me.player_id;
    const tag = p.player_id === g.host_player_id ? '<span class="lbTag host">المضيف</span>' : p.ready ? '<span class="lbTag ok">جاهز ✓</span>' : '<span class="lbTag wait">لم يؤكد بعد</span>';
    return `<li class="lbSeat${isMe ? ' me' : ''}" data-slot="${i}" data-online="${on}"><span class="lbAv" aria-hidden="true">${initial(p.nickname)}</span><span class="lbNo">${i + 1}</span><span class="lbWho"><bdi>${esc(p.nickname)}</bdi>${isMe ? ' <small>(أنت)</small>' : ''}${on ? '' : ' <small>· غير متصل</small>'}</span>${tag}</li>`;
  };
  const seats = Array.from({ length: nSeats }, (_, i) => seatRow(i)).join('');
  const j = snap.judge, isHostMe = snap.me.player_id === g.host_player_id;
  const takeBtn = (kind, label, id, disabled, why) => `<button type="button" class="btn lbTake" data-a="slot" data-k="${kind}"${disabled || busy ? ' disabled' : ''}${why ? ` title="${why}"` : ''}>${label} <small lang="id">${id}</small></button>`;
  const judgeRow = !g.judge_enabled || g.word_judging === 'auto' ? '' : j
    ? `<li class="lbExtra judge${j.player_id === snap.me.player_id ? ' me' : ''}" data-online="${j.online}"><span class="lbAv" aria-hidden="true">⚖</span><span class="lbWho"><bdi>${esc(j.nickname)}</bdi>${j.player_id === snap.me.player_id ? ' <small>(أنت)</small>' : ''}</span><span class="lbTag ${j.online ? 'ok' : 'wait'}">حَكَم · ${j.online ? 'متصل' : 'غير متصل'}</span></li>`
    : `<li class="lbExtra empty judge"><span class="lbAv plus" aria-hidden="true">⚖</span><span class="lbWho">كرسي الحكم <small lang="id">Kursi wasit</small></span>${takeBtn('judge', 'كن الحكم', 'Jadi wasit', isHostMe, 'المضيف يبقى لاعبًا')}</li>`;
  const specs = snap.spectators || [];
  const specRow = `<li class="lbExtra spec${role === 'spectator' ? ' me' : ''}"><span class="lbAv" aria-hidden="true">👁</span><span class="lbWho">المتفرجون <small lang="id">Penonton</small> <b>${snap.spectator_count} / ${g.max_spectators}</b>${specs.length ? `<span class="lbSpecNames">${specs.map(x => `<bdi>${esc(x.nickname)}</bdi>${x.player_id === snap.me.player_id ? ' (أنت)' : ''}`).join('، ')}</span>` : ''}</span>${role === 'spectator' || g.max_spectators === 0 ? '' : takeBtn('spectator', 'شاهد', 'Tonton', isHostMe || snap.spectator_count >= g.max_spectators, isHostMe ? 'المضيف يبقى لاعبًا' : '')}</li>`;
  const modes = Object.values(TILE_MODES).map(m => `<button class="btn lbOpt" data-a="mode" data-v="${m.id}" aria-pressed="${g.tile_mode === m.id}"${host ? '' : ' disabled'}>${m.labelAr}</button>`).join('');
  const mins = DURATIONS.map(m => `<button class="btn lbOpt" data-a="min" data-v="${m}" aria-pressed="${g.minutes === m}"${host ? '' : ' disabled'}>${m}</button>`).join('');
  const live = [[1, 'مفعّل'], [0, 'مغلق']].map(([v, t]) => `<button class="btn lbOpt" data-a="live" data-v="${v}" aria-pressed="${g.live === !!v}"${host ? '' : ' disabled'}>${t}</button>`).join('');
  const judgeOpt = [[1, 'بحكم'], [0, 'بلا حكم']].map(([v, t]) => `<button class="btn lbOpt" data-a="judge" data-v="${v}" aria-pressed="${g.judge_enabled === !!v}"${host && !(v === 0 && j) ? '' : ' disabled'}>${t}</button>`).join('');
  const auto = g.word_judging === 'auto';
  const tlOpt = [[1, '٣٠ ثانية للدور'], [0, 'بلا مهلة']].map(([v, t]) => `<button class="btn lbOpt" data-a="tl" data-v="${v}" aria-pressed="${(g.turn_limit !== false) === !!v}"${host ? '' : ' disabled'}>${t}</button>`).join('');
  const wordOpt = [['tahkim', 'تحكيم اللاعبين'], ['auto', 'قاموس تلقائي']].map(([v, t]) => `<button class="btn lbOpt" data-a="wj" data-v="${v}" aria-pressed="${(g.word_judging || 'tahkim') === v}"${host ? '' : ' disabled'}>${t}</button>`).join('');
  const caps = SPEC_CAPS.map(n => `<button class="btn lbOpt" data-a="cap" data-v="${n}" aria-pressed="${g.max_spectators === n}"${host && n >= snap.spectator_count ? '' : ' disabled'}>${n}</button>`).join('');
  const guests = snap.players.filter(p => p.player_id !== g.host_player_id), full = snap.players.length >= 2, allReady = guests.length > 0 && guests.every(p => p.ready), mePl = snap.players.find(p => p.player_id === snap.me.player_id);
  const maxP = [2, 3, 4].map(n => `<button class="btn lbOpt" data-a="maxp" data-v="${n}" aria-pressed="${(g.max_players || 2) === n}"${host && n >= snap.players.length ? '' : ' disabled'}>${n}</button>`).join('');
  const act = role !== 'player' ? `<p class="lbNote" role="status">${role === 'judge' ? 'أنت الحكم: ستستدعيك اللاعبان عند الخلاف، وحكمك نهائي. تبدأ المباراة عندما يبدأها المضيف.' : 'أنت متفرّج: تشاهد المباراة عند بدئها دون رفوف أو أدوات لعب.'}</p>`
    : host
    ? `<button class="btn yes" data-a="start"${busy || !full || !allReady ? ' disabled' : ''}>${!full ? 'بانتظار الخصم…' : !allReady ? (guests.length > 1 ? 'بانتظار جاهزية اللاعبين…' : 'بانتظار جاهزية الخصم…') : `ابدأ المباراة (${snap.players.length} لاعبين)`}</button>`
    : `<button class="btn ${mePl?.ready ? '' : 'yes'}" data-a="ready" data-v="${mePl?.ready ? 0 : 1}"${busy ? ' disabled' : ''}>${mePl?.ready ? 'إلغاء الجاهزية' : 'أنا جاهز'}</button>`;
  const [ra, ri] = ROLE_AR[role];
  return card('غرفة اللعب', `
    <p class="lbRoleBadge" data-role="${role}">دورك: <b>${ra}</b> <small lang="id">${ri}</small></p>
    <div class="lbCodeBox"><span class="lbLabel">رمز الغرفة</span><b class="lbCode" dir="ltr" aria-label="رمز الغرفة ${g.room_code.split('').join(' ')}">${g.room_code}</b>
      <div class="lbRow"><button class="btn" data-a="copy" data-v="${g.room_code}">نسخ الرمز</button><button class="btn" data-a="share" data-v="${g.room_code}">مشاركة رابط</button></div></div>
    <h3 class="lbSlotsH">اللاعبون <small lang="id">Pemain</small></h3>
    <ol class="lbSlots" data-n="${nSeats}" style="--n:${nSeats}" aria-label="مقاعد اللاعبين">${seats}</ol>
    <p class="lbNote">اضغط مقعدًا فارغًا لتجلس فيه. ترتيب اللعب يُسحَب عند بدء المباراة، لا يتبع رقم المقعد (من 3 لاعبين).</p>
    <h3 class="lbSlotsH">الحكم والمتفرجون <small lang="id">Wasit &amp; penonton</small></h3>
    <ul class="lbExtras" aria-label="الحكم والمتفرجون">${judgeRow}${specRow}</ul>
    <div class="lbRules"><div><span class="lbLabel">نمط القطع</span><div class="lbRow">${modes}</div></div><div><span class="lbLabel">وقت كل لاعب (دقيقة)</span><div class="lbRow">${mins}</div></div><div><span class="lbLabel">عرض القطع التي تجرّبها للخصم مباشرةً</span><div class="lbRow">${live}</div><p class="lbNote">عند التفعيل يرى الخصم القطع التي تضعها قبل الاحتساب (ظلال متقطعة).</p></div>
      <div><span class="lbLabel">عدد اللاعبين (2–4)</span><div class="lbRow">${maxP}</div><p class="lbNote">يمكن للمضيف بدء المباراة بالمقاعد المشغولة (لاعبان على الأقل). بين 3 و4 لاعبين: تحكيم اللاعبين بالأغلبية، ومن ينسحب أو ينتهي وقته يخرج وتستمر المباراة.</p></div>
      <div><span class="lbLabel">مهلة الدور</span><div class="lbRow">${tlOpt}</div><p class="lbNote">من لم يلعب خلال ٣٠ ثانية من بداية دوره يُتخطّى دوره تلقائيًا ويمرّ الدور للاعب التالي. يتوقف العدّ أثناء الإيقاف واستدعاء الحكم.</p></div>
      <div><span class="lbLabel">الحكم على الكلمات</span><div class="lbRow">${wordOpt}</div><p class="lbNote">${auto ? 'القاموس يفحص كل حركة عند احتسابها: الكلمة غير المعروفة تُرفض فورًا ويُرجَع اللاعب لتعديلها، والمشكوك فيها تُقبل. لا يوجد تحكيم ولا حكم في هذه الغرفة.' : 'عند الخلاف يطلب اللاعب التحكيم ويتفق اللاعبان (أو يحكم الحكم). اختر «قاموس تلقائي» لإلغاء التحكيم نهائيًا في هذه الغرفة.'}</p></div>
      ${auto ? '' : `<div><span class="lbLabel">الحكم</span><div class="lbRow">${judgeOpt}</div><p class="lbNote">مع الحكم يستدعيه اللاعب عند الخلاف (حتى 3 مرات) وحكمه نهائي. بدونه يتفق اللاعبان على الحكم.</p></div>`}
      <div><span class="lbLabel">أقصى عدد للمتفرجين</span><div class="lbRow">${caps}</div></div></div>
    ${rulesDetails()}
    ${host ? '' : '<p class="lbNote">المضيف يحدد القواعد.</p>'}<p class="lbNote bad" role="alert">${esc(msg)}</p>`, `${act}<button class="btn danger" data-a="leave">مغادرة الغرفة</button>`);
}

// ---------- actions ----------
const nick = () => { const v = ($('#lbNick')?.value || '').trim(); saveNick(v); return v; };
async function begin(action, body) {
  const nickname = nick(); typedCode = body.code || typedCode;   // read BEFORE the repaint below replaces the inputs
  busy = true; msg = ''; tech = ''; canWatch = false; paint('start');
  const r = await net.call({ action, nickname, ...body }, { quiet: true });
  busy = false;
  if (!r) { msg = net.lastError?.text || 'تعذّر الاتصال بالخادم.'; tech = net.lastError?.detail || ''; return paint('start'); }
  if (r.ok) { if (r.fell_back) msg = 'لا يوجد مقعد لاعب: دخلتَ الغرفة متفرّجًا (مشاهدة فقط).'; return enter(r.snapshot); }
  if (r.code === 'ALREADY_IN_GAME' && r.snapshot) return enter(r.snapshot);   // you are already in a room: go back to it
  msg = r.message || 'تعذّر تنفيذ الطلب.'; canWatch = r.can_spectate === true; paint('start');   // a refused player may be offered the gallery, never put there silently
}
async function roomAct(action, extra) {
  busy = true; msg = ''; paint('room');
  const r = await net.lobbyAction(action, extra);
  busy = false;
  if (r && !r.ok && r.message) msg = r.message;
  paint('room');
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* not allowed */ } t.remove(); return ok;
}
function wire() {
  if (wired) return; wired = true;
  root().addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, v = b.dataset.v;
    if (a === 'back') { close(); return onBack && onBack(); }
    if (a === 'retry') return open(onBack, false);
    if (a === 'create') return begin('create_room', { settings: {} });
    if (a === 'role') { typedRole = v; typedCode = $('#lbCode')?.value || typedCode; nick(); return paint('start'); }   // nick() saves what was typed: the repaint must not lose it
    if (a === 'join') return begin('join_room', { code: $('#lbCode').value, role: typedRole });
    if (a === 'watch') return begin('join_room', { code: $('#lbCode').value, role: 'spectator' });
    if (a === 'slot') return roomAct('choose_slot', b.dataset.k === 'player' ? { kind: 'player', slot: +v } : { kind: b.dataset.k });
    if (a === 'maxp') return roomAct('update_settings', { settings: { max_players: +v } });
    if (a === 'tl') return roomAct('update_settings', { settings: { turn_limit: v === '1' } });
    if (a === 'wj') return roomAct('update_settings', { settings: { word_judging: v } });
    if (a === 'judge') return roomAct('update_settings', { settings: { judge_enabled: v === '1' } });
    if (a === 'cap') return roomAct('update_settings', { settings: { max_spectators: +v } });
    if (a === 'mode') return roomAct('update_settings', { settings: { tile_mode: v } });
    if (a === 'live') return roomAct('update_settings', { settings: { live: v === '1' } });
    if (a === 'min') return roomAct('update_settings', { settings: { minutes: +v } });
    if (a === 'ready') return roomAct('set_ready', { ready: v === '1' });
    if (a === 'start') return roomAct('start_game');
    if (a === 'leave') return net.leave();
    if (a === 'copy') { const ok = await copy(v); msg = ok ? '' : 'تعذّر النسخ. انسخ الرمز يدويًا.'; b.textContent = ok ? 'تم النسخ ✓' : 'نسخ الرمز'; if (!ok) paint('room'); setTimeout(() => { if (b.isConnected) b.textContent = 'نسخ الرمز'; }, 1500); return; }
    if (a === 'share') {
      const url = linkFor(v);
      if (navigator.share) { try { await navigator.share({ title: 'سكرابل عربي', text: `انضم إلى مباراتي. الرمز: ${v}`, url }); return; } catch { return; } }
      const ok = await copy(url); b.textContent = ok ? 'تم نسخ الرابط ✓' : 'مشاركة رابط'; setTimeout(() => { if (b.isConnected) b.textContent = 'مشاركة رابط'; }, 1500);
    }
  });
  root().addEventListener('input', e => { if (e.target.id === 'lbCode') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ''); });
  root().addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lbCode') begin('join_room', { code: e.target.value, role: typedRole }); if (e.key === 'Enter' && e.target.id === 'lbNick') $('#lbCode').focus(); });
}

export const lobby = { open, close, show };
export const hasRoomLink = () => !!codeFromUrl();
