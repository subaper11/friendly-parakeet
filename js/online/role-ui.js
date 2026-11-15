// The role panel (V6.0): a small card under the match bar that depends on WHO is looking.
//   Judge      who is online, an incoming call ("Ping Judge") with Open Tahkim / Dismiss, a way to open a Tahkim on their own initiative. Pause / resume and leave live in the match bar.
//   Spectator  a read-only banner (the board, scores and clocks are the same public view as everyone's; there is no rack and no control).
//   Player     one status line about the Judge (here / not here), only in a room that has a Judge slot.
// Pure presentation: it draws the snapshot and calls the handlers it is given. Every handler is only a REQUEST: the server decides (and re-checks the role of the caller).
// Labels are Arabic with a short Indonesian gloss for the roles (حَكَم / wasit, متفرّج / penonton).
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let built = false, sig = '', busy = false;

function build() {
  if (built) return built;
  const host = $('#netBar'); if (!host) return false;
  const p = el('section', 'rolePanel'); p.id = 'rolePanel'; p.hidden = true; p.setAttribute('aria-label', 'دورك في الغرفة');
  (document.getElementById('turnStrip') || host).after(p); built = true; return true;   // right under the match bar (and under the turn-order strip when there is one)
}

// h: { openTahkim(), dismiss(), cancel() }   ctx: { names: [n0, n1], canOpen: bool, busy: bool }
export function paintRolePanel(snap, ctx, h) {
  if (!snap || !build()) return;
  const p = $('#rolePanel'), g = snap.game, role = snap.me.role || 'player', live = ['active', 'tahkim_pending'].includes(g.status);
  const names = ctx.names, jn = snap.judge?.nickname || '';
  const online = pl => pl.connection_state !== 'offline' && (pl.idle_ms ?? 0) < 60000;
  let key, build_;
  if (role === 'judge' && live) {
    const ping = g.waiting_judge ? g.ping : null, dispute = g.status === 'tahkim_pending' && g.tahkim?.resolver === 'judge';
    key = ['j', ping && ping.move_number + ':' + ping.by_seat + ':' + ping.reason, dispute, ctx.canOpen, ctx.busy, g.pause ? 1 : 0, snap.players.map(online).join(), names.join()].join('|');
    build_ = () => {
      const f = document.createDocumentFragment();
      f.append(head('⚖', 'حَكَم', 'Wasit', 'أنت الحكم في هذه الغرفة'));
      f.append(el('p', 'rpPl', snap.players.map(pl => `${names[pl.seat]} ${online(pl) ? '●' : '○'}`).join('   ')));
      if (ping) {
        const who = names[ping.by_seat];
        f.append(el('p', 'rpCall', `📣 استدعاء من ${who} للحركة ${ping.move_number}${ping.reason ? ': «' + ping.reason + '»' : ''}`));
        f.append(btns([['yes', 'فتح التحكيم', 'open'], ['', 'رفض الاستدعاء', 'dismiss']], ctx.busy));
      } else if (dispute) f.append(el('p', 'rpNote', 'التحكيم قائم: أصدر حكمك من نافذة التحكيم.'));
      else if (g.pause) f.append(el('p', 'rpNote', 'أوقفتَ المباراة. استأنفها من شريط المباراة.'));
      else { f.append(el('p', 'rpNote', 'لا استدعاء الآن. يمكنك فتح تحكيم على آخر حركة بمبادرتك؛ ولا يُحتسب على أيٍّ من اللاعبين غرامة.')); f.append(btns([['', 'فتح تحكيم على الحركة الأخيرة', 'open']], ctx.busy || !ctx.canOpen)); }
      return f;
    };
  } else if (role === 'spectator') {
    key = ['s', g.status, snap.spectator_count, g.status === 'tahkim_pending' ? g.tahkim?.resolver : '', g.waiting_judge].join('|');
    build_ = () => {
      const f = document.createDocumentFragment();
      f.append(head('👁', 'متفرّج', 'Penonton', 'أنت تشاهد فقط'));
      const note = g.status === 'tahkim_pending' ? (g.tahkim?.resolver === 'judge' ? 'تحكيم قائم: الحكم يقرّر.' : 'تحكيم قائم بين اللاعبَين.') : g.waiting_judge ? 'المباراة بانتظار الحكم.' : 'اللوح والنقاط والساعات كما يراها اللاعبون؛ لا رفوف ولا أدوات لعب.';
      f.append(el('p', 'rpNote', `${note}  ·  المتفرجون: ${snap.spectator_count}`));
      return f;
    };
  } else if (role === 'player' && g.judge_enabled && live) {   // (a player may see the Judge line even when the call dialog is closed)
    const j = snap.judge;
    const mineCall = g.waiting_judge && g.ping && g.ping.by_pid === snap.me.player_id;   // my own call is open: I may take it back
    key = ['p', j ? j.nickname + j.online : '-', g.waiting_judge, mineCall, ctx.busy, g.pings_left?.[snap.me.seat]].join('|');
    build_ = () => {
      const f = document.createDocumentFragment();
      const line = !j ? 'الحكم: لم ينضم بعد — التحكيم بالاتفاق بينكما' : j.online ? `الحكم: ${jn} ● حاضر — استدعاؤه من زر «استدعاء الحكم» (${g.pings_left?.[snap.me.seat] ?? 0} متبقٍ)` : `الحكم: ${jn} ○ غير متصل — التحكيم بالاتفاق بينكما`;
      f.append(head('⚖', '', '', line, true));
      if (mineCall) { f.append(el('p', 'rpNote', 'استدعيتَ الحكم: الساعتان متوقفتان بانتظاره. يمكنك سحب الاستدعاء إن لم يحضر (يبقى محسوبًا من استدعاءاتك).')); f.append(btns([['', 'سحب الاستدعاء', 'cancel']], ctx.busy)); }
      return f;
    };
  } else key = '';
  if (key === '') { if (!p.hidden) { p.hidden = true; sig = ''; } p.dataset.role = ''; return; }
  p.dataset.role = role; if (p.hidden) p.hidden = false;
  if (key === sig) return;
  sig = key; p.replaceChildren(build_());
  for (const b of p.querySelectorAll('[data-rp]')) b.onclick = () => { if (b.disabled) return; if (b.dataset.rp === 'open') h.openTahkim(); else if (b.dataset.rp === 'dismiss') h.dismiss(); else if (b.dataset.rp === 'cancel') h.cancel(); };
}
function head(icon, ar, id, text, slim = false) {
  const d = el('div', 'rpHead' + (slim ? ' slim' : ''));
  d.append(el('span', 'rpIc', icon));
  if (ar) { const b = el('b', 'rpRole', ar); const i = el('small', 'rpId', id); i.lang = 'id'; d.append(b, i); }
  d.append(el('span', 'rpTxt', text)); return d;
}
function btns(list, disabled) {
  const d = el('div', 'rpActs');
  for (const [cls, label, a] of list) { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.dataset.rp = a; b.disabled = !!disabled; d.append(b); }
  return d;
}
