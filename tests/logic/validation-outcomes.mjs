// Validation outcomes and guarantees: valid / uncertain / invalid, idhafah (forbidden vs permitted), strict computer reading, Bloom-filter bound,
// browser == Edge parity, and the seed benchmark as a regression floor. Pure Node. Run: node tests/logic/validation-outcomes.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { createDictionary } from '../../js/dictionary.js';
import { createDictionary as edgeDictionary } from '../../supabase/functions/_shared/game/dictionary.js';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = fs.readFileSync(path.join(root, 'data/words.bin')), common = fs.readFileSync(path.join(root, 'data/common-words.bin'));
const D = createDictionary(bin, common), E = edgeDictionary(fs.readFileSync(path.join(root, 'supabase/functions/eas-game/words.bin')), fs.readFileSync(path.join(root, 'supabase/functions/eas-game/common-words.bin')));
const st = (w, mode = 'expanded') => D.check(w, { mode }).status;
const tiles = w => w.replace(/ئ(?!$)/g, 'ئـ');

group('three outcomes');
ok(st('كتاب') === 'valid' && st('أكل') === 'valid' && st('الكتاب') === 'valid', 'confirmed words are valid');
ok(st('يقرأون') === 'uncertain' && st('تقرأون') === 'uncertain', 'a derived form that neither the list nor the common filter carries is uncertain (accepted)');
ok(st('اكل') === 'invalid' && st('ضصثق') === 'invalid' && st('كتابي') === 'invalid', 'wrong hamza / junk / idhafa are invalid');
for (const w of ['كتاب', 'اقرأ', 'اكل', 'ضصثق']) { const r = D.check(w); ok(r.ok === (r.status !== 'invalid'), `ok matches status for ${w}`); }
ok(D.judgeAll(['كتاب', 'اقرأ']).every(r => r.ok) && D.judgeAll(['كتاب', 'ضصثق']).some(r => !r.ok), 'a move is judged word by word: one invalid word is visible');

group('Bloom filter: the false-positive bound is accounted for');
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), m = dv.getUint32(4, true), k = bin[8], n = dv.getUint32(12, true);
const fpr = (1 - Math.exp(-k * n / m)) ** k;
ok(fpr < 1e-8, `theoretical false-positive rate ${fpr.toExponential(2)} (m=${m} bits, k=${k}, n=${n} keys) is below 1e-8`);
ok(n === D.count, 'the key count in the header is what the loader reports');

group('the exact common filter confirms words the folded list can only guess');
for (const w of ['متأخر', 'متأخرة', 'مفاجأة', 'مفاجآت', 'إلقاء', 'إلغاء', 'رؤى', 'أمير', 'مكافأة', 'منشأة', 'إضاءة', 'إعطاء', 'أريكة', 'إنترنت', 'شوكولاتة', 'بيتزا', 'شاورما', 'موبايل']) {
  const r = D.check(w);
  ok(r.ok && r.status === 'valid' && r.verified, w + ' is verified by the common filter');
}
{
  const cdv = new DataView(common.buffer, common.byteOffset, common.byteLength), cm = cdv.getUint32(4, true), ck = common[8], cn2 = cdv.getUint32(12, true);
  const cfpr = (1 - Math.exp(-ck * cn2 / cm)) ** ck;
  ok(cfpr < 1e-8 && cn2 > 20000, `common-words.bin: ${cn2} keys, theoretical false-positive ${cfpr.toExponential(2)}`);
}

group('curated wrong-seat spellings are refused (and named)');
for (const [w, right] of [['مسايل', 'مسائل'], ['مسئـل', 'مسؤول'], ['إبن', 'ابن'], ['إثنين', 'اثنين'], ['إستراتيجية', 'استراتيجية']]) {
  const r = D.check(w);
  ok(!r.ok && r.why === 'spelling' && r.hint === right, `${w} -> ${right} (${r.ok ? 'accepted' : r.why + ' ' + r.hint})`);
}
for (const w of ['مسئولية', 'شئون', 'أسئل']) ok(!D.check(w).ok, w + ' is refused (shape or spelling)');

group('idhafah: forbidden constructions are refused, ordinary words that end like a pronoun are kept');
for (const w of ['كتابي', 'كتابك', 'كتابها', 'كتابهم', 'بيتي', 'بيتهم', 'بيتنا', 'قلمك', 'قلمه', 'مدرستي', 'مدرستها', 'أخي', 'أبي', 'أمي', 'لي', 'لك', 'له', 'لها', 'به', 'بها', 'منه', 'منهم', 'فيه', 'فيها', 'عليه', 'عليها', 'إليه', 'إليك', 'عنه', 'معه', 'لديه']) ok(st(w) === 'invalid', w + ' refused');
for (const w of ['مالك', 'عربي', 'يومي', 'ديني', 'وطني', 'كرسي', 'قاضي', 'ثاني', 'ماضي', 'هناك', 'ملوك', 'ذهبنا', 'كتبنا', 'ذلك', 'لكن', 'هناك']) ok(st(w) !== 'invalid', w + ' kept');
ok(st('كتابه', 'basic') !== 'invalid' && st('بيته', 'basic') === 'invalid' && st('منه', 'basic') === 'invalid', 'Basic: a final ه may be the ة of a real word (كتابة) but never a pronoun on a noun that has no such word, nor a preposition + pronoun');

group('Basic keeps its relaxed spelling; Expanded / Adaptive do not inherit it');
for (const w of ['مدرسه', 'مسايل', 'مسوولية', 'شاطي', 'لولو', 'اكل', 'ياكل', 'ارض']) ok(st(w, 'basic') !== 'invalid', w + ' (basic) accepted');
// (known gap, not asserted: the list itself carries مسايل, the ي spelling of مسائل, so a ي written for a medial ئ is not caught)
for (const w of ['مدرسه', 'مسوولية', 'شاطي', 'لولو', 'اكل', 'ياكل', 'ارض', 'مستشفي', 'مسؤل']) ok(st(w, 'expanded') === 'invalid' && st(w, 'adaptive') === 'invalid', w + ' refused in Expanded and Adaptive');

group('the computer reads strictly: nothing uncertain, nothing misspelled, nothing forbidden');
const rows = fs.readFileSync(path.join(root, 'tests/benchmark/seed.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
let bad = [];
for (const [w, exp] of rows) { const t = tiles(w); if (D.isReal(t, { mode: 'expanded' }) && (D.check(t, { mode: 'expanded' }).status !== 'valid' || exp !== 'valid')) bad.push(w); }
ok(!bad.length, 'the computer would play no uncertain or invalid word of the corpus: ' + bad.slice(0, 5).join(' '));
for (const w of ['اكل', 'يقرأون', 'كتابي', 'ضصثق', 'مسؤل']) ok(!D.isReal(w), w + ' is never played by the computer');

group('browser and Edge Function implementations agree');
const same = rows.every(([w]) => ['basic', 'expanded', 'adaptive'].every(mode => JSON.stringify(D.check(tiles(w), { mode })) === JSON.stringify(E.check(tiles(w), { mode }))));
ok(same, 'identical verdicts for every corpus word in every mode');
const body = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^\/\/ GENERATED[^\n]*\n/, '');
ok(body('js/dictionary.js') === body('supabase/functions/_shared/game/dictionary.js') && body('js/hamza.js') === body('supabase/functions/_shared/game/hamza.js'), 'the two copies are identical apart from the GENERATED header');

group('regression floor on the development seed corpus (NOT a release benchmark: labels are unreviewed)');
{
  const modes = { expanded: [0, 0, 0, 0], basic: [0, 0, 0, 0] };   // tp fp tn fn
  for (const mode of Object.keys(modes)) for (const [w, exp, , cat] of rows) {
    if (mode === 'basic') { if (['hamza-wrong', 'orthography', 'impossible-shape'].includes(cat) || /ء/.test(w)) continue; }
    const typed = mode === 'basic' ? w.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و') : tiles(w);
    const acc = D.check(typed, { mode }).status !== 'invalid', v = exp === 'valid', a = modes[mode];
    if (v && acc) a[0]++; else if (!v && acc) a[1]++; else if (!v) a[2]++; else a[3]++;
  }
  for (const [mode, [tp, fp, , fn]] of Object.entries(modes)) { const P = tp / (tp + fp), R = tp / (tp + fn); ok(P >= 0.99 && R >= 0.98, `${mode}: precision ${(P * 100).toFixed(1)}% recall ${(R * 100).toFixed(1)}% stay at or above 99% / 98%`); }
}
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
