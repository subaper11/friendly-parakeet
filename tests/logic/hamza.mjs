// Hamza and alif judging (js/dictionary.js + js/hamza.js): exact spelling in Expanded / Adaptive, any alif form in Basic, shape rules, and the computer's strict reading.
// Pure Node (no DOM). Run: node tests/logic/hamza.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { createDictionary, explainRejected } from '../../js/dictionary.js';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = createDictionary(fs.readFileSync(path.join(root, 'data', 'words.bin')), fs.readFileSync(path.join(root, 'data', 'common-words.bin')));
const accepts = (w, mode = 'expanded') => D.check(w, { mode }).ok;
const verdict = (w, mode = 'expanded') => D.check(w, { mode });

group('the exact spelling is verified (Expanded)');
for (const w of ['أكل', 'آكل', 'يأكل', 'مأكول', 'تأكيد', 'أرض', 'الأرض', 'أهل', 'أول', 'إلى', 'إلا', 'إذا', 'أن', 'إن', 'أب', 'أم', 'أخ', 'آن', 'آه', 'آمن', 'آمنوا', 'آخر', 'آية', 'أسئـلة', 'أكبر', 'أحسن', 'إرسال', 'إكرام', 'أخبار', 'إخبار', 'أدوية', 'أصابع', 'أحاديث', 'أصدقاء', 'إنسان', 'إسلام', 'أبيض', 'سأل', 'رأس', 'لأن', 'قرآن', 'مرآة', 'الآن'])
  ok(verdict(w).ok && verdict(w).verified, w + ' is accepted and verified');
group('the same word with the wrong alif / hamza is refused, and told the right one');
for (const [w, right] of [['اكل', 'أكل'], ['ياكل', 'يأكل'], ['ماكول', 'مأكول'], ['تاكيد', 'تأكيد'], ['ارض', 'أرض'], ['اهل', 'أهل'], ['اول', 'أول'], ['ان', 'أن'], ['اب', 'أب'], ['ام', 'أم'], ['اخ', 'أخ'], ['اذا', 'إذا'], ['إكل', 'أكل'], ['إكرم', 'أكرم'], ['أسلام', 'إسلام'], ['أنسان', 'إنسان'], ['إنف', 'أنف'], ['اسلام', 'إسلام'], ['انسان', 'إنسان'], ['اطفال', 'أطفال'], ['اكرام', 'إكرام']]) {
  const r = verdict(w); ok(!r.ok && r.why === 'spelling' && r.hint === right, `${w} -> ${right} (${r.ok ? 'accepted' : r.why + ' ' + r.hint})`);
}
ok(/الصواب «أكل»/.test(explainRejected([{ word: 'اكل', why: 'spelling', hint: 'أكل' }])), 'the message names the right spelling');
group('words that are right with a plain alif stay right (wasl alif, and plain words the list knows)');
for (const w of ['استخدم', 'انطلق', 'اتصال', 'اتفاق', 'اسم', 'ابن', 'اكتب', 'كتاب', 'مدرسة', 'سال', 'بدا']) ok(accepts(w), w + ' is accepted');
group('shape: where an alif-family letter may stand');
for (const w of ['ءاكل', 'ؤكل', 'أاكل', 'أأكل', 'سمآ', 'اإكل', 'بإب', 'ئـكل', 'مدرةس', 'كتىب']) { const r = verdict(w); ok(!r.ok && r.why === 'shape', `${w} has an impossible shape (${r.why})`); }
group('junk with a hamza is no longer waved through');
for (const w of ['أضظ', 'أصثغ', 'إضظاب', 'أققق', 'أزصط', 'أضظظظظ']) ok(!accepts(w), w + ' is refused');
group('Basic mode has no hamza tiles: any alif form of a verified word is fine');
for (const w of ['اكل', 'ياكل', 'ماكول', 'ارض', 'اب', 'اكرام', 'تاكيد', 'اخبار', 'اسلام', 'ام', 'ان']) ok(accepts(w, 'basic'), w + ' (basic)');
ok(!accepts('اضظ', 'basic'), 'junk is still refused in Basic');
group('the computer reads strictly: verified spelling only');
for (const w of ['أكل', 'يأكل', 'أب', 'إرسال', 'أرض', 'أمر', 'أخذ', 'أحمد', 'كتاب', 'استخدم']) ok(D.isReal(w, { mode: 'expanded' }), w + ' may be played by the computer');
for (const w of ['اكل', 'اب', 'ارض', 'أضظ', 'إكل']) ok(!D.isReal(w, { mode: 'expanded' }), w + ' is never played by the computer');
group('idhafa still wins');
for (const w of ['كتابي', 'بيتهم', 'قلمك', 'لي', 'به', 'منه', 'فيه', 'عليه']) ok(!accepts(w), w + ' refused');
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
