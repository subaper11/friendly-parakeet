// Play against the computer (local play). Player 2 is the computer. This module owns everything about it: choosing the level, loading the word list,
// judging words automatically (there is no Tahkim against the computer), and playing the computer's turns with the game's own operations
// (place / submit / swap / pass), so every rule, score, clock and history entry is exactly what a human move would produce.
//
// Hooks into the rest of the game (all optional, set in initBot): app.afterTurn (called after a turn passes), app.checkWords (word judge for human
// moves), app.applyBotChoice (at the start of a new game), app.botResume (a saved match), app.pendingBot (the level chosen on the cover).
// No challenges against the computer: its words come from the strict dictionary reading and the human's from the lenient one.
import { S, app, cur } from './state.js';
import { place, submit, pass, startSwap, doSwap, cancelMove } from './game.js';
import { render, notice } from './ui.js';
import { setBotName } from './names.js';
import { tileLetter, tileValue } from './modes.js';
import { RACK } from './config.js';
import { createDictionary, explainRejected } from './dictionary.js';
import { solve, chooseSwap, LEVELS } from './bot-search.js';

const BOT = 1, BOT_NAME = 'الحاسوب';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isLevel = l => Object.hasOwn(LEVELS, l);

// ---------- the word list (shared with the worker through the HTTP / service-worker cache) ----------
let dict = null, dictLoading = null;
const asset = name => fetch(new URL(`../data/${name}`, import.meta.url)).then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.arrayBuffer(); });
export function loadDictionary() {
  if (dict) return Promise.resolve(dict);
  // words.bin is the folded list; common-words.bin is the exact filter that turns a common word from 'uncertain' into 'verified'.
  // It is optional at the API level: if the second file cannot be fetched the old one-file judge still works.
  return (dictLoading ||= Promise.all([asset('words.bin'), asset('common-words.bin').catch(() => null)])
    .then(([b, c]) => (dict = createDictionary(new Uint8Array(b), c ? new Uint8Array(c) : undefined))).catch(e => { dictLoading = null; throw e; }));
}

// ---------- the worker (falls back to the main thread under a small budget) ----------
let worker = null, workerFailed = false, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker || workerFailed || typeof Worker !== 'function') return worker;
  try {
    worker = new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); } };
    worker.onerror = () => { workerFailed = true; worker = null; for (const p of pending.values()) p.reject(new Error('worker')); pending.clear(); };
  } catch { workerFailed = true; worker = null; }
  return worker;
}
async function think(job) {
  const w = getWorker();
  if (w) {
    try { return await new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage({ id, ...job }); }); }
    catch { /* the worker could not run: use the main thread below */ }
  }
  const d = await loadDictionary();
  await sleep(0);
  return solve({ ...job, budget: Math.min(job.budget, 450) }, d);
}

// ---------- word judging for the human's moves in a game against the computer ----------
const checkWords = words => {
  if (!dict) return 'القاموس قيد التحميل… حاول بعد لحظة.';
  const res = dict.judgeAll(words.map(w => w.map(x => tileLetter(x.t)).join('')), { mode: app.mode });
  const bad = res.filter(x => !x.ok);
  return bad.length ? explainRejected(bad) : null;
};

// ---------- on / off ----------
export function enableBot(level) { app.bot = { level: isLevel(level) ? level : 'medium', acting: false }; setBotName(BOT_NAME); gen++; }
export function disableBot() { app.bot = null; setBotName(null); gen++; }
let gen = 0, busy = false;

// ---------- the computer's turn ----------
const dialogOpen = () => [...document.querySelectorAll('dialog')].some(d => d.open);
const stale = g => g !== gen || !app.bot || S.ended || S.cur !== BOT;
async function waitFree(g) {
  while (!stale(g) && (S.hold || S.paused || dialogOpen() || S.pending || document.getElementById('fdOv'))) await sleep(200);
  return !stale(g);
}
export function kick() {
  if (!app.bot || S.ended || S.cur !== BOT || busy) return;
  busy = true; const g = gen;
  run(g).catch(() => { if (!stale(g)) { try { cancelMove(); } catch { /* ignore */ } fallback(); } })
    .finally(() => { busy = false; if (g === gen && app.bot && !S.ended && S.cur === BOT) setTimeout(kick, 400); });   // still the computer's turn (e.g. the word list was not ready): try again
}
async function run(g) {
  await sleep(0);
  if (!(await waitFree(g))) return;
  if (!dict) { try { await loadDictionary(); } catch { notice('تعذّر تحميل القاموس. تحقق من الاتصال.'); await sleep(3000); return; } }
  const lv = LEVELS[app.bot.level], t0 = performance.now();
  const grid = S.board.map(row => row.map(t => (t ? { l: tileLetter(t), v: tileValue(t) } : null)));
  const rack = cur().rack.filter(Boolean).map(t => ({ id: t.id, l: t.l, v: t.v, blank: !!t.blank, flex: !!t.flex }));
  const slow = (navigator.hardwareConcurrency || 4) <= 4 ? 0.65 : 1;   // modest devices get a shorter search
  const found = await think({ grid, rack, mode: app.mode, level: app.bot.level, budget: Math.round(lv.ms * slow) });
  await sleep(Math.max(0, lv.think - (performance.now() - t0)));   // a computer that answers instantly feels like a glitch
  if (!(await waitFree(g))) return;
  app.bot.acting = true;
  try {
    for (const cand of found.candidates) { if (stale(g)) return; if (await playMove(g, cand)) return; }
    if (!stale(g)) await noMove(g);
  } finally { if (app.bot) app.bot.acting = false; }
}
async function playMove(g, m) {
  const before = S.hist.length, step = still() ? 90 : 330;
  const rack = cur().rack;
  for (const c of m.cells.slice().sort((a, b) => a.r - b.r || a.c - b.c)) {
    if (stale(g)) { cancelMove(); return false; }
    const t = rack.find(x => x && x.id === c.id) || cur().rack.find(x => x && x.id === c.id);
    if (!t) { cancelMove(); return false; }
    if (t.blank) t.as = c.as;
    if (!place(t, c.r, c.c)) { cancelMove(); render(); return false; }
    await sleep(step);
    if (!(await waitFree(g))) { cancelMove(); return false; }
  }
  submit();
  if (S.hist.length > before) return true;   // the game accepted it
  cancelMove(); render(); return false;       // the game refused it (should not happen): try the next candidate
}
async function noMove(g) {
  // No playable move: swap when the bag allows it, otherwise pass (exactly what a human does).
  const ids = chooseSwap(cur().rack);
  if (ids.length) {
    startSwap();
    if (S.swap) { cur().rack.forEach(t => { if (t && ids.includes(t.id)) S.sel.add(t); }); const before = S.hist.length; doSwap(); if (S.hist.length > before) return; S.swap = false; S.sel.clear(); render(); }
  }
  if (!stale(g)) pass();
}
function fallback() { app.bot.acting = true; try { if (S.move.length) cancelMove(); pass(); } finally { if (app.bot) app.bot.acting = false; } }

// ---------- choosing the level ----------
let dlg = null;
function buildDialog() {
  dlg = document.createElement('dialog'); dlg.id = 'blv'; dlg.setAttribute('aria-labelledby', 'blT');
  dlg.innerHTML = `<h2 id="blT" tabindex="-1">اللعب ضد الحاسوب</h2><p>اختر مستوى الحاسوب. يحكم القاموس على كل كلمة تلقائيًا، فلا يوجد تحكيم في هذه المباراة.</p>
<div id="blf" class="blf">${Object.entries(LEVELS).map(([id, l]) => `<button type="button" class="btn modeBtn" data-l="${id}"><span class="mAr">${l.label}</span><span class="mEn">${l.en}</span></button>`).join('')}</div>
<p id="blm" class="blm" role="status" aria-live="polite"></p><form method="dialog" class="dlgRow"><button class="btn" id="blX" value="">إلغاء</button></form>`;
  document.body.append(dlg);
  dlg.addEventListener('cancel', e => { if (app.firstRun) e.preventDefault(); });
  return dlg;
}
// Resolves with a level id once the word list is loaded, or null when cancelled.
export function chooseBotLevel() {
  const d = dlg || buildDialog(), msg = d.querySelector('#blm'), btns = [...d.querySelectorAll('#blf .btn')];
  d.querySelector('#blX').hidden = !!app.firstRun;   // the very first prompt cannot be skipped, like the mode prompt
  msg.textContent = ''; btns.forEach(b => { b.disabled = false; });
  return new Promise(resolve => {
    const done = v => { d.removeEventListener('close', onClose); d.querySelector('#blf').onclick = null; resolve(v); };
    const onClose = () => done(null);
    d.addEventListener('close', onClose);
    d.querySelector('#blf').onclick = async e => {
      const b = e.target.closest('[data-l]'); if (!b || b.disabled) return;
      btns.forEach(x => { x.disabled = true; }); msg.textContent = 'جارٍ تحميل القاموس…';
      try { await loadDictionary(); d.removeEventListener('close', onClose); d.close(); done(b.dataset.l); }
      catch { msg.textContent = 'تعذّر تحميل القاموس. تحقق من الاتصال ثم أعد المحاولة.'; btns.forEach(x => { x.disabled = false; }); }
    };
    d.showModal(); d.querySelector('#blT').focus();
  });
}

// Cover button: choose the level, then the usual mode -> duration -> start flow (js/input.js) applies it when the game really starts.
export async function startBotFlow(chooseMode) {
  const level = await chooseBotLevel();
  if (!level) { if (app.firstRun) return startBotFlow(chooseMode); return; }
  app.pendingBot = level; chooseMode();
}

export function initBot() {
  app.afterTurn = kick;
  app.checkWords = checkWords;
  app.applyBotChoice = () => {   // called right after newGame(): the opponent type of the NEW game
    if (app.pendingBot) { enableBot(app.pendingBot); app.pendingBot = null; }
    else if (app.bot) { app.bot.acting = false; gen++; }   // a new game keeps the same opponent (reload the page to go back to two players)
    render();
  };
  app.botResume = level => { if (isLevel(level)) { enableBot(level); loadDictionary().then(() => kick()).catch(() => {}); } else disableBot(); };
}
export { LEVELS };
