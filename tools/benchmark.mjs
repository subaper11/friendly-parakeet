// Validation benchmark: runs tests/benchmark/*.tsv through the dictionary in every tile mode and reports precision / recall / F1 / false-acceptance /
// false-rejection / uncertain rate, per mode and per category. Usage: node tools/benchmark.mjs [file.tsv ...] [--json out.json] [--misses]
// IMPORTANT: a corpus is only evidence if its labels are independent and reviewed. The bundled seed corpus (tests/benchmark/seed.tsv) was AUTHORED BY THE
// DEVELOPMENT ASSISTANT and has review = PENDING: it is a development tool for finding defects, NOT a release benchmark (see docs/AUTO_WORDS_AND_COMPUTER.md).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { createDictionary } from '../js/dictionary.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null, showMisses = args.includes('--misses');
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json'); if (!files.length) files.push(path.join(root, 'tests/benchmark/seed.tsv'));
const D = createDictionary(fs.readFileSync(path.join(root, 'data/words.bin')), fs.readFileSync(path.join(root, 'data/common-words.bin')));
// How the word is laid in each mode. Expanded / Adaptive: the word as written, with the joining tile ئـ inside a word. Basic has no hamza / ة / ى / ؤ / ئ tiles.
const toTiles = w => w.replace(/ئ(?!$)/g, 'ئـ');
const toBasic = w => (/ء/.test(w) ? null : w.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و'));
const BASIC_SKIP = new Set(['hamza-wrong', 'orthography', 'impossible-shape']);   // errors that only exist where the tiles exist
const rows = [];
for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) { if (!line.trim()) continue; const [word, expected, reason, category, scope] = line.split('\t'); rows.push({ word, expected, reason, category, scope }); }
const report = {};
for (const mode of ['basic', 'expanded', 'adaptive']) {
  const m = { tp: 0, fp: 0, tn: 0, fn: 0, unc: 0, n: 0, cat: {}, misses: [] };
  for (const r of rows) {
    if (mode === 'basic' && BASIC_SKIP.has(r.category)) continue;
    if (r.scope === 'expanded' && mode === 'basic') continue;
    const typed = mode === 'basic' ? toBasic(r.word) : toTiles(r.word); if (typed == null) continue;
    const got = D.check(typed, { mode }), accepted = got.status !== 'invalid', wantValid = r.expected === 'valid';
    m.n++; const c = (m.cat[r.category] ||= { n: 0, ok: 0 }); c.n++;
    if (got.status === 'uncertain') m.unc++;
    if (wantValid && accepted) m.tp++; else if (wantValid && !accepted) { m.fn++; m.misses.push([r.category, r.word, 'rejected: ' + got.why]); }
    else if (!wantValid && accepted) { m.fp++; m.misses.push([r.category, r.word, 'ACCEPTED (' + got.status + ')']); } else m.tn++;
    if (wantValid === accepted) c.ok++;
  }
  const P = m.tp / ((m.tp + m.fp) || 1), R = m.tp / ((m.tp + m.fn) || 1);
  report[mode] = { n: m.n, precision: P, recall: R, f1: 2 * P * R / ((P + R) || 1), falseAcceptRate: m.fp / ((m.fp + m.tn) || 1), falseRejectRate: m.fn / ((m.fn + m.tp) || 1), uncertainRate: m.unc / m.n, categories: Object.fromEntries(Object.entries(m.cat).map(([k, v]) => [k, +(v.ok / v.n).toFixed(3)])), misses: m.misses };
}
const pct = x => (x * 100).toFixed(1).padStart(5) + '%';
console.log(`corpus: ${rows.length} entries from ${files.map(f => path.basename(f)).join(', ')}`);
console.log('mode      n    precision recall  F1     false-accept false-reject uncertain');
for (const [mode, r] of Object.entries(report)) console.log(`${mode.padEnd(9)} ${String(r.n).padStart(4)}  ${pct(r.precision)}   ${pct(r.recall)} ${pct(r.f1)}  ${pct(r.falseAcceptRate)}      ${pct(r.falseRejectRate)}      ${pct(r.uncertainRate)}`);
console.log('\nper category (share classified as labelled), expanded:'); for (const [k, v] of Object.entries(report.expanded.categories)) console.log('  ' + k.padEnd(22) + pct(v));
if (showMisses) for (const [mode, r] of Object.entries(report)) { console.log(`\n--- ${mode}: ${r.misses.length} misclassified`); for (const x of r.misses) console.log('  ' + x.join('  ')); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
