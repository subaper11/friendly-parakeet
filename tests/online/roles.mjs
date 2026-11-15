// V6.0 roles: Player / Judge / Spectator. The REAL server core on the in-memory store (that is NOT a database test: RLS and the SQL constraints are checked by supabase/tests/roles_rls.sql).
import { makeWorld, suite, across, uuidFrom } from './lib.mjs';
const { ok, group, done } = suite('online roles v6.0: join rules, capacity, rack privacy, authorization, roster lifecycle');
const tick = ms => new Promise(r => setTimeout(r, ms));
const WHO = ['A', 'B', 'J', 'S', 'T', 'U', 'X', 'Y'];

async function room(settings = {}, { start = false } = {}) {
  const w = makeWorld({ seed: 11, who: WHO });
  await w.room({ judge_enabled: true, max_spectators: 2, ...settings });
  if (start) { await w.call('A', 'start_game'); await w.call('B', 'snapshot'); }
  return w;
}
const code = w => w.snap.A.game.room_code;
const join = async (w, k, role, extra = {}) => { const r = await w.raw(k, { action: 'join_room', code: code(w), nickname: 'n' + k, role, ...extra }); if (r.snapshot) w.snap[k] = r.snapshot; return r; };
const racksOf = w => Object.values(w.server().racks).flat().filter(Boolean);
const text = x => JSON.stringify(x);

group('room configuration');
{
  const w = makeWorld({ seed: 3, who: WHO });
  const c = await w.raw('A', { action: 'create_room', nickname: 'A', settings: {} }); const g = c.snapshot.game;
  ok(g.max_players === 2 && g.judge_enabled === false && g.max_spectators === 10, 'defaults: 2 players, no judge, 10 spectators');
  ok(c.snapshot.me.role === 'player' && c.snapshot.me.seat === 0 && c.snapshot.judge === null && c.snapshot.spectator_count === 0, 'host is a player on seat 0; no judge, no spectators yet');
  const w2 = await room({ judge_enabled: true, max_spectators: 5 });
  ok(w2.snap.A.game.judge_enabled === true && w2.snap.A.game.max_spectators === 5, 'host settings are applied');
  for (const good of [2, 3, 4]) { const r = await makeWorld({ seed: 4, who: WHO }).raw('A', { action: 'create_room', nickname: 'A', settings: { max_players: good } }); ok(r.ok && r.snapshot.game.max_players === good, `max_players ${good} accepted (V6.1)`); }
  for (const bad of [{ max_players: 5 }, { max_players: '2' }, { judge_enabled: 'yes' }, { max_spectators: 31 }, { max_spectators: -1 }, { max_spectators: 1.5 }]) {
    const r = await makeWorld({ seed: 5, who: WHO }).raw('A', { action: 'create_room', nickname: 'A', settings: bad }); ok(!r.ok && r.code === 'BAD_REQUEST', 'invalid setting refused: ' + text(bad));
  }
  const u = await w2.call('A', 'update_settings', { settings: { max_spectators: 8, judge_enabled: false } }); ok(u.ok && u.snapshot.game.max_spectators === 8 && u.snapshot.game.judge_enabled === false, 'the host can change judge / spectator rules in the lobby');
  const nb = await w2.call('B', 'update_settings', { settings: { max_spectators: 1 } }); ok(!nb.ok && nb.code === 'NOT_HOST', 'a guest cannot change rules');
}

group('joining: judge');
{
  const w = await room({ judge_enabled: false }); const r = await join(w, 'J', 'judge');
  ok(!r.ok && r.code === 'JUDGE_DISABLED', 'no judge slot in a room without a judge');
  const w2 = await room(); const j = await join(w2, 'J', 'judge');
  ok(j.ok && j.role === 'judge' && j.snapshot.me.role === 'judge' && j.snapshot.me.seat === null && j.snapshot.me.rack.length === 0, 'judge joins with no seat and no rack');
  ok(j.snapshot.players.length === 2 && j.snapshot.players.every(p => p.seat === 0 || p.seat === 1) && j.snapshot.judge?.nickname === 'nJ', 'the judge is NOT listed among the players; it has its own entry');
  const j2 = await join(w2, 'S', 'judge'); ok(!j2.ok && j2.code === 'JUDGE_TAKEN', 'a second judge is refused (not silently turned into a player or spectator)');
  const again = await join(w2, 'J', 'player'); ok(again.ok && again.rejoined && again.role === 'judge', 'a member who comes back keeps their role, whatever they ask for');
  ok(w2.server().players.filter(p => p.role === 'judge').length === 1 && w2.server().players.find(p => p.role === 'judge').seat === null, 'server rows: one judge, seat null');
}

group('joining: spectators, capacity and fallback');
{
  const w = await room({ max_spectators: 2 });
  const s1 = await join(w, 'S', 'spectator'), s2 = await join(w, 'T', 'spectator'), s3 = await join(w, 'U', 'spectator');
  ok(s1.ok && s2.ok && s1.snapshot.me.role === 'spectator' && s1.snapshot.me.seat === null, 'spectators join without a seat');
  ok(!s3.ok && s3.code === 'SPECTATORS_FULL', 'the third spectator is refused: capacity 2');
  const p3 = await join(w, 'X', 'player'); ok(!p3.ok && p3.code === 'ROOM_FULL' && p3.can_spectate === false, 'a third player is refused in a room for two: room full (and no spectator seat to offer)');
  const w2 = await room({ max_spectators: 3 }); const p = await join(w2, 'X', 'player');
  ok(!p.ok && p.code === 'ROOM_FULL' && p.can_spectate === true, 'the refusal says watching is possible');
  const fb = await join(w2, 'X', 'player', { allow_spectator: true });
  ok(fb.ok && fb.role === 'spectator' && fb.fell_back === true && fb.snapshot.me.role === 'spectator', 'with allow_spectator the fallback happens and the answer SAYS so (role + fell_back)');
  const bad = await join(w2, 'Y', 'referee'); ok(!bad.ok && bad.code === 'BAD_REQUEST', 'unknown role refused');
  const lv = await w2.raw('X', { action: 'leave_room', game_id: w2.gameId, client_action_id: uuidFrom(w2.rng) }); ok(lv.ok && lv.left, 'a spectator can leave');
  const w3 = await room({ max_spectators: 0 }); const z = await join(w3, 'S', 'spectator'); ok(!z.ok && z.code === 'SPECTATORS_FULL', 'capacity 0: no spectators at all');
}

group('joining while the match runs');
{
  const w = await room({ max_spectators: 3 }, { start: true });
  const late = await join(w, 'X', 'player'); ok(!late.ok && late.code === 'GAME_STARTED' && late.can_spectate === true, 'a new PLAYER cannot join a running match (and is told they could watch)');
  const j = await join(w, 'J', 'judge'); ok(j.ok && j.role === 'judge', 'a judge may join mid-match');
  const s = await join(w, 'S', 'spectator'); ok(s.ok && s.role === 'spectator', 'a spectator may join mid-match');
  ok(w.server().players.length === 4 && w.server().game.status === 'active', 'match unaffected (4 members, still active)');
  const d = await join(w, 'Y', 'player', { allow_spectator: true }); ok(d.ok && d.fell_back, 'mid-match fallback to spectator works too');
}

group('a spectator or judge arriving never makes a player\'s move stale');
{
  const w = await room({ max_spectators: 3 }, { start: true });
  w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot'); const rev = w.snap.A.game.revision;
  await join(w, 'S', 'spectator'); await join(w, 'J', 'judge');
  ok(w.server().game.revision === rev, 'revision unchanged by roster joins');
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') }); ok(r.ok && !r.code, 'the pinned move still goes through');
  ok(w.store.events.some(e => e.event === 'ROSTER'), 'the roster change was announced on its own');
}

group('rack privacy: every response path');
{
  const w = await room({ max_spectators: 3 }, { start: true });
  await join(w, 'J', 'judge'); await join(w, 'S', 'spectator');
  const ids = racksOf(w).map(t => t.id); ok(ids.length === 14, '14 rack tiles exist on the server');
  const A = w.server().racks[w.users.A].filter(Boolean).map(t => t.id), B = w.server().racks[w.users.B].filter(Boolean).map(t => t.id);
  const leaks = (snap, who) => ids.filter(i => text(snap).includes(i) && !who.includes(i));
  for (const k of ['J', 'S']) {
    const s = (await w.call(k, 'snapshot')).snapshot; ok(s.me.rack.length === 0 && !leaks(s, []).length, `${k}: snapshot carries no rack of anyone`);
    ok(!('racks' in s) && s.players.every(p => !('rack' in p)), `${k}: no rack field on any player`);
    const rc = (await w.raw(k, { action: 'reconnect' })).snapshot; ok(!leaks(rc, []).length && rc.me.rack.length === 0, `${k}: reconnect snapshot is clean`);
    const hb = await w.raw(k, { action: 'heartbeat', game_id: w.gameId }); ok(hb.ok && !leaks(hb, []).length, `${k}: heartbeat answer is clean`);
    const dupBody = { action: 'pass_turn', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: s.game.revision };
    const e1 = await w.raw(k, dupBody); ok(!e1.ok && !leaks(e1, []).length, `${k}: a refused action answers without any rack`);
    const stale = await w.raw(k, { ...dupBody, client_action_id: uuidFrom(w.rng), base_revision: 1 }); ok(!leaks(stale, []).length, `${k}: a stale-state error with a snapshot is clean`);
  }
  const sa = (await w.call('A', 'snapshot')).snapshot, sb = (await w.call('B', 'snapshot')).snapshot;
  ok(sa.me.role === 'player' && !leaks(sa, A).length && A.every(i => text(sa).includes(i)), 'player A sees exactly their own rack');
  ok(!leaks(sb, B).length && B.every(i => text(sb).includes(i)), 'player B sees exactly their own rack');
  // duplicate answer of a player's own action
  w.giveRack('A', [...'كتابمدر']); const s0 = (await w.call('A', 'snapshot')).snapshot;
  const body = { action: 'submit_move', game_id: w.gameId, client_action_id: uuidFrom(w.rng), base_revision: s0.game.revision, placements: across(s0, 'كتاب') };
  await w.raw('A', body); const dup = await w.raw('A', body); ok(dup.ok && dup.duplicate && !leaks(dup, A.concat(w.server().racks[w.users.A].filter(Boolean).map(t => t.id))).length, 'duplicate answer: only the caller\'s own tiles');
  // the same action id replayed by a spectator is refused
  const spy = await w.raw('S', body); ok(!spy.ok && spy.code === 'NOT_MEMBER' || (spy.ok === false), 'another member cannot replay somebody else\'s action id');
}

group('authorization is enforced on the server');
{
  const w = await room({ max_spectators: 3 }, { start: true });
  await join(w, 'J', 'judge'); await join(w, 'S', 'spectator'); w.giveRack('A', [...'كتابمدر']); await w.call('A', 'snapshot');
  const gp = [['submit_move', { placements: across(w.snap.A, 'كتاب') }], ['pass_turn', {}], ['swap_tiles', { tileIds: ['x'] }], ['request_undo', {}], ['cancel_undo', {}], ['respond_undo', { accept: true }], ['pause_game', {}], ['resume_game', {}], ['resign_game', {}], ['claim_abandon', {}], ['rematch', {}], ['request_tahkim', { reason: 'سبب كاف' }], ['call_judge', {}], ['set_ready', { ready: true }]];
  for (const [a, x] of gp) {
    const s = await w.call('S', a, x), j = await w.call('J', a, x);
    ok(!s.ok && s.code === 'SPECTATOR_READ_ONLY', `spectator cannot ${a} (${s.code})`);
    ok(!j.ok && j.code === 'NOT_A_PLAYER', `judge cannot ${a} (${j.code})`);
  }
  ok(w.server().game.revision === w.snap.A.game.revision, 'nothing changed the game');
  for (const [a, x] of [['judge_open_tahkim', {}], ['judge_dismiss_ping', {}], ['judge_verdict', { verdict: 'valid' }], ['judge_pause', {}], ['judge_resume', {}]]) {
    const p = await w.call('B', a, x), s = await w.call('S', a, x);
    ok(!p.ok && p.code === 'NOT_A_JUDGE', `player cannot ${a} (${p.code})`); ok(!s.ok && s.code === 'SPECTATOR_READ_ONLY', `spectator cannot ${a} (${s.code})`);
  }
  for (const k of ['S', 'J']) for (const a of ['start_game', 'update_settings']) { const r = await w.call(k, a, { settings: { max_spectators: 0 } }); ok(!r.ok && r.code === 'NOT_HOST', `${k} cannot ${a}`); }
  const st = await w.call('X', 'snapshot'); ok(!st.ok && st.code === 'NOT_MEMBER', 'a stranger gets nothing');
  const hb = await w.raw('X', { action: 'heartbeat', game_id: w.gameId }); ok(!hb.ok && hb.code === 'NOT_MEMBER', 'a stranger cannot heartbeat');
  // role and seat cannot be forged through the payload
  const forged = await w.call('S', 'submit_move', { role: 'player', seat: 0, placements: across(w.snap.A, 'كتاب') }); ok(!forged.ok && forged.code === 'SPECTATOR_READ_ONLY', 'a role / seat in the payload is ignored');
  const forged2 = await w.raw('S', { action: 'join_room', code: code(w), nickname: 'z', role: 'player', seat: 0 }); ok(forged2.ok && forged2.rejoined && forged2.role === 'spectator', 'asking for the player role again does not promote a spectator');
  const m = await w.call('S', 'tahkim_message', { text: 'مرحبا' }); ok(!m.ok, 'spectator cannot chat');
}

group('roster lifecycle: leaving');
{
  const w = await room({ max_spectators: 2 });
  await join(w, 'J', 'judge'); await join(w, 'S', 'spectator'); await join(w, 'T', 'spectator');
  const leave = k => w.raw(k, { action: 'leave_room', game_id: w.gameId, client_action_id: uuidFrom(w.rng) });
  const lj = await leave('J'); ok(lj.ok && lj.left && w.server().game.status === 'lobby', 'the judge leaves: the room stays open');
  const ls = await leave('S'); ok(ls.ok && w.server().game.status === 'lobby' && w.server().players.length === 3, 'a spectator leaves: the room stays open');
  const again = await join(w, 'U', 'spectator'); ok(again.ok, 'the freed spectator seat can be taken');
  const j2 = await join(w, 'Y', 'judge'); ok(j2.ok, 'the freed judge slot can be taken');
  const lb = await leave('B'); ok(lb.ok && w.server().players.filter(p => p.role === 'player').length === 1, 'a guest player leaves the lobby');
  ok((await w.call('A', 'snapshot')).snapshot.players.length === 1, 'the host sees one player left');
  const lh = await leave('A'); ok(lh.ok && w.server().game.status === 'abandoned', 'the HOST leaving the lobby closes the room (policy)');
  const late = await join(w, 'X', 'spectator'); ok(!late.ok && late.code === 'ROOM_CLOSED', 'a closed room accepts nobody');
  const wm = await room({ max_spectators: 2 }, { start: true }); await join(wm, 'J', 'judge'); await join(wm, 'S', 'spectator');
  const rj = await wm.raw('J', { action: 'leave_room', game_id: wm.gameId, client_action_id: uuidFrom(wm.rng) }); ok(rj.ok && rj.left && wm.server().game.status === 'active', 'a judge leaving mid-match does not end it');
  const rp = await wm.call('B', 'leave_room'); ok(!rp.ok && rp.code === 'WRONG_STATUS', 'a player cannot just leave a running match (they resign)');
  const free = await wm.raw('S', { action: 'leave_room', game_id: wm.gameId, client_action_id: uuidFrom(wm.rng) }); ok(free.ok && free.left, 'a spectator can leave mid-match');
}

group('the host is the host: not "seat 0"');
{
  const w = await room(); const hostId = w.server().game.host_player_id;
  ok(hostId === w.users.A, 'host_player_id is the creator');
  const st = await w.call('B', 'start_game'); ok(!st.ok && st.code === 'NOT_HOST', 'the guest cannot start');
  const s = await w.call('A', 'start_game'); ok(s.ok, 'the host starts (no judge or spectator needed)');
}

group('capacity cannot be exceeded by racing requests');
{
  const w = await room({ max_spectators: 1 });
  w.store.delay = () => tick(5);
  const [r1, r2, r3] = await Promise.all([join(w, 'S', 'spectator'), join(w, 'T', 'spectator'), join(w, 'U', 'spectator')]); w.store.delay = null;
  ok([r1, r2, r3].filter(r => r.ok).length === 1, 'exactly one of three simultaneous spectators got the last seat: ' + [r1, r2, r3].map(r => r.ok ? 'in' : r.code).join());
  ok(w.server().players.filter(p => p.role === 'spectator').length === 1, 'the store holds one spectator');
  const w2 = await room({ max_spectators: 5 }); w2.store.delay = () => tick(5);
  const [a, b] = await Promise.all([join(w2, 'J', 'judge'), join(w2, 'S', 'judge')]); w2.store.delay = null;
  ok([a, b].filter(r => r.ok).length === 1 && w2.server().players.filter(p => p.role === 'judge').length === 1, 'two simultaneous judges: exactly one');
  const w3 = await room({ max_spectators: 5 }); w3.store.delay = () => tick(5);
  const [c, d] = await Promise.all([join(w3, 'X', 'player'), join(w3, 'Y', 'player')]); w3.store.delay = null;
  ok(w3.server().players.filter(p => p.role === 'player').length === 2, 'the room never holds more than 2 players (' + [c, d].map(r => r.ok ? 'in' : r.code).join() + ')');
  const w4 = await room({ max_spectators: 10 }); w4.store.delay = () => tick(3);
  const many = await Promise.all(['S', 'T', 'U', 'X', 'Y'].map(k => join(w4, k, 'spectator'))); w4.store.delay = null;
  ok(many.every(r => r.ok) && w4.server().players.filter(p => p.role === 'spectator').length === 5, 'five spectators arriving together all get in (joins retry on a lost race)');
}

group('heartbeat is role aware');
{
  const w = await room({ max_spectators: 2 }, { start: true }); await join(w, 'J', 'judge'); await join(w, 'S', 'spectator');
  w.clock.t += 7000;
  const hp = await w.raw('A', { action: 'heartbeat', game_id: w.gameId }), hj = await w.raw('J', { action: 'heartbeat', game_id: w.gameId }), hs = await w.raw('S', { action: 'heartbeat', game_id: w.gameId });
  ok(hp.ok && hp.role === 'player' && typeof hp.opp_idle_ms === 'number' && hp.judge_idle_ms === 7000 && hp.judge_present === true, 'player: opponent idle (a number), judge idle, judge present');
  ok(hj.ok && hj.role === 'judge' && hj.opp_idle_ms === null && hj.judge_idle_ms === null, 'judge: no opponent, no judge idle of their own');
  ok(hs.ok && hs.role === 'spectator' && hs.opp_idle_ms === null, 'spectator: no opponent: never a blocker');
  const s = (await w.call('J', 'snapshot')).snapshot; ok(s.waiting_seat === s.game.current_seat, 'a judge sees whose turn the match waits on');
  const sp = (await w.call('S', 'snapshot')).snapshot; ok(sp.me.seat === null && sp.waiting_seat === sp.game.current_seat, 'a spectator sees it too, without a seat of their own');
}

group('old rooms keep working (no role field anywhere)');
{
  const w = makeWorld({ seed: 9, who: WHO }); await w.room({}); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  for (const p of w.server().players) delete p.role;   // a v5.x row
  delete w.server().game.max_players; delete w.server().game.judge_enabled; delete w.server().game.max_spectators;
  w.giveRack('A', [...'كتابمدر']); const s = (await w.call('A', 'snapshot')).snapshot;
  ok(s.me.role === 'player' && s.game.max_players === 2 && s.game.judge_enabled === false && s.judge === null && s.spectator_count === 0, 'defaults fill in for a row without role / room settings');
  const r = await w.call('A', 'submit_move', { placements: across(s, 'كتاب') }); ok(r.ok, 'play continues');
  await w.call('B', 'snapshot');
  const t = await w.call('B', 'request_tahkim', { reason: 'سبب كاف' }); ok(t.ok && t.snapshot.game.tahkim.resolver === 'consensus', 'room without judge: the old consensus Tahkim opens');
}
done();
