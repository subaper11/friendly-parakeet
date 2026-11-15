// The computer opponent's brain: finds legal, dictionary-valid moves for a rack on a board. Pure (no DOM, no state), so it runs in a Web Worker
// (js/bot-worker.js) and, where workers are missing, on the main thread under a small time budget (js/bot.js).
//
// It knows the game's own pieces rather than copying another game's: the tile registry of the three modes (blank = any letter of the mode,
// adaptive alif = the alif forms at full value), the premium squares of config.js LAYOUT, the 50-point bingo for seven tiles, and the
// dictionary's STRICT reading (isReal): the computer must never play a stray list entry, whatever the lenient judge would let a human do.
// The score computed here only RANKS moves. The move that is finally played goes through the game's own analyze()/scoreWords(), so the two can never disagree.
//
// Search: every line (row and column), every span of cells that forms one maximal word and holds 1..7 new tiles, filled by depth-first
// search over the rack (identical tiles tried once per square) with each cross-word checked as soon as a tile lands. Blanks and the
// adaptive alif's other forms are tried in a second pass only, so the common case stays fast. A deadline stops the search wherever it is.
import { SIZE, RACK, BINGO, CENTER, LAYOUT } from './config.js';
import { TILE_MODES, ALIF_FORMS } from './modes.js';

export const LEVELS = {
  easy:   { label: 'سهل',   en: 'Mudah',  ms: 500,  think: 900 },
  medium: { label: 'متوسط', en: 'Sedang', ms: 1500, think: 1200 },
  hard:   { label: 'صعب',   en: 'Sulit',  ms: 3500, think: 1500 }
};
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const VOWELS = new Set(['ا', 'و', 'ي']);

// inp: { grid: 15x15 of null | {l, v}, rack: [{id, l, v, blank, flex}], mode, level, budget (ms), valid(str) -> bool }
// Returns { moves: [{score, equity, nNew, dir, word, cells: [{r, c, id, as}]}], timedOut, nodes }
export function searchMoves(inp) {
  const { grid, rack, mode, valid: validRaw } = inp, alpha = [...TILE_MODES[mode].alpha];
  const deadline = now() + inp.budget;
  let timedOut = false, nodes = 0;
  const vmemo = new Map();
  const valid = s => { let v = vmemo.get(s); if (v === undefined) { v = !!validRaw(s); vmemo.set(s, v); } return v; };
  const tileAt = (r, c) => (r >= 0 && c >= 0 && r < SIZE && c < SIZE ? grid[r][c] : null);
  const empty = grid.every(row => row.every(x => !x));
  const rackTiles = rack.filter(Boolean);
  const moves = [];
  const seenSingle = new Set();

  // ---- the options one rack tile offers on a square ----
  const optsOf = (t, pass) => {
    if (t.flex) return pass === 2 ? ALIF_FORMS.map(f => ({ ch: f, val: t.v, as: f })) : [{ ch: 'ا', val: t.v, as: 'ا' }];
    if (t.blank) return pass === 2 ? alpha.map(ch => ({ ch, val: 0, as: ch })) : [];
    return [{ ch: t.l, val: t.v, as: null }];
  };

  // ---- cross-words: the word a new tile forms across the line of play (null = none, false = invalid) ----
  const cross = new Map();
  const crossOf = (r, c, horiz, ch, val) => {
    const key = r * 1000 + c * 10 + (horiz ? 1 : 0) + ch;   // a string key: the letter may be two code points
    let hit = cross.get(key); if (hit !== undefined) return hit;
    const dr = horiz ? 1 : 0, dc = horiz ? 0 : 1;   // the cross direction
    let pre = '', preSum = 0, post = '', postSum = 0, rr = r - dr, cc = c - dc;
    while (tileAt(rr, cc)) { const t = grid[rr][cc]; pre = t.l + pre; preSum += t.v; rr -= dr; cc -= dc; }
    rr = r + dr; cc = c + dc;
    while (tileAt(rr, cc)) { const t = grid[rr][cc]; post += t.l; postSum += t.v; rr += dr; cc += dc; }
    if (!pre && !post) hit = null;
    else if (!valid(pre + ch + post)) hit = false;
    else {
      const k = LAYOUT[r][c]; let v = val, mul = 1;
      if (k === 1) v *= 2; else if (k === 2) v *= 3; else if (k === 3 || k === 5) mul = 2; else if (k === 4) mul = 3;
      hit = (preSum + postSum + v) * mul;
    }
    cross.set(key, hit); return hit;
  };
  const hasPerp = (r, c, horiz) => (horiz ? !!(tileAt(r - 1, c) || tileAt(r + 1, c)) : !!(tileAt(r, c - 1) || tileAt(r, c + 1)));

  // ---- leave quality (hard level): keep blanks and balance, avoid duplicates ----
  const leaveValue = left => {
    let v = 0, vow = 0; const seen = new Map();
    for (const t of left) {
      if (t.blank && !t.flex) v += 8; else if (t.flex) { v += 2; vow++; }
      else { if (VOWELS.has(t.l)) vow++; seen.set(t.l, (seen.get(t.l) || 0) + 1); v -= t.v >= 6 ? 2 : 0; }
    }
    for (const n of seen.values()) if (n > 1) v -= 3 * (n - 1);
    if (left.length >= 3) v -= Math.abs(vow - left.length * 0.35) * 1.6;
    return v;
  };

  function pass(passNo) {
    for (const horiz of [true, false]) {
      for (let line = 0; line < SIZE && !timedOut; line++) {
        const R = pos => (horiz ? line : pos), C = pos => (horiz ? pos : line);
        const filled = Array.from({ length: SIZE }, (_, p) => !!grid[R(p)][C(p)]);
        for (let ws = 0; ws < SIZE && !timedOut; ws++) {
          if (ws > 0 && filled[ws - 1]) continue;   // a word starts where the cell before it is empty (or the edge)
          let k = 0, fixed = false, anchored = false;
          for (let we = ws; we < SIZE; we++) {
            if (filled[we]) fixed = true;
            else {
              if (++k > rackTiles.length) break;
              if (empty ? (R(we) === CENTER && C(we) === CENTER) : hasPerp(R(we), C(we), horiz)) anchored = true;
            }
            if (we < SIZE - 1 && filled[we + 1]) continue;   // the word must end where the next cell is empty
            if (we === ws || k === 0 || !(fixed || anchored)) continue;
            fill(horiz, line, ws, we, k, passNo);
            if (timedOut) return;
          }
        }
      }
    }
  }

  function fill(horiz, line, ws, we, kNew, passNo) {
    const len = we - ws + 1, R = p => (horiz ? line : p), C = p => (horiz ? p : line);
    const buf = new Array(len), cells = [], used = new Array(rackTiles.length).fill(false);
    const filled = {}; for (let p = ws; p <= we; p++) filled[p] = !!grid[R(p)][C(p)];
    for (let p = ws; p <= we; p++) { const t = grid[R(p)][C(p)]; if (t) buf[p - ws] = t.l; }
    const optsCache = rackTiles.map(t => optsOf(t, passNo));
    // pass 2 reaches blanks / the other alif forms: a move must use at least one of them, otherwise pass 1 already found it
    const sig = t => (t.blank || t.flex ? 'F' + t.id : t.l + ':' + t.v);
    const dfs = (p, mainSum, mainMul, crossSum, placed, usedSpecial) => {
      if ((++nodes & 255) === 0 && now() > deadline) { timedOut = true; return; }
      while (p <= we && filled[p]) { const t = grid[R(p)][C(p)]; let v = t.v; mainSum += v; p++; }
      if (p > we) {
        if (passNo === 2 && !usedSpecial) return;
        if (placed === 0) return;
        const word = buf.join('');
        if (!valid(word)) return;
        const nNew = placed;
        if (nNew === 1) { const key = cells[0].r + ',' + cells[0].c + ',' + cells[0].id + ',' + cells[0].as; if (seenSingle.has(key)) return; seenSingle.add(key); }
        const score = mainSum * mainMul + crossSum + (nNew === RACK ? BINGO : 0);
        const left = rackTiles.filter((_, i) => !used[i]);
        moves.push({ score, equity: score + leaveValue(left), nNew, dir: horiz ? 'H' : 'V', word, cells: cells.map(x => ({ ...x })) });
        return;
      }
      const r = R(p), c = C(p), k = LAYOUT[r][c], tried = new Set();
      for (let i = 0; i < rackTiles.length; i++) {
        if (used[i]) continue;
        const t = rackTiles[i], sg = sig(t);
        if (tried.has(sg)) continue; tried.add(sg);
        for (const o of optsCache[i]) {
          const cr = crossOf(r, c, horiz, o.ch, o.val);
          if (cr === false) continue;
          let v = o.val, mul = mainMul;
          if (k === 1) v *= 2; else if (k === 2) v *= 3; else if (k === 3 || k === 5) mul *= 2; else if (k === 4) mul *= 3;
          used[i] = true; buf[p - ws] = o.ch; cells.push({ r, c, id: t.id, as: o.as });
          dfs(p + 1, mainSum + v, mul, crossSum + (cr || 0), placed + 1, usedSpecial || (t.blank && !t.flex) || (t.flex && o.as !== 'ا'));
          cells.pop(); used[i] = false; buf[p - ws] = undefined;
          if (timedOut) return;
        }
      }
    };
    dfs(ws, 0, 1, 0, 0, false);
  }

  pass(1);
  if (!timedOut && rackTiles.some(t => t.blank)) pass(2);
  return { moves, timedOut, nodes };
}

// Turns the found moves into an ordered list of candidates to TRY (the game verifies each one, so a refused move just falls to the next).
//   hard   best equity (score + quality of the leave)          medium  a random choice among the good moves (>= 60% of the best)
//   easy   a modest move: from the lower half, short words first
export function pickCandidates(moves, level, rng = Math.random, n = 8) {
  if (!moves.length) return [];
  const bySc = moves.slice().sort((a, b) => b.score - a.score), best = bySc[0].score;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let list;
  if (level === 'hard') list = moves.slice().sort((a, b) => b.equity - a.equity);
  else if (level === 'medium') {
    const pool = bySc.filter(m => m.score >= best * 0.6); list = shuffle(pool.length >= 3 ? pool : bySc.slice(0, Math.min(8, bySc.length)));
    list = list.concat(bySc);
  } else {
    const lower = bySc.slice(Math.floor(bySc.length * 0.4), Math.max(Math.floor(bySc.length * 0.4) + 1, Math.floor(bySc.length * 0.85)));
    list = shuffle(lower.length ? lower.slice() : bySc.slice()).sort((a, b) => a.cells.length - b.cells.length + (rng() - 0.5) * 2).concat(bySc.slice().reverse());
  }
  const seen = new Set(), out = [];
  for (const m of list) { const key = m.dir + m.cells.map(c => c.r + ',' + c.c + c.id).join(';'); if (!seen.has(key)) { seen.add(key); out.push(m); if (out.length >= n) break; } }
  return out;
}

// Which rack tiles to throw back when there is no move: keep the useful letters, blanks and the adaptive alif; Returns tile ids.
export function chooseSwap(rack) {
  const KEEP = new Set(['ا', 'ل', 'م', 'ن', 'ي', 'و', 'ت', 'ر', 'ب', 'ه']);
  const tiles = rack.filter(Boolean), seen = new Set();
  const out = tiles.filter(t => {
    if (t.blank || t.flex) return false;
    if (!KEEP.has(t.l)) return true;
    if (seen.has(t.l)) return true;   // a duplicate
    seen.add(t.l); return false;
  }).map(t => t.id);
  return out.length ? out : tiles.filter(t => !t.blank && !t.flex).slice(0, 3).map(t => t.id);
}

// The whole job in one call (worker and main-thread fallback both use it): board + rack in, ordered candidates out.
export function solve({ grid, rack, mode, level, budget }, dict, rng = Math.random) {
  const t0 = now();
  const found = searchMoves({ grid, rack, mode, level, budget, valid: s => dict.isReal(s, { mode }) });
  return { candidates: pickCandidates(found.moves, level, rng), count: found.moves.length, timedOut: found.timedOut, ms: Math.round(now() - t0) };
}
