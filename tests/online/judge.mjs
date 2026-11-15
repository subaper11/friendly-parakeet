// V6.0 Judge workflow: Ping Judge, freeze, Judge Tahkim (open / dismiss / verdict), Judge pause, offline fallback, races. Real server core, in-memory store.
import { makeWorld, suite, across, idsFor, uuidFrom } from './lib.mjs';
import { challengePenalty } from '../../supabase/functions/_shared/game/rules.js';
import { JUDGE_ABSENT_MS, PINGS_EACH, PAUSE_MS, ABANDON_MS } from '../../supabase/functions/_shared/game/config.js';
const { ok, group, done } = suite('online judge v6.0: ping, freeze, Judge Tahkim, Judge pause, offline fallback, races');
const tick = ms => new Promise(r => setTimeout(r, ms));
const SEC = 1000, MIN = 60000, WHO = ['A', 'B', 'J', 'S', 'X'];

// A (host, seat 0) has played كتاب; B (seat 1) is on turn and may dispute it. J is the Judge, S a spectator.
async function dispute({ judge = true, spectator = false, seed = 21 } = {}) {
  const w = makeWorld({ seed, who: WHO });
  const code = await w.room({ judge_enabled: true, max_spectators: 2, minutes: 10 });
  const jn = async (k, role) => { const r = await w.raw(k, { action: 'join_room', code, nickname: 'n' + k, role }); w.snap[k] = r.snapshot; return r; };
  if (judge) await jn('J', 'judge'); if (spectator) await jn('S', 'spectator');
  await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const mv = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') }); if (!mv.ok) throw new Error('setup move failed: ' + mv.code);
  await w.call('B', 'snapshot'); if (judge) await w.call('J', 'snapshot');
  w.hb = k => w.raw(k, { action: 'heartbeat', game_id: w.gameId });
  w.snapOf = async k => (await w.call(k, 'snapshot')).snapshot;
  w.ping = async (reason) => { const r = await w.call('B', 'call_judge', reason === undefined ? {} : { reason }); await w.call('J', 'snapshot'); await w.call('A', 'snapshot'); return r; };
  return w;
}
const REASON = 'كلمة فيها إضافة غير مسموحة';

group('who may call the Judge, and when');
{
  const w = await dispute();
  const a = await w.call('A', 'call_judge', {}); ok(!a.ok && a.code === 'WRONG_TURN', 'only the player on turn may call (A moved, B is on turn): ' + a.code);
  const p = await w.ping(REASON); const g = p.snapshot.game;
  ok(p.ok && g.status === 'active' && g.waiting_judge === true && g.ping?.by_seat === 1 && g.ping.move_number === 1 && g.ping.reason === REASON, 'ping accepted: status stays active, waiting_judge, who / which move / why are public');
  ok(g.ping.by_pid === w.users.B && g.pings_left[1] === PINGS_EACH - 1 && g.pings_left[0] === PINGS_EACH, 'quota: 2 left for B, 3 for A');
  const dup = await w.call('B', 'call_judge', {}); ok(!dup.ok && dup.code === 'WAITING_JUDGE', 'a second ping while waiting is refused');
  const x = await dispute({ judge: false }); const nj = await x.call('B', 'call_judge', {}); ok(!nj.ok && nj.code === 'JUDGE_NOT_AVAILABLE', 'no judge in the room: cannot call');
  const y = await dispute(); const first = (await y.call('A', 'snapshot')).snapshot; y.snap.B = (await y.call('B', 'snapshot')).snapshot;
  await y.call('B', 'pass_turn'); await y.call('A', 'snapshot'); const none = await y.call('A', 'call_judge', {}); ok(!none.ok && ['NO_TAHKIM', 'WRONG_TURN'].includes(none.code), 'nothing disputable after a pass: ' + none.code);
  const z = await dispute(); z.clock.t += JUDGE_ABSENT_MS + 5 * SEC; const late = await z.call('B', 'call_judge', {}); ok(!late.ok && late.code === 'JUDGE_NOT_AVAILABLE', 'a judge silent for ' + JUDGE_ABSENT_MS / 1000 + ' s counts as absent: cannot call (consensus Tahkim is open instead)');
  const long = await (await dispute()).call('B', 'call_judge', { reason: 'x'.repeat(161) }); ok(!long.ok && long.code === 'BAD_REQUEST', 'overlong reason refused');
  const noReason = await dispute(); const nr = await noReason.call('B', 'call_judge', {}); ok(nr.ok && nr.snapshot.game.ping.reason === null, 'the reason is optional');
}

group('freeze: clock stops, gameplay locked, judge present => no consensus Tahkim');
{
  const w = await dispute(); const before = (await w.snapOf('A')).players.map(p => p.ms_left);
  const p = await w.ping(REASON); const frozen = p.snapshot;
  ok(!frozen.game.clock_running && frozen.game.turn_deadline_at == null, 'clock stopped at once');
  w.clock.t += 30 * MIN; await w.hb('J');
  const later = await w.snapOf('A'); ok(later.players[1].ms_left === frozen.players[1].ms_left && later.players[0].ms_left === before[0], 'after 30 minutes both clocks are exactly as they were: ' + later.players.map(q => q.ms_left));
  for (const [k, a, x] of [['B', 'submit_move', { placements: [] }], ['B', 'pass_turn', {}], ['B', 'swap_tiles', { tileIds: ['x'] }], ['B', 'pause_game', {}], ['B', 'request_tahkim', { reason: REASON }], ['A', 'request_undo', {}]]) {
    const r = await w.call(k, a, x); ok(!r.ok && r.code === 'WAITING_JUDGE', `${k} ${a} while waiting for the judge -> ${r.code}`);
  }
  const free = await dispute(); const t = await free.call('B', 'request_tahkim', { reason: REASON }); ok(!t.ok && t.code === 'USE_JUDGE', 'a player cannot open the consensus Tahkim while the judge is here: ' + t.code);
  const rs = await w.call('A', 'resign_game', {}); ok(rs.ok && rs.snapshot.game.status === 'finished', 'resigning still works while waiting for the judge');
}

group('ping memory: persists, per player, once per move');
{
  const w = await dispute(); await w.ping();
  const rc = (await w.raw('B', { action: 'reconnect' })).snapshot; ok(rc.game.pings_left[1] === PINGS_EACH - 1 && rc.game.waiting_judge, 'a refresh / reconnect does not reset the quota or the waiting state');
  const jd = await w.call('J', 'judge_dismiss_ping', {}); ok(jd.ok, 'judge dismisses');
  await w.call('B', 'snapshot'); const again = await w.call('B', 'call_judge', {}); ok(!again.ok && again.code === 'PING_DUPLICATE', 'the same player cannot call again on the same move: ' + again.code);
  ok((await w.snapOf('B')).game.pings_left[1] === PINGS_EACH - 1, 'a dismissed ping still counted');
}
{
  const w = await dispute(); let last = null;
  for (let i = 0; i < PINGS_EACH; i++) {
    const p = await w.ping(); ok(p.ok, `ping ${i + 1} of ${PINGS_EACH} accepted`);
    await w.call('J', 'judge_dismiss_ping', {}); await w.call('B', 'snapshot');
    await w.call('B', 'pass_turn'); await w.call('A', 'snapshot');
    w.giveRack('A', [...'ببببببب']); const sa = await w.snapOf('A');
    const m = await w.call('A', 'submit_move', { placements: [{ tileId: idsFor(sa, 'ب')[0], row: 8 + i, col: 7 }] }); ok(m.ok, `A plays move ${i + 2}`);
    await w.call('B', 'snapshot'); await w.call('J', 'snapshot');
  }
  const over = await w.call('B', 'call_judge', {}); ok(!over.ok && over.code === 'PING_LIMIT', `the ${PINGS_EACH + 1}th ping is refused: ${over.code}`);
  const sb = await w.snapOf('B'); ok(sb.game.pings_left[1] === 0 && sb.game.pings_left[0] === PINGS_EACH, 'B has none left, A still has all');
  const multi = await w.call('B', 'request_tahkim', { reason: REASON }); ok(!multi.ok && multi.code === 'USE_JUDGE', 'and the consensus Tahkim is still closed while the judge is here');
}

group('judge dismisses / caller cancels');
{
  const w = await dispute(); const p = await w.ping(); const stopped = p.snapshot.players[1].ms_left;
  const sp = await dispute({ spectator: true }); await sp.ping(); const nope = await sp.call('S', 'judge_dismiss_ping', {}); ok(!nope.ok && nope.code === 'SPECTATOR_READ_ONLY', 'a spectator cannot dismiss');
  const none = await (await dispute()).call('J', 'judge_dismiss_ping', {}); ok(!none.ok && none.code === 'NO_PING', 'nothing to dismiss: ' + none.code);
  w.clock.t += 40 * SEC; await w.hb('J');
  const d = await w.call('J', 'judge_dismiss_ping', {}); ok(d.ok && !d.snapshot.game.ping && !d.snapshot.game.waiting_judge && d.snapshot.game.status === 'active', 'ping cleared, status active');
  ok(d.snapshot.game.clock_running && d.snapshot.players[1].ms_left === stopped, 'the clock restarts from where it stopped (the 40 s of waiting were not charged)');
  w.clock.t += 5 * SEC; const run = await w.snapOf('B'); ok(run.game.clock_running && run.game.turn_started_at != null, 'B\'s clock is running again');
  await w.call('B', 'snapshot'); const mv = await w.call('B', 'pass_turn', {}); ok(mv.ok, 'B can play again');
  const c = await dispute(); await c.ping(); const byA = await c.call('A', 'cancel_ping', {}); ok(!byA.ok && byA.code === 'NO_PING', 'only the caller can take the call back');
  c.clock.t += 20 * SEC; const bc = await c.call('B', 'cancel_ping', {}); ok(bc.ok && !bc.snapshot.game.ping && bc.snapshot.game.clock_running, 'caller takes it back: clock runs');
  ok((await c.snapOf('B')).game.pings_left[1] === PINGS_EACH - 1, 'a cancelled call still counted');
}

group('judge opens Tahkim: the judge is the resolver, never a seat');
{
  const w = await dispute({ spectator: true }); await w.ping(REASON); await w.call('S', 'snapshot');
  const o = await w.call('J', 'judge_open_tahkim', {}); const t = o.snapshot.game.tahkim;
  ok(o.ok && o.snapshot.game.status === 'tahkim_pending' && t.state === 'pending' && t.resolver === 'judge' && t.resolver_player_id === w.users.J && t.resolver_role === 'judge', 'Tahkim opens with the judge as resolver');
  ok(t.challenger_seat === 1 && t.reason === REASON && t.words.join() === 'كتاب' && t.via_ping === true && !('resolver_seat' in t), 'same move, same challenger (B), same reason; the judge is stored by player id, not by seat');
  ok(!o.snapshot.game.ping && !o.snapshot.game.clock_running, 'ping cleared, clocks stopped');
  ok(o.snapshot.players.length === 2 && o.snapshot.players.every(p => p.player_id !== w.users.J), 'the judge is still not a player');
  const va = await w.call('A', 'tahkim_vote', { verdict: 'valid' }), vb = await w.call('B', 'tahkim_vote', { verdict: 'valid' });
  ok(!va.ok && va.code === 'JUDGE_DECIDES' && !vb.ok && vb.code === 'JUDGE_DECIDES', 'players\' selections are refused: even two matching ones decide nothing');
  ok((await w.snapOf('A')).game.status === 'tahkim_pending', 'the dispute is still open after both tried to agree');
  const ca = await w.call('A', 'tahkim_message', { text: 'الكلمة صحيحة' }), cj = await w.call('J', 'tahkim_message', { text: 'سأنظر في الأمر' }), cb = await w.call('B', 'tahkim_message', { text: 'فيها ضمير متصل' });
  ok(ca.ok && cj.ok && cb.ok, 'both players and the judge can talk');
  const chat = (await w.snapOf('B')).game.tahkim.chat; const jm = chat.find(m => m.pid === w.users.J);
  ok(chat.map(m => m.n).join() === '1,2,3' && jm.s === null && jm.role === 'judge' && jm.nick === 'nJ' && chat[0].s === 0 && chat[0].role === 'player' && chat[0].pid === w.users.A, 'chat entries carry author id / role / nickname; the judge has no seat');
  const cs = await w.call('S', 'tahkim_message', { text: 'مرحبا' }); ok(!cs.ok && cs.code === 'SPECTATOR_READ_ONLY', 'a spectator cannot chat');
  const sp = (await w.snapOf('S')).game.tahkim; ok(sp.state === 'pending' && sp.chat.length === 0 && sp.chat_count === 3 && sp.reason === REASON, 'a spectator sees the public dispute but not the private discussion');
  const re = await w.call('B', 'request_tahkim', { reason: REASON }); ok(!re.ok && re.code === 'TAHKIM_PENDING', 'no second dispute while one is open');
  const pv = await w.call('B', 'judge_verdict', { verdict: 'valid' }); ok(!pv.ok && pv.code === 'NOT_A_JUDGE', 'a player cannot issue the verdict');
}

group('verdict VALID: move stays, challenger pays, once');
{
  const w = await dispute(); await w.ping(REASON); await w.call('J', 'judge_open_tahkim', {});
  const before = await w.snapOf('J'), bScore = before.players[1].score, aScore = before.players[0].score, pen = challengePenalty(bScore);
  const wrong = await w.call('J', 'judge_verdict', { verdict: 'valid', move_number: 99 }); ok(!wrong.ok && wrong.code === 'STALE_STATE', 'a verdict about another move is refused: ' + wrong.code);
  const bad = await w.call('J', 'judge_verdict', { verdict: 'maybe' }); ok(!bad.ok && bad.code === 'BAD_REQUEST', 'only valid / invalid');
  const nul = await w.call('J', 'judge_verdict', { verdict: null }); ok(!nul.ok && nul.code === 'BAD_REQUEST', 'the judge cannot "withdraw": a verdict is final');
  w.clock.t += 3 * SEC;
  const v = await w.call('J', 'judge_verdict', { verdict: 'valid', move_number: 1 }); const s = v.snapshot;
  ok(v.ok && v.verdict === 'valid' && s.game.status === 'active' && s.game.tahkim.state === 'resolved_valid', 'verdict applied: active again, resolved_valid');
  ok(s.players[0].score === aScore && s.players[1].score === bScore - pen && v.penalty === pen, `challenger B paid the penalty (${pen}); A keeps the points`);
  ok(s.board[7][7]?.l === 'ك' && s.moves[0].st === 'ok' && (s.moves[0].pen || 0) === pen, 'the move stays on the board, marked ok');
  ok(s.game.clock_running && s.game.current_seat === 1, 'B (on turn) has the clock again');
  const lg = s.game.tahkim_log[0]; ok(lg.resolver === 'judge' && lg.resolver_player_id === w.users.J && lg.resolver_nick === 'nJ' && lg.challenger_seat === 1 && lg.verdict === 'valid', 'history records the judge as adjudicator');
  const twice = await w.call('J', 'judge_verdict', { verdict: 'invalid' }); ok(!twice.ok && twice.code === 'NOT_IN_TAHKIM', 'a second verdict is refused: nothing applied twice');
  ok((await w.snapOf('A')).players[1].score === bScore - pen, 'scores unchanged by the refused second verdict');
}

group('verdict INVALID: rollback, bag reshuffled, turn to the challenger');
{
  const w = await dispute(); const s0 = await w.snapOf('A'); const rackBefore = w.server().priv.undo.racks[w.users.A].filter(Boolean).map(t => t.id).sort().join();
  await w.ping(REASON); await w.call('J', 'judge_open_tahkim', {});
  const v = await w.call('J', 'judge_verdict', { verdict: 'invalid' }); const s = v.snapshot;
  ok(v.ok && s.game.status === 'active' && s.game.tahkim.state === 'resolved_invalid', 'resolved_invalid');
  ok(s.board.every(r => r.every(c => c === null)) && s.players[0].score === 0 && s.moves[0].st === 'void', 'board empty, A\'s points gone, the move marked void');
  ok(s.game.current_seat === 1, 'the turn is B\'s (the challenger)');
  ok(w.server().racks[w.users.A].filter(Boolean).map(t => t.id).sort().join() === rackBefore, 'A\'s rack is restored exactly');
  const sa = await w.snapOf('A'); ok(sa.me.rack.filter(Boolean).length === 7, 'A holds 7 tiles again');
  ok(s.me.rack.length === 0 && s.players.length === 2, 'the judge got no rack out of the rollback');
  ok(w.server().racks[w.users.J] === undefined, 'no rack row for the judge on the server either');
}

group('judge-initiated Tahkim (no ping): nobody is charged');
{
  const w = await dispute(); const bScore = (await w.snapOf('B')).players[1].score;
  const o = await w.call('J', 'judge_open_tahkim', { reason: 'ألاحظ أمرًا في الكلمة' }); const t = o.snapshot.game.tahkim;
  ok(o.ok && t.challenger_seat === null && t.via_ping === false && t.reason === 'ألاحظ أمرًا في الكلمة' && t.resolver === 'judge', 'challenger_seat is null: no player is made the challenger');
  const v = await w.call('J', 'judge_verdict', { verdict: 'valid' }); ok(v.ok && v.penalty === 0 && v.snapshot.players.every(p => p.score >= 0) && v.snapshot.players[1].score === bScore, 'valid: nobody pays a challenge penalty');
  const w2 = await dispute(); await w2.call('J', 'judge_open_tahkim', {}); const t2 = (await w2.snapOf('A')).game.tahkim; ok(t2.reason.length >= 3, 'default reason when the judge gives none: ' + t2.reason);
  const v2 = await w2.call('J', 'judge_verdict', { verdict: 'invalid' }); ok(v2.ok && v2.snapshot.game.current_seat === 1 && v2.snapshot.board[7][7] === null, 'invalid: move void, turn passes to the opponent of the mover');
  const w3 = await dispute(); const ow = await w3.call('J', 'judge_open_tahkim', { move_number: 7 }); ok(!ow.ok && ow.code === 'STALE_STATE', 'open for a move that is not the last: refused');
  const w4 = await dispute(); await w4.call('B', 'pass_turn'); const no = await w4.call('J', 'judge_open_tahkim', {}); ok(!no.ok && no.code === 'NO_TAHKIM', 'nothing disputable after a pass');
}

group('judge pause: no quota, no expiry, only the judge resumes (while here)');
{
  const w = await dispute(); const before = await w.snapOf('B'); w.clock.t += 5 * SEC;
  const p = await w.call('J', 'judge_pause', {}); const z = p.snapshot.game.pause;
  ok(p.ok && z.role === 'judge' && z.by === null && z.until === null && z.pid === w.users.J, 'judge pause: role judge, no seat, no expiry');
  ok(p.snapshot.game.pauses_left.join() === '2,2' && !p.snapshot.game.clock_running, 'no player quota used; clocks stopped');
  const frozen = p.snapshot.players[1].ms_left; ok(frozen < before.players[1].ms_left, '(the 5 s up to the pause were charged)');
  const np = await w.call('B', 'pause_game', {}); ok(!np.ok && np.code === 'PAUSED', 'a player cannot pause on top of it');
  const jp = await w.call('J', 'judge_pause', {}); ok(!jp.ok && jp.code === 'PAUSED', 'nor can the judge twice');
  await w.call('B', 'snapshot'); const mv = await w.call('B', 'pass_turn', {}); ok(!mv.ok && mv.code === 'PAUSED', 'nothing can be played');
  // a long time passes while the judge is still around (heartbeats): the pause must NOT end by itself
  for (let t = 0; t < PAUSE_MS * 2; t += 30 * SEC) { w.clock.t += 30 * SEC; await w.hb('J'); await w.hb('A'); await w.hb('B'); }
  await w.call('B', 'snapshot'); const x = await w.call('B', 'pass_turn', {}); ok(!x.ok && x.code === 'PAUSED', 'after ' + (PAUSE_MS * 2) / MIN + ' minutes it is still paused (no auto-resume)');
  const pr = await w.call('B', 'resume_game', {}); ok(!pr.ok && pr.code === 'JUDGE_PAUSED', 'a player cannot resume while the judge is here: ' + pr.code);
  const ar = await w.call('A', 'resume_game', {}); ok(!ar.ok && ar.code === 'JUDGE_PAUSED', 'neither can the other player');
  const sp = await dispute({ spectator: true }); await sp.call('J', 'judge_pause', {}); const sr = await sp.call('S', 'judge_resume', {}); ok(!sr.ok && sr.code === 'SPECTATOR_READ_ONLY', 'a spectator cannot resume');
  const cl = await w.snapOf('A'); ok(cl.waiting_seat === null, 'while the judge holds the match nobody is "waited for": no claim against a player');
  w.clock.t += ABANDON_MS + MIN; await w.hb('J');
  const ab = await w.call('A', 'claim_abandon', {}); ok(!ab.ok && ab.code === 'NOT_ABANDONED', 'an idle player cannot be claimed against during a judge pause');
  const jr = await w.call('J', 'judge_resume', {}); ok(jr.ok && !jr.snapshot.game.pause && jr.snapshot.game.clock_running && jr.snapshot.players[1].ms_left === frozen, 'the judge resumes: the clock restarts exactly where it stopped');
  const nr = await w.call('J', 'judge_resume', {}); ok(!nr.ok && nr.code === 'NOT_PAUSED', 'nothing to resume');
}
{
  const w = await dispute(); await w.call('J', 'judge_pause', {});
  w.clock.t += JUDGE_ABSENT_MS + 10 * SEC; await w.hb('A'); await w.hb('B');   // the judge has gone quiet
  const r = await w.call('B', 'resume_game', {}); ok(r.ok && !r.snapshot.game.pause && r.snapshot.game.clock_running, 'judge gone for ' + JUDGE_ABSENT_MS / 1000 + ' s: a player may resume (fallback)');
  const w2 = await dispute(); await w2.call('J', 'judge_pause', {}); await w2.raw('J', { action: 'leave_room', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng) });
  const r2 = await w2.call('A', 'resume_game', {}); ok(r2.ok, 'judge left the room: a player may resume at once');
  const w3 = await dispute(); await w3.call('B', 'pause_game', {}); const jr = await w3.call('J', 'judge_resume', {}); ok(jr.ok && !jr.snapshot.game.pause, 'the judge can end a player\'s pause too');
}
{
  const w = await dispute({ judge: false }); const p = await w.call('B', 'pause_game', {}); ok(p.ok && p.snapshot.game.pause.until != null && p.snapshot.game.pauses_left[1] === 1, 'v5 player pause unchanged: quota, expiry');
  w.clock.t += PAUSE_MS + SEC; const q = await w.call('A', 'resume_game', {}); ok(q.ok, 'v5: the other player resumes after the limit');
  w.clock.t += 1; const r = await w.call('B', 'pause_game', {}); ok(r.ok && r.snapshot.game.pauses_left[1] === 0, 'second pause uses the last one');
  w.clock.t += 2 * PAUSE_MS; const exp = await w.call('B', 'pass_turn', {}); ok(exp.ok, 'v5: an expired player pause ends by itself on the next action');
}

group('judge offline: fallback to the players\' consensus, once');
{
  const w = await dispute(); await w.ping(REASON); const fz = (await w.snapOf('B')).players[1].ms_left;
  const early = await w.call('B', 'check_judge', {}); ok(!early.ok && early.code === 'JUDGE_PRESENT', 'judge still here: nothing to do: ' + early.code);
  w.clock.t += JUDGE_ABSENT_MS - 5 * SEC; const still = await w.call('B', 'check_judge', {}); ok(!still.ok && still.code === 'JUDGE_PRESENT', 'not yet at ' + (JUDGE_ABSENT_MS - 5000) / 1000 + ' s');
  w.clock.t += 6 * SEC;
  const spy = await w.call('A', 'snapshot'); ok(spy.snapshot.judge.online === false && spy.snapshot.game.judge_present === false, 'players are told the judge is offline');
  const f = await w.call('B', 'check_judge', {}); const t = f.snapshot.game.tahkim;
  ok(f.ok && f.snapshot.game.status === 'tahkim_pending' && t.resolver === 'consensus' && t.fallback === true && !t.resolver_player_id, 'the ping becomes a consensus Tahkim, marked as a fallback');
  ok(t.challenger_seat === 1 && t.reason === REASON && t.move_number === 1 && t.words.join() === 'كتاب' && !f.snapshot.game.ping, 'move, challenger and reason are kept');
  ok(!f.snapshot.game.clock_running && f.snapshot.players[1].ms_left === fz, 'clock stays stopped (and was not charged for the wait)');
  const again = await w.call('A', 'check_judge', {}); ok(!again.ok && again.code === 'JUDGE_PRESENT', 'a second check does nothing: the fallback happens once');
  const jv = await w.call('J', 'judge_verdict', { verdict: 'valid' }); ok(!jv.ok && jv.code === 'NOT_RESOLVER', 'a verdict from the (late) judge is refused after the fallback: ' + jv.code);
  await w.hb('J'); const back = await w.snapOf('J'); ok(back.game.tahkim.resolver === 'consensus' && back.game.status === 'tahkim_pending', 'the judge coming back does not undo the fallback');
  const aj = await w.call('J', 'judge_open_tahkim', {}); ok(!aj.ok && aj.code === 'TAHKIM_PENDING', 'nor open a second dispute');
  const va = await w.call('A', 'tahkim_vote', { verdict: 'valid' }); ok(va.ok && (await w.snapOf('A')).game.status === 'tahkim_pending', 'players can now vote; one vote decides nothing');
  const vb = await w.call('B', 'tahkim_vote', { verdict: 'valid' }); ok(vb.ok && vb.snapshot.game.status === 'active' && vb.snapshot.game.tahkim.state === 'resolved_valid' && vb.snapshot.game.clock_running, 'mutual agreement resolves it and the clock runs: it never freezes for good');
  const lg = vb.snapshot.game.tahkim_log[0]; ok(lg.resolver === 'consensus' && lg.fallback === true && lg.challenger_seat === 1, 'history: consensus (fallback)');
}
{
  const w = await dispute({ spectator: true }); await w.ping(); await w.call('J', 'judge_open_tahkim', {});
  await w.call('A', 'tahkim_message', { text: 'مرحبا' }); await w.call('J', 'tahkim_message', { text: 'قيد النظر' });
  w.clock.t += JUDGE_ABSENT_MS + 5 * SEC;
  const f = await w.call('A', 'check_judge', {}); const t = f.snapshot.game.tahkim;
  ok(f.ok && t.resolver === 'consensus' && t.fallback === true && t.chat.length === 2 && t.reason && JSON.stringify(t.votes) === '[null,null]', 'a judge ruling in progress falls back with its reason and chat kept, selections empty');
  const jv = await w.call('J', 'judge_verdict', { verdict: 'invalid' }); ok(!jv.ok && jv.code === 'NOT_RESOLVER', 'the late judge cannot rule any more');
  const x = await w.call('A', 'check_judge', {}); ok(!x.ok, 'once only');
}
{
  // the judge answers just as the timeout is reached: the judge\'s own request proves they are here
  const w = await dispute(); await w.ping(); await w.call('J', 'judge_open_tahkim', {});
  w.clock.t += JUDGE_ABSENT_MS + 30 * SEC;
  const v = await w.call('J', 'judge_verdict', { verdict: 'valid' }); ok(v.ok && v.snapshot.game.tahkim_log[0].resolver === 'judge', 'a judge who answers late but before anyone triggered the fallback still rules (no double result)');
  ok((await w.snapOf('A')).game.tahkim_log.length === 1, 'exactly one verdict recorded');
}
{
  // another player action reaches the server after the judge vanished: the fallback is applied by the server itself, not only on request
  const w = await dispute(); await w.ping(REASON); w.clock.t += JUDGE_ABSENT_MS + 5 * SEC;
  const m = await w.call('A', 'tahkim_message', { text: 'x' }); ok(m.ok && m.snapshot.game.status === 'tahkim_pending' && m.snapshot.game.tahkim.resolver === 'consensus' && m.snapshot.game.tahkim.fallback === true && m.snapshot.game.tahkim.chat.length === 1, 'any request after the timeout makes the SERVER apply the fallback itself (persisted with that request); the message lands in the discussion');
  const f = await w.call('B', 'check_judge', {}); ok(!f.ok && f.code === 'JUDGE_PRESENT', 'and the fallback does not repeat');
  const w2 = await dispute(); await w2.ping(REASON); await w2.raw('J', { action: 'leave_room', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng) });
  const g2 = await w2.snapOf('B'); ok(g2.judge === null && g2.game.waiting_judge === true, 'judge left: the match shows waiting_judge with no judge');
  const f2 = await w2.call('B', 'check_judge', {}); ok(f2.ok && f2.snapshot.game.tahkim.resolver === 'consensus' && f2.snapshot.game.tahkim.fallback, 'judge left the room: fallback at once');
  const w3 = await dispute(); await w3.ping(); w3.server().priv.undo = null; w3.clock.t += JUDGE_ABSENT_MS + SEC;
  const f3 = await w3.call('B', 'check_judge', {}); ok(f3.ok && f3.snapshot.game.status === 'active' && !f3.snapshot.game.ping && f3.snapshot.game.clock_running, 'a ping whose move can no longer be disputed is cleared and the clock restarted');
  const w4 = await dispute(); await w4.ping(); w4.clock.t += JUDGE_ABSENT_MS + SEC; await w4.hb('A'); await w4.hb('B');
  const ab = await w4.call('A', 'claim_abandon', {}); ok(!ab.ok && ab.code === 'NOT_ABANDONED', 'no claim against B while the match waits for the judge');
}
{
  // the judge is back in time: no fallback; after the fallback a new judge could even take the seat
  const w = await dispute(); await w.ping(); w.clock.t += JUDGE_ABSENT_MS - 10 * SEC; await w.hb('J'); w.clock.t += JUDGE_ABSENT_MS - 10 * SEC;
  const f = await w.call('B', 'check_judge', {}); ok(!f.ok && f.code === 'JUDGE_PRESENT', 'a heartbeat inside the window keeps the judge present');
  const o = await w.call('J', 'judge_open_tahkim', {}); ok(o.ok, 'and the judge can still open the Tahkim');
}

group('room with a judge slot but nobody in it: consensus Tahkim as before');
{
  const w = await dispute({ judge: false }); const t = await w.call('B', 'request_tahkim', { reason: REASON });
  ok(t.ok && t.snapshot.game.tahkim.resolver === 'consensus' && !t.snapshot.game.tahkim.fallback, 'judge_enabled but no judge: the v5.5 consensus opens');
  await w.call('A', 'tahkim_vote', { verdict: 'valid' }); const v = await w.call('B', 'tahkim_vote', { verdict: 'valid' });
  ok(v.ok && v.snapshot.game.tahkim.state === 'resolved_valid' && v.snapshot.game.tahkim_log[0].resolver === 'consensus', 'two matching votes resolve it, as in v5.5');
  const w2 = await dispute({ judge: false }); const jv = await w2.call('B', 'judge_verdict', { verdict: 'valid' }); ok(!jv.ok && jv.code === 'NOT_A_JUDGE', 'and no judge action works for a player');
  const late = await dispute({ judge: false }); const code = late.snap.A.game.room_code;
  const jn = await late.raw('J', { action: 'join_room', code, nickname: 'Hakam', role: 'judge' }); late.snap.J = jn.snapshot; ok(jn.ok, 'a judge can still arrive mid-match');
  const pj = await late.call('B', 'snapshot'); ok(pj.snapshot.game.judge_present === true && pj.snapshot.judge.nickname === 'Hakam', 'players see the judge arrive (judge_present)');
  const rj = await late.call('B', 'request_tahkim', { reason: REASON }); ok(!rj.ok && rj.code === 'USE_JUDGE', 'from then on disputes go through the judge');
  const cj = await late.call('B', 'call_judge', {}); ok(cj.ok, 'ping works for a judge who joined mid-match');
}

group('races');
{
  const w = await dispute(); w.store.delay = () => tick(5);
  const rev = w.snap.B.game.revision, mk = () => ({ action: 'call_judge', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: rev });
  const [a, b] = await Promise.all([w.raw('B', mk()), w.raw('B', mk())]); w.store.delay = null;
  ok([a, b].filter(r => r.ok).length === 1, 'two simultaneous pings: exactly one accepted (' + [a, b].map(r => r.ok ? 'ok' : r.code).join() + ')');
  ok((await w.snapOf('B')).game.pings_left[1] === PINGS_EACH - 1, 'only one counted against the quota');
}
{
  const w = await dispute(); w.store.delay = () => tick(5);
  const rev = w.snap.B.game.revision;
  const [p, z] = await Promise.all([w.raw('B', { action: 'call_judge', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: rev }), w.raw('B', { action: 'pause_game', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: rev })]); w.store.delay = null;
  const s = (await w.snapOf('B')).game;
  ok(!(s.ping && s.pause) && (s.ping || s.pause), 'ping + pause at once: exactly one state wins, never both (' + [p, z].map(r => r.ok ? 'ok' : r.code).join() + ')');
  ok(!s.clock_running, 'and the clock is stopped either way');
}
{
  const w = await dispute(); await w.ping(); await w.call('J', 'judge_open_tahkim', {}); w.store.delay = () => tick(5);
  const mk = () => ({ action: 'judge_verdict', game_id: w.gameId, client_action_id: uuidFrom(w.rng), verdict: 'valid' });
  const [a, b] = await Promise.all([w.raw('J', mk()), w.raw('J', mk())]); w.store.delay = null;
  ok([a, b].filter(r => r.ok).length === 1, 'two simultaneous verdicts: exactly one applies (' + [a, b].map(r => r.ok ? 'ok' : r.code).join() + ')');
  const s = await w.snapOf('A'); ok(s.game.tahkim_log.length === 1, 'one history record');
  const same = { action: 'judge_verdict', game_id: w.gameId, client_action_id: uuidFrom(w.rng), verdict: 'invalid' };
  const w2 = await dispute(); await w2.ping(); await w2.call('J', 'judge_open_tahkim', {});
  const body = { ...same, game_id: w2.gameId }; const r1 = await w2.raw('J', body), r2 = await w2.raw('J', body);
  ok(r1.ok && r2.ok && r2.duplicate === true && (await w2.snapOf('A')).game.tahkim_log.length === 1, 'a retried verdict (same client_action_id) is answered, not applied twice');
}
{
  const w = await dispute(); await w.ping(); await w.call('J', 'judge_open_tahkim', {}); w.clock.t += JUDGE_ABSENT_MS + 5 * SEC; w.store.delay = () => tick(5);
  const [f, v] = await Promise.all([w.raw('B', { action: 'check_judge', game_id: w.gameId, client_action_id: uuidFrom(w.rng) }), w.raw('J', { action: 'judge_verdict', game_id: w.gameId, client_action_id: uuidFrom(w.rng), verdict: 'valid' })]); w.store.delay = null;
  const s = await w.snapOf('A'); const resolved = s.game.tahkim_log.length;
  ok(resolved <= 1 && !(f.ok && v.ok && resolved === 1 && s.game.tahkim_log[0].resolver === 'judge' && s.game.tahkim.fallback), 'judge reconnecting exactly during the fallback: never two outcomes (' + [f, v].map(r => r.ok ? 'ok' : r.code).join() + ', log ' + resolved + ', status ' + s.game.status + ')');
  ok(['active', 'tahkim_pending'].includes(s.game.status) && (s.game.status === 'active' ? resolved === 1 : s.game.tahkim.resolver === 'consensus'), 'state is coherent: either the judge ruled, or the players hold the dispute');
}
{
  const w = await dispute(); await w.ping(); w.store.delay = () => tick(5);
  const [d, o] = await Promise.all([w.raw('J', { action: 'judge_dismiss_ping', game_id: w.gameId, client_action_id: uuidFrom(w.rng) }), w.raw('J', { action: 'judge_open_tahkim', game_id: w.gameId, client_action_id: uuidFrom(w.rng) })]); w.store.delay = null;
  const s = (await w.snapOf('B')).game; ok(!s.ping && (s.status === 'active' || s.status === 'tahkim_pending'), 'dismiss + open at once: one coherent outcome (' + s.status + ')');
}

group('other paths stay correct with a judge present');
{
  const w = await dispute({ spectator: true }); await w.ping(); await w.call('J', 'judge_open_tahkim', {});
  const rs = await w.call('B', 'resign_game', {}); ok(rs.ok && rs.snapshot.game.status === 'finished' && rs.snapshot.game.winner_seat === 0, 'resign during a judge Tahkim ends the match (surrender rule)');
  const jv = await w.call('J', 'judge_verdict', { verdict: 'valid' }); ok(!jv.ok, 'no verdict after the match ended: ' + jv.code);
  const jp = await w.call('J', 'judge_pause', {}); ok(!jp.ok && jp.code === 'WRONG_STATUS', 'no judge pause in a finished match');
  const a = await w.call('A', 'rematch', {}), b = await w.call('B', 'rematch', {}); const s = b.snapshot;
  ok(b.ok && s.game.status === 'active' && s.game.round === 2 && s.game.pings_left.join() === `${PINGS_EACH},${PINGS_EACH}` && s.game.ping === null, 'rematch: new round, quotas reset, judge and spectator stay');
  const sj = await w.snapOf('J'), ss = await w.snapOf('S'); ok(sj.me.role === 'judge' && ss.me.role === 'spectator' && sj.me.rack.length === 0 && ss.me.rack.length === 0, 'judge and spectator are still members, still rackless');
  ok(w.server().players.filter(p => p.role === 'player').length === 2 && Object.keys(w.server().racks).length === 2, 'racks exist for the two players only');
}
{
  const w = await dispute(); const pa = await w.call('A', 'pause_game', {}); ok(pa.ok, 'A pauses (v5 pause alongside a judge)');
  await w.call('B', 'snapshot'); const c = await w.call('B', 'call_judge', {}); ok(!c.ok && c.code === 'PAUSED', 'no call while paused');
  const r = await w.call('A', 'resume_game', {}); ok(r.ok, 'A resumes their own pause');
  await w.call('B', 'snapshot'); const p = await w.call('B', 'call_judge', {}); ok(p.ok, 'then the call works');
  const jp = await w.call('J', 'judge_pause', {}); ok(jp.ok && jp.snapshot.game.pause.role === 'judge' && jp.snapshot.game.ping, 'the judge can pause while a call is open');
  const jr = await w.call('J', 'judge_resume', {}); ok(jr.ok && !jr.snapshot.game.clock_running && jr.snapshot.game.waiting_judge, 'resuming the pause does NOT restart the clock: the call is still open');
  const jd = await w.call('J', 'judge_dismiss_ping', {}); ok(jd.ok && jd.snapshot.game.clock_running, 'dismissing it does');
}
done();
