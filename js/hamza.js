// Hamza and alif: the part of word judging that the word list cannot do. Pure (no DOM, no I/O); mirrored to the Edge Function with dictionary.js.
//
// Why it exists. data/words.bin stores every word FOLDED (أ إ آ ٱ -> ا), and it was built without many words whose FIRST letter or first root letter is a hamza on an
// alif (أكل، أرض، يأكل، مأكول، تأكيد ...). So the list cannot say whether the spelling a player made with the أ إ آ ا tiles is right, and it does not know many real words.
// This module adds three things, all of them exact (they judge the tiles as laid, not the folded skeleton):
//   1. SHAPE      where each alif-family letter may stand in an Arabic word (no word starts with ء ؤ ئ, آ never ends a word, two alif-family letters never touch ...).
//   2. LEXICON    a checked list of common hamza words (exact spelling) + every form of the hamza-first-root verbs (أكل آكل يأكل مأكول تأكيد ...), generated.
//   3. PATTERNS   a word that starts with a hamza on an alif and matches a Form IV / elative / plural pattern over a ROOT the list knows (أكرم، إرسال، أدوية، أحاديث ...).
// check() answers: 'ok' (the exact spelling is verified), 'wrong' (it is the same word spelled with the wrong alif/hamza: the answer carries the right spelling),
// or null (no opinion: the list decides).  In Basic mode (no hamza tiles) it only verifies: any alif form of a verified word is accepted.

const FOLD = w => w.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
const set = s => new Set(s.trim().split(/\s+/));
export const clean = w => String(w == null ? '' : w).normalize('NFKC').replace(/[\u064B-\u0652\u0654\u0655\u0670\u0640]/g, '');

// ---------- 2. the lexicon (exact spellings) ----------
const LEX = set(`
أن إن أو أي إي أم أب أخ آب آه آل آن أنا أنت أنتم أنتما أنتن أيا أيها أيتها أين أيان أيضا إذا إذ إذن إلى إلا إما أما إنما إياك إياه إياي إيانا لأن كأن كأنما لئلا لئن
أبدا أبعاد أبناء أبواب أبيض أبطال أبحاث أبو أحباب أحد أحداث أحدث أحسن أحلام أحمد أحمر أحوال أخبار أخت أخرى أخضر أخطاء أخلاق أخوات أخوان أخو أخيرا أدب أدوات أدوية
أذن أذكى أرجل أرض أرقام أرنب أرز أزرق أزمة أساس أساتذة أستاذ أستاذة أسرار أسرة أسد أسعار أسلوب أسماء أسئلة أسبوع أسنان أسود أسهل أشجار أشخاص أشهر أشد أشياء
أصبع أصابع أصدقاء أصعب أصفر أصل أصول أضواء أطفال أطعمة أطول أعداد أعضاء أعظم أعلى أعمال أعمدة أعين أغلب أغنية أفراد أفضل أفعال أفق أفكار أفلام أقارب أقدام أقرب
أقل أقلام أقوال أكبر أكثر أكل أكلة أكياس ألعاب ألفاظ ألقاب ألف ألم ألوان أمام أمثال أمر أمراض أمس أمل أمن أمة أمم أمين أمور أنباء أنظمة أنف أنثى أنواع أنهار أنوار
أهالي أهداف أهل أهم أهمية أوائل أوجه أوراق أوسط أوقات أول أولاد أولى أيام أيد أيدي أيسر أيمن
أصبح أضاف أعطى أراد أعاد أحب أجاب أحس أحاط أقام أضاء أنار أطال أمال أشار أجاز أقال أبان أبقى أبدى أتى أتم أتاح أصاب أضر أعان أطاع أحال أنشأ أبدأ
إبراهيم إبرة إبل إبهام إبريق إثم إجابة إجازة إجراء إجراءات إحساس إحسان إحصاء إخلاص إخوة إخوان إدارة إدخال إرادة إرسال إرشاد إسلام إسماعيل إشارة إصبع إصدار
إصلاح إطار إعادة إعلام إعلان إعداد إفريقيا إفطار إقامة إقليم إكرام إكمال إله إلهام إمام إمارة إمكان إمكانية إناء إنتاج إنجاز إنسان إنسانية إنشاء إنترنت إنذار
إنفاق إخبار إسرار إبعاد إحداث إنشاد إيجاد إيجاب إيمان إيقاع إيران إيطاليا إسبانيا إندونيسيا إنجليزي إسلامي إيجابي إلكتروني إداري إعلامي إنس
كأس رأس رأي فأر بأس سأل ثأر شأن سأم مأساة مسألة رأفة بدأ قرأ هدأ نشأ ملأ جزأ ظمأ وطأ لجأ برأ خطأ خبأ نبأ بطأ هنأ جرأ مرآة قرآن ظمآن مآكل مآثر
أطباء أدباء أنبياء أولياء أغنياء أقوياء أحباء أعزاء أذكياء أشقاء أقرباء أمراء أمهات أبوين أخوين
مستشفى ذكرى حتى متى مستوى معنى مبنى مأوى منتدى ملتقى أقصى أدنى كبرى صغرى بشرى مصطفى
آباء آثار آخر آخرة آخرون آذان آراء آلاف آلة آلات آمال آمن آية آيات آنية آفة آكل آخذ آسف آنسة آمين
متأخر متأخرة متأخرون متأخرين متأخرات مفاجأة مفاجآت مفاجئات مكافأة مكافآت منشأة منشآت إضاءة إعطاء إلقاء إلقاءات إلغاء إلغاءات رؤى أريكة أمير
مسؤول مسؤولة مسؤولات مسؤولون مسؤولين مسؤولية شؤون مسائل`);

// Verbs whose FIRST root letter is a hamza (أكل، أخذ، أمر ...): every common form is generated with its exact spelling.
// Roots are written as their second and third letters (أكل -> كل).
const FR_ROOTS = 'كل خذ مر سر جر ثر ذن سس مل من هل صل كد دب خر ثم جل سف فل نث لف بد نس'.split(' ');
function frForms(root) {
  const b = root[0], c = root[1], A = 'أ', M = 'آ', bc = b + c, out = [];
  for (const s of ['', 'ت', 'نا', 'وا', 'ا', 'ن', 'تم', 'تما', 'تن']) out.push(A + bc + s, M + bc + s);                  // past: أكل أكلت أكلنا أكلوا · Form IV past: آمن آمنت آمنا آمنوا
  for (const p of ['ي', 'ت', 'ن']) out.push(p + A + bc);                                                             // present: يأكل تأكل نأكل
  for (const p of ['ي', 'ت']) for (const s of ['ون', 'ان', 'ن']) out.push(p + A + bc + s);                          // يأكلون تأكلان يأكلن
  out.push('ت' + A + bc + 'ين');                                                                                      // تأكلين
  for (const s of ['', 'ة', 'ون', 'ين', 'ان', 'ات']) out.push(M + bc + s);                                           // active participle / I eat: آكل آكلة آكلون
  for (const s of ['', 'ة', 'ات']) out.push('م' + A + b + 'و' + c + s);                                               // passive participle: مأكول مأكولة مأكولات
  out.push(A + bc + 'ة', A + bc + 'ات', M + b + 'ا' + c);                                                             // أكلة · أكلات · plural آثار آجال آمال
  out.push('ت' + A + b + 'ي' + c, 'ت' + A + b + 'ي' + c + 'ات');                                                       // Form II masdar: تأكيد تأمين تأخير تأثير تأجيل
  return out;
}
// Final ى (alif maqsura) is folded to ي by the word list, so the list cannot see it. For these words the ى spelling is the only one: a final ي is refused (Expanded / Adaptive).
// Words where the ي spelling is also a word or a name (على / علي, هدى / هدي ...) are deliberately NOT here.
export const MAQSURA = set('مستشفى ذكرى حتى متى مستوى معنى مبنى مأوى منتدى ملتقى أقصى أدنى كبرى صغرى بشرى مصطفى');
// Common misspellings the word list happens to carry (it was built from a spell-checker's forms): refused, with the right spelling.
export const MISSPELLED = new Map([
  ['مسؤل', 'مسؤول'], ['مسؤلية', 'مسؤولية'], ['مسؤلون', 'مسؤولون'], ['مسؤلين', 'مسؤولين'],
  ['مسئول', 'مسؤول'], ['مسئولة', 'مسؤولة'], ['مسئولات', 'مسؤولات'], ['مسئولون', 'مسؤولون'], ['مسئولين', 'مسؤولين'],
  ['مسئولية', 'مسؤولية'], ['مسئولا', 'مسؤولا'], ['مسئوليتي', 'مسؤوليتي'],
  ['شئون', 'شؤون'], ['شئوني', 'شؤوني'], ['شئ', 'شيء'],
  ['مسايل', 'مسائل'], ['إبن', 'ابن'], ['إثنين', 'اثنين'], ['إنشات', 'إنشاءات'], ['إستراتيجية', 'استراتيجية'],
  ['مسئل', 'مسؤول'], ['مسئلة', 'مسألة']
]);
const EXACT = new Set(LEX);
for (const r of FR_ROOTS) for (const w of frForms(r)) EXACT.add(w);
const SKEL = new Map();   // folded skeleton -> exact spellings
for (const w of EXACT) { const k = FOLD(w); const a = SKEL.get(k); if (a) { if (!a.includes(w)) a.push(w); } else SKEL.set(k, [w]); }

// ---------- 1. shape ----------
const ALIF_FAMILY = /[اأإآ][اأإآ]/;
export function badShape(raw) {
  const t = String(raw == null ? '' : raw).replace(/[\u064B-\u0652\u0654\u0655\u0670]/g, '');
  if (/ئـ\s*$/.test(t)) return true;                        // the joining hamza-on-ya tile can never end a word
  if (/ئ(?![ـ])./su.test(t)) return true;                    // the plain one only ends a word
  if (/[ةى]./su.test(t)) return true;                         // ة and ى only close a word
  if (/^[ءؤئ]/.test(t)) return true;                         // no word starts with a bare hamza, ؤ or ئ (they start with أ إ آ)
  if (/آ\s*$/.test(t)) return true;                           // آ (alif madda) never ends a word
  if (ALIF_FAMILY.test(t.replace(/ـ/g, ''))) return true;     // two alif-family letters never touch: أا is آ, اا and أأ do not exist
  for (let i = 0; i < t.length; i++) if (t[i] === 'إ' && i !== 0 && t.slice(0, i) !== 'ال') return true;   // إ opens a word (or follows ال)
  return false;
}

// ---------- 3. patterns over a root the list knows ----------
const PLAIN = /^[ابتثجحخدذرزسشصضطظعغفقكلمنهوي]+$/;
const A_ = new Set(['أ']), AI = new Set(['أ', 'إ']);
const SFX = ['تما', 'تم', 'نا', 'وا', 'تن', 'ت', 'ن'];

export function createHamza(rootOK) {
  // What a word that starts with أ / إ / ا could be: Form IV verb / elative (أكرم أكبر), Form IV masdar or plural أفعال (إرسال أخبار), أفعلة (أدوية),
  // أفاعل (أصابع), أفاعيل (أحاديث), أفعلاء (أصدقاء). Returns {allowed: first letters it can take, plainOK: a plain ا is also a word} or null.
  function analyse(t) {
    const R = t.slice(1), found = [];
    const add = (root, allowed, plainOK, strong = true) => { if (root.length === 3 && PLAIN.test(root) && rootOK(root)) found.push({ allowed, plainOK, strong }); };
    if (R.length === 3) add(R, A_, true, false);                                                       // أكرم · plain: the imperative (اكتب, اذهب)
    for (const s of SFX) if (R.endsWith(s) && R.length - s.length === 3) add(R.slice(0, 3), A_, true, false);   // أكرمت أكرموا
    if (R.length === 4 && R[2] === 'ا') add(R[0] + R[1] + R[3], AI, 'تط'.includes(R[0]) || /^ا(ثن|سم|بن)/.test(t));   // إرسال / أخبار · plain: افتعال (اتصال اتفاق اطلاع)
    if (R.length === 4 && R[3] === 'ة') add(R.slice(0, 3), A_, false);                          // أدوية أطعمة أجهزة
    if (R.length === 4 && R[1] === 'ا') add(R[0] + R[2] + R[3], A_, false);                     // أصابع أقارب
    if (R.length === 5 && R[1] === 'ا' && R[3] === 'ي') add(R[0] + R[2] + R[4], A_, false);     // أحاديث أساليب
    if (R.length === 5 && R.endsWith('اء')) add(R.slice(0, 3), A_, false);                      // أصدقاء أغنياء
    if (!found.length) return null;
    const allowed = new Set(); let plainOK = false, strong = false;
    for (const f of found) { f.allowed.forEach(x => allowed.add(x)); plainOK = plainOK || f.plainOK; strong = strong || f.strong; }
    return { allowed, plainOK, strong };   // strong: the shape alone is evidence enough; a bare أ + 3 letters is not (about a quarter of all letter triples are roots), it needs the list too
  }

  // typed: the word as the tiles spell it (no diacritics, no tatweel). listKnows: the word list knows this skeleton.
  function check(typed, mode, listKnows) {
    const cands = [typed];
    if (typed.length > 3 && typed.startsWith('ال')) cands.push(typed.slice(2));
    for (const c of cands) if (EXACT.has(c)) return { v: 'ok' };                                // the exact spelling is on the lexicon
    if (mode !== 'basic') for (const c of cands) if (MISSPELLED.has(c)) return { v: 'wrong', hint: MISSPELLED.get(c) };
    if (mode !== 'basic') for (const c of cands) if (c.endsWith('ي') && MAQSURA.has(c.slice(0, -1) + 'ى')) return { v: 'wrong', hint: c.slice(0, -1) + 'ى' };   // ي for ى
    for (const c of cands) {
      const spell = SKEL.get(FOLD(c));
      if (!spell) continue;
      if (mode === 'basic') return { v: 'ok' };                                                 // no hamza tiles: any alif form of a verified word
      if (/^[أإآ]/.test(c)) return { v: 'wrong', hint: spell[0] };                              // a deliberate hamza that contradicts the lexicon
      if (!listKnows) return { v: 'wrong', hint: spell[0] };                                    // plain ا where the word needs a hamza, and the list does not know the plain word
    }
    const pats = cands.map(c => ((c[0] === 'أ' || c[0] === 'إ' || c[0] === 'ا') ? analyse(c) : null));
    for (let i = 0; i < cands.length; i++) {                                                    // a pattern over a known root verifies it
      const p = pats[i]; if (!p || !(p.strong || listKnows)) continue;
      if (mode === 'basic' || p.allowed.has(cands[i][0])) return { v: 'ok' };
    }
    for (let i = 0; i < cands.length; i++) {
      const p = pats[i]; if (!p) continue;
      if (!(p.strong || listKnows) && !(cands[i][0] === 'إ' && !p.allowed.has('إ'))) continue;   // a weak pattern only condemns إ (إ + 3 letters is never a verb or an elative)
      const c = cands[i], right = (p.allowed.has('أ') ? 'أ' : 'إ') + c.slice(1);
      if (c[0] === 'ا') { if (p.plainOK || listKnows) return null; return { v: 'wrong', hint: right }; }
      return { v: 'wrong', hint: right };                                                       // أ / إ the pattern does not allow
    }
    return null;
  }
  return { check };
}
export { SKEL as hamzaSkeletons, EXACT as hamzaWords };
