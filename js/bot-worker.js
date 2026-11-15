// Web Worker for the computer opponent: loads the word list once, then answers search requests so the page never freezes while the computer thinks.
//   in : { id, grid, rack, mode, level, budget }      out : { id, candidates, count, timedOut, ms } | { id, error }
import { createDictionary } from './dictionary.js';
import { solve } from './bot-search.js';

let dict = null, loading = null;
const asset = name => fetch(new URL(`../data/${name}`, import.meta.url)).then(r => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.arrayBuffer(); });
const load = () => (loading ||= Promise.all([asset('words.bin'), asset('common-words.bin').catch(() => null)])
  .then(([b, c]) => (dict = createDictionary(new Uint8Array(b), c ? new Uint8Array(c) : undefined))).catch(e => { loading = null; throw e; }));

onmessage = async e => {
  const m = e.data;
  try { await load(); postMessage({ id: m.id, ...solve(m, dict) }); }
  catch (err) { postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
