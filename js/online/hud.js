// Online match card: "Player 1 vs Player 2" with the room details underneath (markup: #netBar in index.html, styles: css/online.css).
// Online, each player sees ONLY their own rack (the opponent's tiles are never shown or even rendered), and the space the second rack used to take is spent on this
// card, kept deliberately minimal: name, score and clock per player (the player on turn is outlined), and beneath it the room code and the match buttons
// (session.js owns those and paints them). A dot appears only when someone is NOT connected; the opponent's tile count is in the card's accessible name.
// Pure presentation: it reads the game state and the snapshot, writes DOM only when a value changed, and decides nothing about the match.
import { $, S, app, fmt } from '../state.js';
import { nameOf } from '../names.js';
import { setText, setAttr, setClass, ensurePanels } from '../ui.js';
import { registerPlayersInfo } from '../float.js';

const SEATS = [0, 1], last = { game: -1, score: [null, null, null, null] };
const card = i => document.getElementById('mhP' + i);
const OUT = { resign: 'استسلم', abandon: 'انقطع', time: 'انتهى وقته' };

const clockClass = () => S.players.map(p => 'mhClock' + (p.ms < 60000 ? ' low' : '') + (p.ms < 10000 ? ' crit' : '') + (p.ms === 0 ? ' out' : '') + (!S.started && !S.ended ? ' wait' : ''));

// Clocks only: called every tick (the text is rewritten only when the second changes).
export function paintHudClocks() {
  if (!S.players) return;
  const cls = clockClass();
  for (const i of SEATS) {
    const el = card(i)?.querySelector('.mhClock'); if (!el) continue;
    setText(el, fmt(S.players[i].ms)); setClass(el, cls[i]);
  }
  for (const el of document.querySelectorAll('#turnList .tsClock')) { const i = +el.dataset.seat, p = S.players[i]; if (p) { setText(el, fmt(p.ms)); setClass(el, 'tsClock' + (p.ms < 60000 ? ' low' : '') + (p.ms === 0 ? ' out' : '')); } }
}

// Everything else: called when a snapshot is applied and when presence / connection / pause state changes.
export function paintHud() {
  const net = app.net, snap = net?.snap;
  if (!net || !snap || !S.players) return;
  const me = net.seat, g = snap.game, live = !S.ended && ['active', 'tahkim_pending'].includes(g.status), n = snap.players.length;
  const seats = n > 2 ? snap.players.map(p => p.seat) : SEATS;   // two players: the classic card (unchanged). Three or four: panels per seat + the turn-order strip.
  if (n > 2) ensurePanels(Math.max(...seats) + 1);
  if (last.game !== app.gameId) { last.game = app.gameId; last.score = [null, null, null, null]; }
  for (const i of seats) {
    const el = card(i), pl = snap.players.find(p => p.seat === i);
    const you = i === me, on = live && S.cur === i, score = S.players[i]?.score ?? 0;
    const tiles = pl?.tile_count ?? 0;   // tile COUNT only: nobody ever receives another player's rack
    // a player sees the other player through presence; the Judge and the spectators (no seat, no opponent) read the server's own idle figure for both
    const online = n > 2 || net.role !== 'player' ? !!pl && pl.connection_state !== 'offline' && (pl.idle_ms ?? 0) < 60000 && (you ? net.view.state !== 'OFFLINE' && net.view.state !== 'RECONNECTING' : true) : you ? net.view.state !== 'OFFLINE' && net.view.state !== 'RECONNECTING' : net.view.opp;
    const name = nameOf(i);
    if (el) {
      setText(el.querySelector('.mhName bdi'), name);
      const sc = el.querySelector('.mhScore'); setText(sc, String(score));
      if (last.score[i] !== null && last.score[i] !== score) { sc.classList.remove('pop'); void sc.offsetWidth; sc.classList.add('pop'); }   // only a score that really changed
      last.score[i] = score;
      setAttr(el, 'data-you', you); setAttr(el, 'data-on', on); setAttr(el, 'data-online', online);
      setAttr(el, 'aria-current', on);
      setAttr(el, 'aria-label', `${name}${you ? ' (أنت)' : ''}: ${score} نقطة، ${tiles} قطع على الرف${on ? '، دوره الآن' : ''}، ${online ? 'متصل' : 'غير متصل'}`);
      setAttr(el.querySelector('.mhDot'), 'title', 'غير متصل');
    }
    // the rack panels: only mine is shown (css: html[data-online] .panel[data-you="false"]); a caption on it says whose turn it is
    const panel = $('#pn' + i); if (panel) { setAttr(panel, 'data-you', you); setAttr(panel, 'data-on-turn', on); }
  }
  if (n > 2) paintTurnStrip(snap, live);
  if (net.role === 'player') rackCaption(me, live);   // the Judge and the spectators have no rack and so no caption
  paintHudClocks();
}

// The turn-order strip (3-4 players): one entry per seat in seat order = turn order. Whose turn it is, who is next, who has left and who is offline are all WORDS (a badge), never colour alone.
function paintTurnStrip(snap, live) {
  const g = snap.game, host = document.getElementById('netBar'); if (!host) return;
  let box = document.getElementById('turnStrip');
  if (!box) {   // a box with a grip (the handle that moves it in the Floating Workspace) around the ordered list
    box = document.createElement('div'); box.id = 'turnStrip'; box.className = 'turnStrip';
    box.innerHTML = '<span id="tsGrip" class="tsGrip" aria-label="تحريك معلومات اللاعبين"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></span><ol id="turnList" class="tsList" aria-label="ترتيب اللعب"></ol>';
    host.after(box); registerPlayersInfo(box, box.querySelector('#tsGrip'));
  }
  const ol = box.querySelector('#turnList');
  // The strip lists the players in TURN order: the drawn order of the game (game.order) or, without one, the seat order.
  const ord = Array.isArray(g.order) && g.order.length ? g.order : snap.players.map(p => p.seat).sort((x, y) => x - y), listed = [...snap.players].sort((x, y) => ord.indexOf(x.seat) - ord.indexOf(y.seat));
  const aliveSeats = new Set(snap.players.filter(p => !p.out).map(p => p.seat)), nxt = (() => { if (!live || S.cur == null || aliveSeats.size < 2) return null; const i = ord.indexOf(S.cur); for (let k = 1; k <= ord.length; k++) { const q = ord[(i + k) % ord.length]; if (aliveSeats.has(q)) return q; } return null; })();
  const sig = JSON.stringify([ord, snap.players.map(p => [p.seat, p.nickname, p.score, p.tile_count, p.out, p.connection_state, (p.idle_ms ?? 0) < 60000]), S.cur, live, nxt, snap.me.seat, g.pause ? 1 : 0, g.waiting_judge ? 1 : 0]);
  if (ol.dataset.sig === sig) return; ol.dataset.sig = sig;
  ol.replaceChildren(...listed.map((p, k) => {
    const you = p.seat === snap.me.seat, on = live && S.cur === p.seat && !p.out, online = p.connection_state !== 'offline' && (p.idle_ms ?? 0) < 60000;
    const li = document.createElement('li'); li.className = 'tsItem'; li.dataset.seat = p.seat; li.dataset.on = on; li.dataset.out = !!p.out; li.dataset.you = you;
    if (on) li.setAttribute('aria-current', 'true');
    const badge = p.out ? `خرج · ${OUT[p.out] || ''}` : on ? 'الدور الآن' : p.seat === nxt ? 'التالي' : !online ? 'غير متصل' : '';
    const mk = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
    const clock = mk('tsClock', fmt(S.players[p.seat]?.ms ?? 0)); clock.dataset.seat = p.seat; clock.setAttribute('role', 'timer');
    // Quiet scoreboard entry: name + score on the first line; on the second the status words (turn / next / offline, never colour alone), the tile count only when it is not a full rack, and the clock.
    const tiles = mk('tsTiles', `${p.tile_count} قطع`); tiles.dataset.full = String(p.tile_count >= 7);
    const meta = mk('tsMeta', ''); if (badge) meta.append(mk('tsBadge', badge)); if (!online && !p.out && badge !== 'غير متصل') meta.append(mk('tsBadge off', 'غير متصل')); meta.append(tiles);
    li.append(mk('tsNo', String(k + 1)), mk('tsName', nameOf(p.seat) + (you ? ' (أنت)' : '')), mk('tsScore', String(p.score)), meta, clock);
    li.setAttribute('aria-label', `${k + 1}. ${nameOf(p.seat)}${you ? ' (أنت)' : ''}: ${p.score} نقطة، ${p.tile_count} قطع${badge ? '، ' + badge : ''}`);
    return li;
  }));
}

// "حروفك" + the turn, above my rack (built once, text written only when it changes).
function rackCaption(me, live) {
  const panel = $('#pn' + me); if (!panel) return;
  let cap = panel.querySelector('.rkCap');
  if (!cap) { cap = document.createElement('div'); cap.className = 'rkCap'; cap.innerHTML = '<span class="rkT">حروفك</span><span class="rkS" role="status"></span>'; panel.insertBefore(cap, panel.querySelector('.rack')); }
  const g = app.net.snap.game, out = g.out && g.out[me] != null;
  const t = !live ? '' : out ? 'خرجتَ من المباراة: تشاهد فقط' : g.status === 'tahkim_pending' ? 'التحكيم قائم' : g.pause ? 'اللعبة متوقفة' : S.cur === me ? 'حان دورك' : `بانتظار ${nameOf(S.cur)}`;
  setText(cap.querySelector('.rkS'), t); setAttr(cap, 'data-on', live && !out && !g.pause && g.status === 'active' && S.cur === me);
}
