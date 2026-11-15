// The 30-second turn limit: a player who has not played, passed or swapped in time is skipped by the server.
import { makeWorld, suite, across } from './lib.mjs';
const { ok, group, done } = suite('online: turn limit (auto-skip after 30 s)');
const SEC = 1000;

group('the limit runs from the start of the turn, for every player');
{
  const w = makeWorld(); await w.start({ minutes: 10 });
  const g = w.snap.A.game; ok(g.turn_limit === true && typeof g.turn_began === 'number', 'a new room has the 30 s limit on and a turn start');
  const first = g.current_seat, host = first === 0 ? 'A' : 'B', other = host === 'A' ? 'B' : 'A';
  w.clock.t += 29 * SEC;
  const early = await w.call(other, 'skip_turn'); ok(!early.ok && early.code === 'NOT_YET', 'nobody can skip before the limit: ' + early.code);
  w.clock.t += 3.5 * SEC;   // 32.5 s: past the limit and the 2 s grace
  const r = await w.call(other, 'skip_turn');
  ok(r.ok && r.snapshot.game.current_seat !== first, 'after the limit the opponent can have the turn skipped');
  ok(r.snapshot.game.skipped && r.snapshot.game.skipped.seat === first, 'the snapshot says WHO was skipped');
  ok(r.snapshot.game.turn_began === w.clock.t, 'and the next turn starts its own 30 s');
  ok(r.snapshot.game.tahkim_available === false, 'a skip cannot be challenged or undone');
}
group('a late request is replaced by the skip (the slow player cannot act after the limit)');
{
  const w = makeWorld(); await w.start({ minutes: 10 });
  const first = w.snap.A.game.current_seat, host = first === 0 ? 'A' : 'B';
  w.giveRack(host, [...'كتاب']); await w.call(host, 'snapshot');
  w.clock.t += 33 * SEC;
  const mv = await w.call(host, 'submit_move', { placements: across(w.snap[host], 'كتاب') });
  ok(mv.ok && mv.snapshot.game.current_seat !== first && mv.snapshot.board.flat().every(x => !x), 'the late move did not happen: the turn was skipped instead');
}
group('a move inside the limit (and its grace) is accepted');
{
  const w = makeWorld(); await w.start({ minutes: 10 });
  const first = w.snap.A.game.current_seat, host = first === 0 ? 'A' : 'B';
  w.giveRack(host, [...'كتاب']); await w.call(host, 'snapshot');
  w.clock.t += 31 * SEC;   // over 30 s but inside the 2 s grace
  const mv = await w.call(host, 'submit_move', { placements: across(w.snap[host], 'كتاب') });
  ok(mv.ok && mv.snapshot.board.flat().some(x => x), 'accepted');
}
group('a pause stops the limit and restarts it');
{
  const w = makeWorld(); await w.start({ minutes: 10 });
  const first = w.snap.A.game.current_seat, host = first === 0 ? 'A' : 'B', other = host === 'A' ? 'B' : 'A';
  w.clock.t += 20 * SEC;
  const p = await w.call(host, 'pause_game'); ok(p.ok, 'paused');
  w.clock.t += 60 * SEC;
  const during = await w.call(other, 'skip_turn'); ok(!during.ok, 'no skip while paused: ' + during.code);
  const rs = await w.call(host, 'resume_game'); ok(rs.ok && rs.snapshot.game.turn_began === w.clock.t, 'resuming gives the player a fresh 30 s');
  w.clock.t += 5 * SEC; const again = await w.call(other, 'skip_turn'); ok(!again.ok && again.code === 'NOT_YET', 'the 20 s before the pause did not count');
}
group('the host can switch the limit off');
{
  const w = makeWorld(); await w.start({ minutes: 10, turn_limit: false });
  ok(w.snap.A.game.turn_limit === false, 'the room has no turn limit');
  w.clock.t += 120 * SEC; const r = await w.call('B', 'skip_turn'); ok(!r.ok, 'skip_turn is refused when the limit is off: ' + r.code);
  const bad = await makeWorld().raw('A', { action: 'create_room', nickname: 'A', settings: { turn_limit: 'maybe' } }); ok(!bad.ok && bad.code === 'BAD_REQUEST', 'only a boolean is accepted');
}
group('everyone can be skipped in turn: the game goes on, the clock keeps running');
{
  const w = makeWorld(); await w.start({ minutes: 10 });
  let seats = new Set();
  for (let i = 0; i < 4; i++) { w.clock.t += 33 * SEC; const r = await w.call('A', 'skip_turn'); ok(r.ok, `skip ${i + 1}`); seats.add(r.snapshot.game.skipped.seat); }
  ok(seats.size === 2 && w.snap.A.game.status === 'active', 'both players were skipped and the match is still active');
}
done();
