// V6.2: the lobby as a set of slots (free choice of seat / role) and the drawn turn order. Real server core, in-memory store.
import { makeWorld, suite, across, uuidFrom } from './lib.mjs';
import * as E from '../../supabase/functions/_shared/core/engine.js';
const { ok, group, done } = suite('online slots v6.2: free choice of slot, drawn turn order');
const WHO = ['A', 'B', 'C', 'D', 'J', 'S', 'X'];

async function lobby(n, settings = {}, joiners = []) {
  const w = makeWorld({ seed: 31, who: WHO, draw: true });   // draw: true = the real start (turn order and first player are drawn)
  const c = await w.raw('A', { action: 'create_room', nickname: 'A', settings: { max_players: n, judge_enabled: true, max_spectators: 2, ...settings } }); w.snap.A = c.snapshot; w.useGame(c.snapshot.game.id); w.code = c.snapshot.game.room_code;
  for (const k of joiners) { const r = await w.raw(k, { action: 'join_room', code: w.code, nickname: k }); w.snap[k] = r.snapshot; }
  for (const k of ['A', ...joiners]) await w.call(k, 'snapshot');
  w.pick = (k, kind, slot) => w.call(k, 'choose_slot', slot === undefined ? { kind } : { kind, slot });
  w.view = async () => (await w.call('A', 'snapshot')).snapshot;
  return w;
}
const seats = s => s.players.map(p => p.seat).join();

group('choosing a seat');
{
  const w = await lobby(4, {}, ['B']);
  const r = await w.pick('B', 'player', 3); ok(r.ok && r.snapshot.me.seat === 3, 'a guest may sit in any empty seat (seat 4)');
  const s = await w.view(); ok(seats(s) === '0,3' && s.players.find(p => p.seat === 3).nickname === 'B', 'the lobby shows seats 0 and 3 taken, 1 and 2 empty');
  const t = await w.pick('A', 'player', 3); ok(!t.ok && t.code === 'SEAT_TAKEN', 'a taken seat is refused: ' + t.code);
  const m = await w.pick('A', 'player', 1); ok(m.ok && m.snapshot.me.seat === 1 && m.snapshot.game.host_player_id === w.users.A, 'the host may move to another empty seat and stays the host');
  const u = await w.pick('B', 'player', 9); ok(!u.ok && u.code === 'BAD_REQUEST', 'a seat that does not exist is refused');
  const same = await w.pick('B', 'player', 3); ok(same.ok, 'choosing your own seat again changes nothing');
  const small = await lobby(2, {}, ['B']); const over = await small.pick('B', 'player', 2); ok(!over.ok && over.code === 'BAD_REQUEST', 'a seat beyond the room size (2) is refused');
  const ready = await lobby(4, {}, ['B', 'C']); await ready.call('B', 'snapshot'); await ready.call('B', 'set_ready', { ready: true });
  const mv = await ready.pick('B', 'player', 3); ok(mv.ok && (await ready.view()).players.find(p => p.seat === 3).ready === true, 'moving between seats keeps "ready"');
}

group('switching role in the lobby');
{
  const w = await lobby(3, {}, ['B', 'C']);
  const j = await w.pick('B', 'judge'); ok(j.ok && j.snapshot.me.role === 'judge' && j.snapshot.me.seat === null && j.snapshot.me.rack.length === 0, 'a player takes the judge chair: role judge, no seat, no rack');
  let s = await w.view(); ok(s.players.length === 2 && s.judge?.nickname === 'B', 'the seat is free again and the judge appears');
  ok(w.server().racks[w.users.B] === undefined, 'B\'s rack is gone on the server');
  const j2 = await w.pick('C', 'judge'); ok(!j2.ok && j2.code === 'JUDGE_TAKEN', 'one judge only');
  const sp = await w.pick('B', 'spectator'); ok(sp.ok && sp.snapshot.me.role === 'spectator', 'the judge may move to the gallery');
  s = await w.view(); ok(s.judge === null && s.spectator_count === 1 && s.spectators.map(x => x.nickname).join() === 'B', 'the gallery lists B by name in the lobby');
  const back = await w.pick('B', 'player', 1); ok(back.ok && back.snapshot.me.role === 'player' && back.snapshot.me.seat === 1 && back.snapshot.me.rack.length === 0, 'and back to a seat (empty rack until the deal)');
  ok(w.server().racks[w.users.B] !== undefined && w.server().players.find(p => p.player_id === w.users.B).ready === false, 'a rack row is created again, and ready is reset');
  const h = await w.pick('A', 'judge'); ok(!h.ok && h.code === 'HOST_MUST_PLAY', 'the host keeps a player seat: ' + h.code);
  const hs = await w.pick('A', 'spectator'); ok(!hs.ok && hs.code === 'HOST_MUST_PLAY', 'also not the gallery');
  const nj = await lobby(2, { judge_enabled: false }, ['B']); const r = await nj.pick('B', 'judge'); ok(!r.ok && r.code === 'JUDGE_DISABLED', 'no judge chair in a room without a judge');
  const cap = await lobby(2, { max_spectators: 1 }, ['B', 'C']).catch(() => null);
  const w3 = await lobby(3, { max_spectators: 1 }, ['B', 'C']); await w3.pick('B', 'spectator'); const full = await w3.pick('C', 'spectator'); ok(!full.ok && full.code === 'SPECTATORS_FULL', 'gallery capacity is enforced');
  const w4 = await lobby(2, {}, ['B']); await w4.pick('B', 'spectator'); const x = await w4.raw('X', { action: 'join_room', code: w4.code, nickname: 'X' }); w4.snap.X = x.snapshot; await w4.call('X', 'snapshot');
  const p = await w4.pick('X', 'player', 1); ok(p.ok, 'a seat freed by a spectator-switch can be taken by someone else');
  const w5 = await lobby(2, {}, ['B']); const x5 = await w5.raw('X', { action: 'join_room', code: w5.code, nickname: 'X', role: 'spectator' }); w5.snap.X = x5.snapshot; await w5.call('X', 'snapshot');
  const full5 = await w5.pick('X', 'player', 1); ok(!full5.ok && full5.code === 'SEAT_TAKEN', 'a spectator cannot take an occupied seat'); const lone = await lobby(2, {}, []); 
}

group('nobody can change slot outside the lobby, nor without being in the room');
{
  const w = await lobby(2, {}, ['B']); await w.call('B', 'snapshot'); await w.call('B', 'set_ready', { ready: true }); await w.call('A', 'snapshot'); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  const r = await w.pick('B', 'spectator'); ok(!r.ok && r.code === 'WRONG_STATUS', 'no slot change once the game started: ' + r.code);
  const o = await w.pick('X', 'player', 1); ok(!o.ok && o.code === 'NOT_MEMBER', 'a stranger cannot choose a slot');
  const bad = await (await lobby(2, {}, ['B'])).pick('B', 'referee'); ok(!bad.ok && bad.code === 'BAD_REQUEST', 'an unknown kind is refused');
}

group('settings cannot strand a seat');
{
  const w = await lobby(4, {}, ['B']); await w.pick('B', 'player', 3);
  const lo = await w.call('A', 'update_settings', { settings: { max_players: 3 } }); ok(!lo.ok && lo.code === 'BAD_REQUEST', 'lowering the room below the highest used seat is refused');
  await w.pick('B', 'player', 1); const ok2 = await w.call('A', 'update_settings', { settings: { max_players: 2 } }); ok(ok2.ok, 'after moving down it is allowed');
}

group('start: gaps are closed, the turn order is drawn');
{
  const w = await lobby(4, {}, ['B', 'C']); await w.pick('B', 'player', 3); await w.pick('C', 'player', 2);
  for (const k of ['B', 'C']) { await w.call(k, 'snapshot'); await w.call(k, 'set_ready', { ready: true }); }
  await w.call('A', 'snapshot'); const st = await w.call('A', 'start_game'); const s = st.snapshot;
  ok(st.ok && seats(s) === '0,1,2' && s.players[1].nickname === 'C' && s.players[2].nickname === 'B', 'seats 0,2,3 become 0,1,2 with the same relative order');
  const g = s.game; ok(Array.isArray(g.order) && [...g.order].sort().join() === '0,1,2', 'a turn order was drawn for the three players: ' + JSON.stringify(g.order));
  ok(E.nextSeat({ game: { ext: { order: g.order, out: {} } }, players: s.players.map(p => ({ ...p, role: 'player' })) }, g.order[0]) === g.order[1], 'the rotation follows the drawn order');
  // play the rotation and check it follows `order` and skips the eliminated
  const seen = []; for (let i = 0; i < 6; i++) { const cur = w.server().game.current_seat; seen.push(cur); const k = ['A', 'C', 'B'][cur]; await w.call(k, 'snapshot'); await w.call(k, 'pass_turn'); }
  const o = g.order, cyc = []; let at = o.indexOf(seen[0]); for (let i = 0; i < 6; i++) cyc.push(o[(at + i) % 3]);
  ok(seen.join() === cyc.join(), `three players rotate along the drawn order: ${seen.join('')} in ${o.join('')}`);
}
{
  // statistical: the drawn order is fair and always a permutation; two players never get an order
  const counts = {}; let perm = true;
  for (let seed = 1; seed < 241; seed++) {
    const w = makeWorld({ seed, who: WHO, draw: true }); const c = await w.raw('A', { action: 'create_room', nickname: 'A', settings: { max_players: 3 } }); w.snap.A = c.snapshot; w.useGame(c.snapshot.game.id);
    for (const k of ['B', 'C']) { const r = await w.raw(k, { action: 'join_room', code: c.snapshot.game.room_code, nickname: k }); w.snap[k] = r.snapshot; await w.call(k, 'snapshot'); await w.call(k, 'set_ready', { ready: true }); }
    await w.call('A', 'snapshot'); const s = (await w.call('A', 'start_game')).snapshot; const o = s.game.order; if (!o || [...o].sort().join() !== '0,1,2') perm = false; counts[o.join('')] = (counts[o.join('')] || 0) + 1;
  }
  ok(perm, 'always a permutation of the three seats'); ok(Object.keys(counts).length === 6 && Object.values(counts).every(c => c > 18), 'all 6 orders occur, none dominates: ' + JSON.stringify(counts));
  const w2 = await lobby(2, {}, ['B']); await w2.call('B', 'snapshot'); await w2.call('B', 'set_ready', { ready: true }); await w2.call('A', 'snapshot'); const s2 = (await w2.call('A', 'start_game')).snapshot; ok(s2.game.order === null, 'two players: no order is drawn (the rotation of two seats has nothing to draw)');
}
{
  const w = await lobby(3, {}, ['B', 'C']); for (const k of ['B', 'C']) { await w.call(k, 'snapshot'); await w.call(k, 'set_ready', { ready: true }); }
  await w.call('A', 'snapshot'); await w.call('A', 'start_game'); await w.call('A', 'snapshot'); const o1 = w.server().game.ext.order;
  await w.call('A', 'resign_game'); await w.call('B', 'snapshot'); await w.call('B', 'resign_game'); for (const k of ['A', 'B', 'C']) await w.call(k, 'snapshot');
  ok(w.server().game.status === 'finished', 'finished'); for (const k of ['A', 'B', 'C']) { await w.call(k, 'snapshot'); await w.call(k, 'rematch'); }
  const o2 = w.server().game.ext.order; ok(w.server().game.status === 'active' && w.server().game.round === 2 && Array.isArray(o2) && [...o2].sort().join() === '0,1,2', 'a rematch draws a new order: ' + o1.join('') + ' -> ' + o2.join(''));
}
done();
