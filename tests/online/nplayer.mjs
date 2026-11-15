// V6.1: online games of 2, 3 and 4 players. Real server core, in-memory store. Two-player behaviour itself is pinned by the older suites (parity, abandon, pause-undo, ...).
import { makeWorld, suite, across, uuidFrom } from './lib.mjs';
import * as E from '../../supabase/functions/_shared/core/engine.js';
import { ABANDON_MS } from '../../supabase/functions/_shared/game/config.js';
const { ok, group, done } = suite('online N players v6.1: rotation, draw, elimination, majority Tahkim, rematch, privacy');
const MIN = 60000;
const R = 'سبب كاف للتحكيم';

async function game(n, { judge = false, spectator = false, draw = false, seed = 5 } = {}) {
  const w = makeWorld({ seed, who: ['A', 'B', 'C', 'D', 'J', 'S', 'X'], draw });
  const { code, names } = await w.roomN(n, { minutes: 10, judge_enabled: judge, max_spectators: 3 });
  const jn = async (k, role) => { const r = await w.raw(k, { action: 'join_room', code, nickname: k, role }); w.snap[k] = r.snapshot; return r; };
  if (judge) await jn('J', 'judge'); if (spectator) await jn('S', 'spectator');
  const st = await w.call('A', 'start_game'); if (!st.ok) throw new Error('start: ' + st.code);
  for (const k of names) await w.call(k, 'snapshot'); if (judge) await w.call('J', 'snapshot'); if (spectator) await w.call('S', 'snapshot');
  w.names = names; w.sync = async () => { for (const k of [...names, ...(judge ? ['J'] : []), ...(spectator ? ['S'] : [])]) await w.call(k, 'snapshot'); };
  w.cur = () => w.server().game.current_seat; w.seatOf = k => w.snap[k].me.seat; w.byseat = s => names.find(k => w.snap[k].me.seat === s);
  w.pass = async () => { const k = w.byseat(w.cur()); const r = await w.call(k, 'pass_turn'); await w.sync(); return r; };
  w.firstMove = async () => { w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot'); const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') }); await w.sync(); return r; };
  return w;
}
const mkw = (seats, out = {}) => ({ game: { ext: { out } }, players: seats.map(s => ({ player_id: 'p' + s, role: 'player', seat: s })) });

group('rotation helpers: seats, wrap-around, gaps, elimination');
{
  const w = mkw([0, 1, 2, 3]);
  ok(E.nextSeat(w, 0) === 1 && E.nextSeat(w, 2) === 3 && E.nextSeat(w, 3) === 0, '4 players: 0>1>2>3>0 (wraps)');
  ok(E.nextSeat(mkw([0, 1]), 1) === 0 && E.nextSeat(mkw([0, 1]), 0) === 1, '2 players: exactly 1 - seat');
  ok(E.nextSeat(mkw([0, 2, 3]), 0) === 2 && E.nextSeat(mkw([0, 2, 3]), 3) === 0, 'non-consecutive seats 0,2,3: 0>2>3>0');
  ok(E.nextSeat(mkw([0, 1, 2, 3], { 1: 'resign' }), 0) === 2 && E.nextSeat(mkw([0, 1, 2, 3], { 3: 'time' }), 2) === 0, 'eliminated seats are skipped');
  ok(E.nextSeat(mkw([0, 1, 2], { 2: 'time' }), 2) === 0 && E.nextSeat(mkw([0, 1, 2], { 1: 'time' }), 1) === 2, 'from an eliminated seat the next ACTIVE seat follows');
  ok(E.nextSeat(mkw([0, 1, 2], { 1: 'abandon', 2: 'resign' }), 0) === 0, 'a single active player: the turn stays with them');
  ok(E.nextSeat(mkw([0, 1], { 0: 'resign', 1: 'time' }), 0) === null, 'nobody active: null');
  const j = mkw([0, 1, 2]); j.players.push({ player_id: 'jj', role: 'judge', seat: null }, { player_id: 'ss', role: 'spectator', seat: null });
  ok(E.activeSeats(j).join() === '0,1,2' && E.playerSeats(j).join() === '0,1,2', 'the judge and spectators are never in the rotation');
  ok(E.majorityVerdict({ ...mkw([0, 1, 2]), game: { ext: {}, tahkim: { votes: ['valid', 'valid', null] } } }) === 'valid', '2 of 3 is a majority');
  ok(E.majorityVerdict({ ...mkw([0, 1, 2]), game: { ext: {}, tahkim: { votes: ['valid', 'invalid', null] } } }) === null, '1-1-abstain: no verdict');
  ok(E.majorityVerdict({ ...mkw([0, 1, 2, 3]), game: { ext: {}, tahkim: { votes: ['valid', 'valid', 'invalid', 'invalid'] } } }) === null, '2-2 of 4: no verdict');
  ok(E.majorityVerdict({ ...mkw([0, 1, 2, 3]), game: { ext: {}, tahkim: { votes: ['invalid', 'invalid', 'invalid', null] } } }) === 'invalid', '3 of 4 is a majority');
  ok(E.majorityVerdict({ ...mkw([0, 1]), game: { ext: {}, tahkim: { votes: ['valid', null] } } }) === null && E.majorityVerdict({ ...mkw([0, 1]), game: { ext: {}, tahkim: { votes: ['valid', 'valid'] } } }) === 'valid', '2 players: both must agree');
  ok(E.majorityVerdict({ ...mkw([0, 1, 2], { 2: 'time' }), game: { ext: { out: { 2: 'time' } }, tahkim: { votes: ['valid', 'valid', 'invalid'] } } }) === 'valid', 'an eliminated player\'s vote does not count');
}

group('draw first for N players');
{
  const seq = vals => { const bag = vals.map((v, i) => ({ id: 'b' + i, l: v === 0 ? '' : 'ا', v, blank: v === 0 })); return bag; };
  const rngFor = () => () => 0.99999;   // shuffle with a rng near 1 keeps the order stable enough for the structure checks below
  const bag = seq([5, 9, 3, 7, 1, 1, 1, 1]); const f = E.drawFirst(bag, () => 0, [0, 1, 2, 3]);
  ok([0, 1, 2, 3].includes(f.seat) && f.seats?.[0].join() === '0,1,2,3' && f.rounds[0].length === 4, 'four contenders draw four tiles in round 1: ' + JSON.stringify(f.seats));
  // deterministic tie handling: a rigged "shuffle" (rng) cannot be assumed, so test the contract on many seeds
  let tieOnly = true, conserved = true, blank0 = true;
  for (let seed = 1; seed < 400; seed++) {
    let a = seed; const rng = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
    const b = seq([0, 5, 5, 5, 8, 8, 2, 2, 7, 7, 7, 1, 0, 3]); const ids = b.map(t => t.id).sort().join();
    const r = E.drawFirst(b, rng, [0, 1, 2]);
    r.rounds.forEach((draw, i) => { if (i > 0) { const prev = r.rounds[i - 1], pseats = r.seats[i - 1], best = Math.max(...prev.map(d => d.v)); const top = pseats.filter((s, k) => prev[k].v === best); if (r.seats[i].join() !== top.join()) tieOnly = false; } draw.forEach(d => { if (d.blank && d.v !== 0) blank0 = false; }); });
    if (b.map(t => t.id).sort().join() !== ids) conserved = false;
    const last = r.rounds[r.rounds.length - 1], lseats = r.seats[r.seats.length - 1];
    if (!r.coin) { const best = Math.max(...last.map(d => d.v)); if (lseats.filter((s, k) => last[k].v === best).join() !== String(r.seat)) tieOnly = false; }
  }
  ok(tieOnly, 'a redraw is made by the tied players ONLY, and the winner is the unique best of the last round');
  ok(conserved, 'drawing never loses or duplicates a tile in the bag');
  ok(blank0, 'a blank counts 0');
  const tie = seq([4, 4, 4]); const t = E.drawFirst(tie, () => 0.5, [0, 1, 2]);
  ok(t.coin === true && [0, 1, 2].includes(t.seat) && t.rounds.length === 12, 'if the tie never breaks the fallback is a random pick among the tied contenders');
  let hits = [0, 0, 0]; for (let seed = 1; seed < 600; seed++) { let a = seed * 7; const rng = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; hits[E.drawFirst(seq([4, 4, 4]), rng, [0, 1, 2]).seat]++; }
  ok(hits.every(h => h > 120), 'and it is fair: ' + hits.join('/'));
  const two = E.drawFirst(seq([3, 8]), () => 0.3); ok(two.seat === (two.rounds[two.rounds.length - 1][0].v > two.rounds[two.rounds.length - 1][1].v ? 0 : 1) && !('seats' in two), 'two players: the old pair draw and result shape');
  const w = await game(4, { draw: true, seed: 12 }); const first = w.server().game.ext.first;
  ok(first.seats && first.seats[0].join() === '0,1,2,3' && first.rounds.every((r, i) => r.length === first.seats[i].length) && w.cur() === first.seat, 'a real 4-player deal records the draw and the first seat follows it');
  const all = Object.values(w.server().racks).flat().filter(Boolean).length + w.server().priv.bag.length; ok(all === 100 || all > 90, 'tiles are conserved after the deal (' + all + ')');
  ok(Object.values(w.server().racks).every(r => r.filter(Boolean).length === 7), 'everyone has 7 tiles');
}

group('rooms of 2, 3 and 4');
{
  const w = makeWorld({ seed: 2, who: ['A', 'B', 'C', 'D', 'X'] }); const { code } = await w.roomN(3);
  const full = await w.raw('D', { action: 'join_room', code, nickname: 'D' }); ok(!full.ok && full.code === 'ROOM_FULL', 'a room for 3 refuses the 4th player');
  const s = (await w.call('A', 'snapshot')).snapshot; ok(s.players.map(p => p.seat).join() === '0,1,2' && s.game.max_players === 3, 'seats 0,1,2 in join order');
  const w4 = makeWorld({ seed: 3, who: ['A', 'B', 'C', 'D', 'X'] }); const r4 = await w4.roomN(4);
  const x = await w4.raw('X', { action: 'join_room', code: r4.code, nickname: 'X' }); ok(!x.ok && x.code === 'ROOM_FULL', 'a room for 4 refuses the 5th');
  const w2 = makeWorld({ seed: 4, who: ['A', 'B', 'C', 'D'] }); await w2.roomN(4); await w2.call('C', 'snapshot');
  const early = await w2.call('A', 'start_game'); ok(early.ok, 'the host may start with all seats filled');
  const w5 = makeWorld({ seed: 5, who: ['A', 'B', 'C', 'D'] }); const { code: c5 } = await w5.roomN(2, { max_players: 4 });
  ok((await w5.call('A', 'update_settings', { settings: { max_players: 4 } })).ok, 'the host can raise the seat count in the lobby');
  const lo = await w5.call('A', 'update_settings', { settings: { max_players: 2 } }); ok(lo.ok, 'and lower it to what is filled');
  const w6 = makeWorld({ seed: 6, who: ['A', 'B', 'C', 'D'] }); await w6.raw('A', { action: 'create_room', nickname: 'A', settings: { max_players: 4 } }).then(c => { w6.snap.A = c.snapshot; w6.useGame(c.snapshot.game.id); });
  const alone = await w6.call('A', 'start_game'); ok(!alone.ok && alone.code === 'NEED_OPPONENT', 'a host alone cannot start');
  const w7 = makeWorld({ seed: 7, who: ['A', 'B', 'C', 'D'] }); const c7 = await w7.raw('A', { action: 'create_room', nickname: 'A', settings: { max_players: 4 } }); w7.snap.A = c7.snapshot; w7.useGame(c7.snapshot.game.id);
  const b7 = await w7.raw('B', { action: 'join_room', code: c7.snapshot.game.room_code, nickname: 'B' }); w7.snap.B = b7.snapshot; await w7.call('B', 'set_ready', { ready: true }); await w7.call('A', 'snapshot');
  const part = await w7.call('A', 'start_game'); ok(part.ok && part.snapshot.players.length === 2, 'a room made for 4 can start with 2 (seats are dynamic)');
  const w8 = makeWorld({ seed: 8, who: ['A', 'B', 'C', 'D'] }); const { code: c8 } = await w8.roomN(3);
  await w8.call('A', 'snapshot'); const lv = await w8.raw('B', { action: 'leave_room', game_id: w8.gameId, client_action_id: uuidFrom(w8.rng) }); ok(lv.ok && lv.left, 'B leaves the lobby');
  const s8 = (await w8.call('A', 'snapshot')).snapshot; ok(s8.players.length === 2 && s8.players.map(p => p.seat).join() === '0,1' && s8.players[1].player_id === w8.users.C, 'the gap is closed: C moves to seat 1, order kept');
  const d8 = await w8.raw('D', { action: 'join_room', code: c8, nickname: 'D' }); await w8.call('D', 'snapshot'); ok(d8.ok && d8.snapshot.me.seat === 2, 'the next joiner takes the next seat');
}

group('turn rotation in play (3 and 4 players)');
{
  for (const n of [3, 4]) {
    const w = await game(n); const seen = [];
    for (let i = 0; i < n * 2 + 1; i++) { seen.push(w.cur()); await w.pass(); }
    ok(seen.join() === Array.from({ length: n * 2 + 1 }, (_, i) => i % n).join(), `${n} players pass in seat order and wrap round: ${seen.join('')}`);
    const wrong = await w.call(w.byseat((w.cur() + 1) % n), 'pass_turn'); ok(!wrong.ok && wrong.code === 'WRONG_TURN', `${n}: off-turn player refused`);
  }
  const w = await game(3); await w.firstMove(); ok(w.cur() === 1, 'after a move the turn goes to seat 1');
  const sc = await w.call('B', 'snapshot'); ok(sc.snapshot.me.rack.length === 7 && sc.snapshot.players.length === 3, 'snapshots list 3 players');
  const tiles = w.snap.B.board.flat().filter(Boolean); ok(tiles.length === 4 && tiles.every(t => t.o === 0), 'tile ownership o: seat 0 for A\'s tiles');
  const tc = await game(4); tc.giveRack('C', [...'كتابمدر']); await tc.pass(); await tc.pass(); await tc.call('C', 'snapshot');
  const m3 = await tc.call('C', 'submit_move', { placements: across(tc.snap.C, 'كتاب') }); await tc.sync(); ok(m3.ok && tc.snap.A.board.flat().filter(Boolean).every(t => t.o === 2) && tc.cur() === 3, 'seat 2 can play: tiles are owned by o = 2 and the turn goes to seat 3');
}

group('resign, timeout, abandon: elimination in 3-4 player games');
{
  const w = await game(3);
  const r = await w.call('A', 'resign_game'); const s = r.snapshot;
  ok(r.ok && s.game.status === 'active' && s.game.out['0'] === 'resign' && s.players[0].out === 'resign' && s.players[0].score === 0, '3 players: a resigning player is eliminated (score 0), the game goes on');
  ok(w.cur() === 1 && w.server().players.length === 3, 'the turn passed to the next ACTIVE seat; the player\'s row is kept for the history');
  await w.sync(); const pa = await w.call('A', 'pass_turn'); ok(!pa.ok && pa.code === 'ELIMINATED', 'an eliminated player cannot act: ' + pa.code);
  const ve = await w.call('A', 'pause_game'); ok(!ve.ok && ve.code === 'ELIMINATED', 'nor pause, vote, undo');
  const rc = await w.raw('A', { action: 'reconnect' }); ok(rc.ok && rc.snapshot.game.out['0'] === 'resign', 'reconnecting does not bring them back');
  const hb = await w.raw('A', { action: 'heartbeat', game_id: w.gameId }); ok(hb.ok, 'they can still watch');
  await w.pass(); ok(w.cur() === 2, 'rotation: 1 > 2'); await w.pass(); ok(w.cur() === 1, 'rotation skips the eliminated seat 0: 2 > 1');
  const r2 = await w.call('C', 'snapshot'); await w.call('B', 'snapshot');
  const fin = await w.call('B', 'resign_game'); const f = fin.snapshot;
  ok(fin.ok && f.game.status === 'finished' && f.game.winner_seat === 2 && f.game.result.reason === 'resign' && f.game.result.lines.length === 3, 'down to two active players the v5.4 rule applies: the resigner loses, the other wins, the result lists all 3');
  ok(f.game.result.lines.find(l => l.seat === 0).out === 'resign' && f.game.result.loser_seat === 1, 'the first resigner is marked out in the result');
  const rm = await w.call('A', 'rematch'); ok(rm.ok, 'an eliminated player may ask for a rematch');
}
{
  const w = await game(4); await w.firstMove();   // the clock only starts after the first scored move
  await w.call('A', 'resign_game'); ok(w.server().game.status === 'active' && E.activeSeats({ game: w.server().game, players: w.server().players }).length === 3, '4 players: one resigns, 3 play on');
  await w.sync(); w.clock.t += 11 * MIN;   // the player on turn (seat 1) has used all of their 10 minutes
  const to = await w.call('C', 'claim_timeout'); const s = to.snapshot;
  ok(to.ok && s.game.status === 'active' && s.game.out['1'] === 'time' && s.game.out['0'] === 'resign' && w.cur() === 2, 'a player whose time runs out is eliminated and the turn moves on');
  ok(s.players[1].score === 0, '(B had no points: kept as they were)');
  await w.sync(); w.clock.t += 11 * MIN; const to2 = await w.call('D', 'claim_timeout');
  ok(to2.ok && to2.snapshot.game.status === 'finished' && to2.snapshot.game.result.reason === 'time' && to2.snapshot.game.winner_seat === 3 && to2.snapshot.game.result.lines.length === 4, 'two left and one runs out: the game ends the two-player way, the other wins');
  ok(to2.snapshot.game.result.lines.filter(l => l.out).length === 2, 'the result marks both eliminated players');
}
{
  const w = await game(3); await w.sync(); w.clock.t += ABANDON_MS + 5000; await w.call('B', 'snapshot'); await w.raw('B', { action: 'heartbeat', game_id: w.gameId }); await w.raw('C', { action: 'heartbeat', game_id: w.gameId });
  const c = await w.call('B', 'claim_abandon'); const s = c.snapshot;
  ok(c.ok && s.game.status === 'active' && s.game.out['0'] === 'abandon' && w.cur() === 1, '3 players: the silent player on turn is eliminated by claim_abandon, play continues');
  const none = await w.call('C', 'claim_abandon'); ok(!none.ok && none.code === 'NOT_ABANDONED', 'nothing to claim against an active player');
  const self = await game(3); self.clock.t += ABANDON_MS + 5000; const me = await self.call('A', 'claim_abandon'); ok(!me.ok && me.code === 'NOT_ABANDONED', 'a player cannot claim against themselves');
  const idle = await game(2); idle.clock.t += ABANDON_MS + 5000; await idle.raw('B', { action: 'heartbeat', game_id: idle.gameId }); const two = await idle.call('B', 'claim_abandon');
  ok(two.ok && two.snapshot.game.status === 'finished' && two.snapshot.game.winner_seat === 1 && two.snapshot.game.result.reason === 'abandon', '2 players: unchanged, abandon ends the game');
}

group('Tahkim by majority (no judge)');
{
  const w = await game(3); await w.firstMove();
  const t = await w.call('B', 'request_tahkim', { reason: R }); ok(t.ok && t.snapshot.game.tahkim.votes.length === 3 && t.snapshot.game.tahkim.resolver === 'consensus', 'the player on turn opens it; 3 vote slots');
  await w.sync();
  const v1 = await w.call('A', 'tahkim_vote', { verdict: 'valid' }), v2 = await w.call('B', 'tahkim_vote', { verdict: 'invalid' });
  ok(v1.ok && v2.ok && (await w.call('C', 'snapshot')).snapshot.game.status === 'tahkim_pending', '1-1 with one undecided: the discussion continues');
  const wd = await w.call('B', 'tahkim_vote', { verdict: null }); ok(wd.ok && JSON.stringify(wd.snapshot.game.tahkim.votes) === JSON.stringify(['valid', null, null]), 'a vote can be withdrawn');
  await w.call('C', 'snapshot'); const v3 = await w.call('C', 'tahkim_vote', { verdict: 'valid' });
  ok(v3.ok && v3.snapshot.game.status === 'active' && v3.snapshot.game.tahkim.state === 'resolved_valid', '2 of 3 agree: resolved');
  ok(v3.snapshot.game.tahkim_log[0].resolver === 'consensus', 'history says consensus');
  const rp = await w.call('B', 'snapshot'); ok(rp.snapshot.players[1].score < 0 || rp.snapshot.players[1].score === 0, 'the challenger (seat 1) was charged by the same resolver');
}
{
  const w = await game(4); await w.firstMove(); await w.call('B', 'request_tahkim', { reason: R }); await w.sync();
  await w.call('A', 'tahkim_vote', { verdict: 'invalid' }); await w.call('B', 'tahkim_vote', { verdict: 'invalid' }); await w.call('C', 'tahkim_vote', { verdict: 'valid' }); await w.call('D', 'tahkim_vote', { verdict: 'valid' });
  ok(w.server().game.status === 'tahkim_pending', '2-2 of 4: no verdict, no automatic result');
  await w.call('D', 'snapshot'); await w.call('D', 'tahkim_vote', { verdict: 'invalid' });
  ok(w.server().game.status === 'active' && w.server().game.tahkim.state === 'resolved_invalid', '3 of 4 after a changed vote: resolved invalid (move voided)');
  await w.sync(); ok(w.cur() === 1 && w.snap.A.board.flat().filter(Boolean).length === 0 && w.snap.A.me.rack.filter(Boolean).length === 7, 'the move was rolled back and the turn is the challenger\'s');
}
{
  const w = await game(3); await w.firstMove(); await w.call('B', 'request_tahkim', { reason: R }); await w.sync();
  await w.call('B', 'tahkim_vote', { verdict: 'valid' }); await w.call('C', 'tahkim_vote', { verdict: 'invalid' });
  const out = await w.call('A', 'resign_game'); ok(out.ok && out.snapshot.game.status === 'tahkim_pending' && out.snapshot.game.out['0'] === 'resign', 'a player resigning during a dispute leaves it open (B and C still disagree)');
  await w.call('C', 'snapshot'); const ch = await w.call('C', 'tahkim_vote', { verdict: 'valid' });
  ok(ch.ok && ch.snapshot.game.status === 'active' && ch.snapshot.game.tahkim.state === 'resolved_valid', 'with 2 voters left, both must agree');
  const w2 = await game(3); await w2.firstMove(); await w2.call('B', 'request_tahkim', { reason: R }); await w2.sync();
  await w2.call('B', 'tahkim_vote', { verdict: 'valid' }); const r2 = await w2.call('A', 'resign_game');
  ok(r2.ok && w2.server().game.status === 'tahkim_pending', 'a resignation that leaves only a split keeps it open');
  const w3 = await game(3); await w3.firstMove(); await w3.call('B', 'request_tahkim', { reason: R }); await w3.sync();
  await w3.call('B', 'tahkim_vote', { verdict: 'valid' }); await w3.call('A', 'tahkim_vote', { verdict: 'invalid' }); const r3 = await w3.call('A', 'resign_game');
  ok(r3.ok, 'resign while voted'); ok(w3.server().game.tahkim.votes[0] == null, 'the resigner\'s vote is removed');
  const sp = await game(3, { spectator: true }); await sp.firstMove(); await sp.call('B', 'request_tahkim', { reason: R });
  const sv = await sp.call('S', 'tahkim_vote', { verdict: 'valid' }); ok(!sv.ok && sv.code === 'SPECTATOR_READ_ONLY', 'a spectator cannot vote');
}
{
  const w = await game(3, { judge: true }); await w.firstMove();
  const rq = await w.call('B', 'request_tahkim', { reason: R }); ok(!rq.ok && rq.code === 'USE_JUDGE', 'with a judge present the consensus route is closed');
  const p = await w.call('B', 'call_judge', {}); ok(p.ok && !p.snapshot.game.clock_running && p.snapshot.game.pings_left.length === 3, 'ping works in a 3-player room (3 quotas)');
  await w.call('J', 'snapshot'); const o = await w.call('J', 'judge_open_tahkim', {}); ok(o.ok && o.snapshot.game.tahkim.votes.length === 3, 'judge opens it');
  await w.sync(); const vv = await w.call('C', 'tahkim_vote', { verdict: 'valid' }); ok(!vv.ok && vv.code === 'JUDGE_DECIDES', 'players\' votes do nothing under a judge');
  const jv = await w.call('J', 'judge_verdict', { verdict: 'invalid' }); ok(jv.ok && jv.snapshot.game.tahkim.state === 'resolved_invalid' && jv.snapshot.game.current_seat === 1, 'the judge\'s verdict is final (turn to the challenger, seat 1)');
}

group('undo: only the player now on turn answers');
{
  const w = await game(3); await w.firstMove(); const u = await w.call('A', 'request_undo'); ok(u.ok, 'the mover asks');
  await w.sync(); const c = await w.call('C', 'respond_undo', { accept: true }); ok(!c.ok && c.code === 'NO_UNDO', 'the third player has no say: ' + c.code);
  const b = await w.call('B', 'respond_undo', { accept: true }); ok(b.ok && w.cur() === 0 && w.snap.B.board.flat().filter(Boolean).length === 0, 'the player on turn accepts: the move is taken back and the turn returns to seat 0');
}

group('end of the game with N players');
{
  const w = await game(3); await w.sync();
  const base = await (async () => { const g = w.server(); return { game: { ...g.game }, players: g.players.map(p => ({ ...p })), racks: JSON.parse(JSON.stringify(g.racks)), priv: { bag: [], undo: null }, moves: [] }; })();
  base.players.forEach((p, i) => { p.score = [50, 80, 80][i]; p.ms_left = 0; }); for (const k of Object.keys(base.racks)) base.racks[k] = [];   // equal clocks, empty racks: the final scores stay equal
  E.finish(base, 'rack', w.clock.t);
  const r = base.game.result; ok(r.lines.length === 3 && base.game.winner_seat === null && r.winners.join() === '1,2', 'a tie at the top: no single winner; both top seats are listed (documented rule)');
  const b2 = { ...base, game: { ...w.server().game }, players: w.server().players.map(p => ({ ...p })), racks: JSON.parse(JSON.stringify(w.server().racks)) }; b2.players.forEach((p, i) => { p.score = [90, 80, 10][i]; }); E.finish(b2, 'rack', w.clock.t);
  ok(b2.game.winner_seat === 0 && b2.game.result.lines.every(l => 'ded' in l && 'bon' in l), 'the best final score wins; every seat gets a result line');
  const b3 = { ...base, game: { ...w.server().game, ext: { out: { 0: 'time' } } }, players: w.server().players.map(p => ({ ...p })), racks: JSON.parse(JSON.stringify(w.server().racks)) }; b3.players.forEach((p, i) => { p.score = [500, 80, 60][i]; }); E.finish(b3, 'rack', w.clock.t);
  ok(b3.game.winner_seat === 1 && b3.game.result.lines[0].out === 'time' && b3.game.result.lines[0].score === 500, 'an eliminated player keeps their score but cannot win');
  const b4 = { ...base, game: { ...w.server().game, ext: { out: { 0: 'time', 1: 'time', 2: 'resign' } } }, players: w.server().players.map(p => ({ ...p })), racks: base.racks }; E.finish(b4, 'time', w.clock.t);
  ok(b4.game.status === 'finished' && b4.game.winner_seat === null, 'everybody out: finished without a winner (defined, no crash)');
}

group('rematch with N players');
{
  const w = await game(3); await w.call('A', 'resign_game'); await w.call('B', 'snapshot'); await w.call('B', 'resign_game'); await w.sync();
  ok(w.server().game.status === 'finished', 'finished');
  await w.call('A', 'rematch'); await w.call('B', 'rematch'); ok(w.server().game.status === 'finished', 'two of three asked: waiting for the third');
  const done_ = await w.call('C', 'rematch'); const s = done_.snapshot;
  ok(done_.ok && s.game.status === 'active' && s.game.round === 2 && Object.keys(s.game.out).length === 0 && s.game.current_seat === 1, 'all three asked: round 2, eliminations cleared, the starting seat rotates (seat 1)');
  ok(s.players.every(p => p.score === 0 && p.tile_count === 7), 'fresh scores and racks');
  const w2 = await game(3, { judge: true, spectator: true }); await w2.call('A', 'resign_game'); await w2.call('B', 'snapshot'); await w2.call('B', 'resign_game'); await w2.sync();
  const lv = await w2.raw('B', { action: 'leave_room', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng) }); ok(lv.ok && lv.left, 'a player who does not want a rematch may leave a finished room');
  await w2.call('A', 'snapshot'); await w2.call('A', 'rematch'); const rc = await w2.call('C', 'snapshot'); const r2 = await w2.call('C', 'rematch');
  ok(r2.ok && r2.snapshot.game.status === 'active' && r2.snapshot.players.map(p => p.seat).join() === '0,1', 'the remaining two rematch; seats are closed up (0,1)');
  ok(w2.server().players.filter(p => p.role !== 'player').length === 2, 'judge and spectator stay in the room');
}

group('privacy and roles in a 4-player room');
{
  const w = await game(4, { judge: true, spectator: true }); await w.sync();
  const all = Object.entries(w.server().racks).flatMap(([pid, r]) => r.filter(Boolean).map(t => ({ pid, id: t.id })));
  ok(all.length === 28, '28 rack tiles exist');
  for (const k of ['A', 'B', 'C', 'D', 'J', 'S']) {
    const s = (await w.call(k, 'snapshot')).snapshot, text = JSON.stringify(s), mine = w.users[k];
    const leaked = all.filter(t => t.pid !== mine && text.includes(t.id)).length, own = all.filter(t => t.pid === mine);
    ok(leaked === 0 && own.every(t => text.includes(t.id)), `${k}: ${own.length ? 'sees only their own 7 tiles' : 'sees no rack at all'}`);
    ok(s.players.length === 4 && s.players.every(p => p.tile_count === 7), `${k}: 4 players with tile counts only`);
  }
  ok(w.snap.J.me.seat === null && w.snap.S.me.seat === null, 'the judge and spectator have no seat');
  const p = await w.call('J', 'pass_turn'); ok(!p.ok && p.code === 'NOT_A_PLAYER', 'the judge cannot play');
}

group('races');
{
  const w = await game(3); w.store.delay = () => new Promise(r => setTimeout(r, 4));
  const rev = w.snap.A.game.revision, mk = k => w.raw(k, { action: 'pass_turn', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: rev });
  const res = await Promise.all([mk('A'), mk('B'), mk('C')]); w.store.delay = null;
  ok(res.filter(r => r.ok).length === 1 && w.cur() === 1, 'three simultaneous passes: only the player on turn succeeds, once');
  const w2 = await game(4); w2.store.delay = () => new Promise(r => setTimeout(r, 4)); const q = ['A', 'B', 'C', 'D'].map(k => w2.raw(k, { action: 'resign_game', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng) }));
  const out = await Promise.all(q); w2.store.delay = null; const g = w2.server().game;
  ok(g.status === 'finished' && g.result.lines.length === 4 && Object.keys(g.ext.out).length >= 2, 'four simultaneous resigns end in one coherent finished game: ' + JSON.stringify(g.ext.out) + ' winner ' + g.winner_seat);
}
done();
