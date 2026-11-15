// Automatic word judging: the dictionary. Pure (no DOM, no I/O): it is given the bytes of data/words.bin, so the browser (local play against the
// computer) and the Edge Function (online rooms set to "automatic") run the SAME code. Mirrored to supabase/functions/_shared/game by tools/sync-edge-shared.mjs.
//
// Source: data/words.bin = a Bloom filter of Arabic word forms built from the AyaSpell dictionary (see data/README-wordlist.txt for the credit and licence).
// The list stores the SKELETON of a word: أ إ آ ٱ are folded to ا and ى to ي, diacritics and tatweel are removed. ة ؤ ئ ء keep their own letters.
// data/common-words.bin is an optional SECOND Bloom filter of EXACT spellings (the same 'AWL1' format): the common forms produced by
// expanding the AyaSpell affix rules and keeping those that occur in a frequency list. An exact hit verifies a word that the folded
// list can only mark 'uncertain', and it is what makes common words such as متأخرة، مفاجأة، إلغاء certain again. The argument is
// optional so an older caller (or an old deployment) still works: without it the judge behaves exactly as before.
//
// Policy (decided by the owner): reject only words that are CLEARLY unknown, and accept the questionable ones.
//   check(raw, {mode})  is that lenient judge, used for human moves.      -> {ok:true} | {ok:false, why:'shape'|'idhafa'|'unknown'}
//   isReal(raw, {mode}) is a strict judge, used only by the computer opponent, which tries thousands of strings and so must not find stray entries.
// `raw` is the word as the TILES spell it: a joining hamza-on-ya tile is 'ئـ' (ئ + tatweel), the plain one is 'ئ'. Pass the tile letters, not wordStr().
//
// What is judged, in order:
//   1. shape      letter positions no Arabic word has: ة or ى before the last letter, ئـ at the end, plain ئ before another letter, إ inside a word.
//   2. idhafa     the owner's rule: an attached pronoun is never allowed (لي لك له به منه فيه عليه ... and noun + ـهم ـها ـكم ـك ـه ـي ...).
//   3. the exact common filter (data/common-words.bin, when supplied): a hit is confirmed.
//   4. the list   the word itself, or ال + a listed word, or an inflected form of a listed word (plural, dual, feminine, verb endings): that last step is the leniency.
// Hamza and alif (js/hamza.js) are judged between steps 2 and 3, exactly as the tiles were laid. The mode tailors step 3: Basic has no ة ء ؤ ئ tiles, so ـه stands for ـة and a medial ي / و may stand for ئ / ؤ; Expanded and Adaptive match the letters they were given.
// Limits, stated plainly: the list cannot tell أ from ا or إ from ا (it is stored folded), so the hamza seat on an alif is not judged; and a word the list does
// not know (a rare name, a new loanword) is rejected, which is exactly what the owner's "automatic or Tahkim" room choice is for.

import { createHamza, badShape, clean } from './hamza.js';

const DIAC = /[\u064B-\u0652\u0654\u0655\u0670\u0640]/g;
const FOLD = w => w.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
export function normalize(w) {
  w = String(w == null ? '' : w);
  if (w.normalize) w = w.normalize('NFKC');
  return FOLD(w.replace(DIAC, '')).trim();
}

// ---------- the Bloom filter (the file format of data/words.bin: 'AWL1', m bits, k hashes, n words) ----------
function hash(s, seed) {
  let x = seed >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489909) >>> 0; x ^= x >>> 16;
  return x >>> 0;
}
function loadBloom(buffer, label = 'words.bin') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16 || bytes[0] !== 0x41 || bytes[1] !== 0x57 || bytes[2] !== 0x4C || bytes[3] !== 0x31) throw new Error(label + ': bad file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const m = dv.getUint32(4, true), k = bytes[8], n = dv.getUint32(12, true);
  const has = word => {
    const h1 = hash(word, 2166136261), h2 = (hash(word, 0x9747b28c) | 1) >>> 0;
    for (let i = 0; i < k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % m;
      if (!((bytes[16 + (idx >> 3)] >> (idx & 7)) & 1)) return false;
    }
    return true;
  };
  return { has, count: n };
}

// ---------- hand-checked data ----------
const set = s => new Set(s.trim().split(/\s+/));
// Two-letter words: the list holds hundreds of 2-letter fragments that are not words, so a 2-letter word must be on this checked list. Attached-pronoun forms
// (لي لك له بي به) are deliberately NOT here. The two-letter alif words (أب أم أخ أن إن إذ أي أو آه ...) are on the hamza lexicon (js/hamza.js), spelled exactly.
const WORD2 = set(`بت بث بح بخ بر بط بع بق بك بل بن بل تب تل تم تو ثب ثج ثر ثق ثم جئ جب جد جذ جر جز جس جص جف جل جم جن جو حب حت حث حج حد حر حز حس حش حص حض حط حظ حق حك حل حم حن حي
خب خد خذ خر خز خس خص خض خط خف خل خن دب در دس دع دف دق دك دل دم دن ذا ذب ذر ذق ذل ذم ذو ذي رب رث رج رخ رد رز رس رش رص رض رف رق رم رن ري زج زد زر زف زق زل زم زن زي سب ست سح سد سر سك سل سم سن
شب شج شح شد شذ شر شط شف شق شك شل شم صب صح صد صر صغ صف صك صل صم صن صه ضب ضج ضخ ضد ضر ضع ضل ضم ضن طب طر طف طل طم طن طي ظل ظن عج عد عز عس عش عض عظ عف عق عم عن عي غب غث غد غر غش غص غض غط غل غم غن غي
فئ فت فج فخ فذ فر فش فص فض فظ فك فل فم فن في قئ قح قد قر قس قش قص قط قف قل قم كب كد كر كف كل كم كن كي لا لب لذ لص لط لف لم لن لو ما مت مج مخ مد مذ مر مس مص مط مع مل من نث ند نر نص نط نق نل نم
ها هب هد هر هز هش هل هم هن هو هي ود ول يا يد يم`);
// Real two-letter nouns that may follow ال (الأب، اليد، الدم، الفم ...).
const NOUN2 = set(`بت بث بر بط بق بن تب تل تم تو ثج جب جد جذ جر جز جس جص جف جل جم جن جو حب حت حث حج حد حر حز حس حش حص حض حط حظ حق حك حل حن حي خب خد خذ خر خز خس خص خط خف خل خن دب در دس دف دق دك دل دم دن
ذب ذر ذل ذم رب رث رج رخ رد رز رس رش رص رض رف رق رم ري زج زر زف زق زل زم زن زي سب ست سح سد سر سك سل سم سن شب شج شح شد شذ شر شط شف شق شك شل شم صب صد صر صف صك صل صم صن ضب ضج ضخ ضد ضر ضم ضن طب طر طف طل طم طن طي
ظن عج عد عز عس عش عض عف عق عم عي غب غث غد غر غش غض غط غل غم غن غي فت فج فخ فذ فر فش فص فض فظ فك فل فم فن قح قر قس قش قص قط قل كب كد كر كف كل كم كن لب لذ لص لط لف مت مج مخ مد مر مس مص مط مل نث ند نص نم هد هر هز هش هم ود يد يم`);
// Words the owner confirmed as real even though the list may not carry them (skeleton spelling).
const ALLOWED = set('كرسي حديقة قصة صحيفة لغة جبال صحراء طئ سقاف لماذا هناك هنالك هؤلاء أولئك ذلك كذلك ملوك سلوك شكوك صكوك');   // + function words and real words that end like an attached pronoun (the list or the idhafa rule would lose them)

// Common nouns whose attached-pronoun form is not also an ordinary adjective (so يومي، ديني، وطني، مالك stay allowed): noun + attached pronoun (كتابي، بيتهم، قلمك، مدرستها ...) is the idhafah the owner forbids in every form. The words themselves stay allowed.
const POSS_NOUNS = `كتاب بيت قلم باب كرسي دفتر سيارة مدرسة جامعة غرفة حقيبة طاولة نافذة صديق صديقة معلم معلمة طالب طالبة ولد بنت ابن اخ اخت اب ام جد جدة عم عمة زوج زوجة رجل امراة اسم وجه راس يد عين اذن انف فم دار بستان حديقة كلمة لغة فكرة قصة رسالة صورة لعبة هدية سؤال جواب`.split(/\s+/);
const NEEDS_HAMZA = set('اب ام اخ اخت اذن انف');   // their skeleton is a hamza word: the exact spelling is judged by js/hamza.js, not allowed blindly
for (const w of POSS_NOUNS) if (!NEEDS_HAMZA.has(w)) ALLOWED.add(w.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي'));   // the nouns themselves are words
const IDH_ENDS = ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'نا'];
// The attached-pronoun forms of the prepositions: the closed set that is never a word of its own.
const IDH_STEMS = {
  ل: ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'نا'], ب: ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'نا'],
  من: ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'ا'], في: ['ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'نا'],
  عل: ['يك', 'يه', 'يها', 'يهم', 'يهن', 'يهما', 'يكم', 'يكما', 'يكن', 'ينا'], الي: ['ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'نا'],
  عن: ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'ا'], مع: ['ي', 'ك', 'ه', 'ها', 'هم', 'هن', 'هما', 'كم', 'كما', 'كن', 'نا'],
  لد: ['ي', 'يك', 'يه', 'يها', 'يهم', 'يهن', 'يهما', 'يكم', 'يكما', 'ينا']
};
const IDH_CLOSED = new Set();
const IDH_PREP = new Set();   // the preposition + pronoun forms only (لي به منه فيه عليه ...): these never have a second reading
for (const n of POSS_NOUNS) { const f = n.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي'), base = f.endsWith('ة') ? f.slice(0, -1) + 'ت' : f; for (const e of IDH_ENDS) { if (f.endsWith('ي') && e === 'ي') continue; if (f.length + e.length >= 3) IDH_CLOSED.add(base + e); } }
for (const [p, ends] of Object.entries(IDH_STEMS)) for (const e of ends) { IDH_CLOSED.add(p + e); IDH_PREP.add(p + e); }
// Relatives that back a word up: a real word usually has a plural, a feminine, a verb form ... listed too; stray entries do not.
const REL_SUF = ['ة', 'ات', 'ان', 'ين', 'ون', 'وا', 'ت', 'تين', 'ية', 'ا', 'ي'];
const REL_PRE = ['ي', 'ت', 'ن', 'م'];
// Inflections that the leniency step strips (nominal first, then verbal).
const INFL_SUF = ['ات', 'ون', 'ين', 'ان', 'ة', 'وا', 'تم', 'تن', 'نا', 'ت', 'ن', 'ا'];
const INFL_PRE = ['ي', 'ت', 'ن', 'ا', 'م'];
const POSS_SUF = ['كما', 'هما', 'كم', 'كن', 'هم', 'هن', 'ها', 'ك', 'ه', 'ي'];

export function createDictionary(buffer, commonBuffer) {
  const bloom = loadBloom(buffer), has = bloom.has;
  // Exact common spellings are optional: an older caller passes one file and gets the old behaviour.
  const common = commonBuffer ? loadBloom(commonBuffer, 'common-words.bin') : null;
  const commonHas = w => !!common && common.has(w);

  const related = (w, need = 1) => {
    let n = 0;
    for (const s of REL_SUF) { if (has(w + s) && ++n >= need) return true; }
    for (const p of REL_PRE) { if (has(p + w) && ++n >= need) return true; }
    return n >= need;
  };
  // Does the word carry inflections of its own? Attached-pronoun forms (كتابهم) never do, real words (مالك، عربي) usually do.
  const ownForms = w => has(w + 'ة') || has(w + 'ات') || has(w + 'ون') || has(w + 'ين') || has(w + 'ان') || has('ي' + w) || has('ت' + w) || has('ن' + w);

  // Rule 2: a noun / verb + attached pronoun. Fires only when the stem is a listed word and the word has no forms of its own.
  const possessive = w => {
    if (ALLOWED.has(w)) return false;   // a word confirmed as real that merely ends like a pronoun (هناك، ملوك)
    if (IDH_CLOSED.has(w)) return true;
    for (const s of POSS_SUF) {
      if (w.length - s.length < 3 || !w.endsWith(s)) continue;
      const stem = w.slice(0, -s.length);
      if (has(stem) && !ownForms(w)) return true;
    }
    return false;
  };

  // The list itself, with the leniency steps. `loose` = false is the strict (computer) reading: the word, or ال + the word, and nothing derived.
  const known = (w, loose) => {
    if (w.length < 2) return false;
    if (ALLOWED.has(w)) return true;
    if (w.length === 2) return WORD2.has(w);
    if (has(w)) return true;
    if (w.startsWith('ال') && w.length >= 4) {
      const r = w.slice(2);
      if (r.length === 2) { if (NOUN2.has(r) && has(r)) return true; }
      else if (ALLOWED.has(r) || (has(r) && !has(r + '#'))) return true;   // ال never meets a verb (the file marks those words with a '#' twin key)
    }
    if (!loose) return false;
    // ---- leniency: an inflected form of a listed word ----
    let b = w.startsWith('ال') && w.length >= 5 ? w.slice(2) : w;
    for (let pi = -1; pi < INFL_PRE.length; pi++) {
      const p = pi < 0 ? '' : INFL_PRE[pi];
      if (p && !b.startsWith(p)) continue;
      const rest = b.slice(p.length);
      for (let si = -1; si < INFL_SUF.length; si++) {
        const s = si < 0 ? '' : INFL_SUF[si];
        if (!p && !s) continue;
        if (s && !rest.endsWith(s)) continue;
        const stem = s ? rest.slice(0, -s.length) : rest;
        if (stem.length < 3 || !has(stem)) continue;
        if (stem.length >= 4 || related(stem)) return true;
      }
    }
    return false;
  };

  // The spellings a mode accepts for the same word. Basic has no ة / ء / ؤ / ئ tile: a final ه may stand for ة, and a medial ي / و for ئ / ؤ.
  const variants = (w, mode) => {
    const out = [w];
    if (mode !== 'basic') return out;
    const bases = [w]; if (w.length > 2 && w.endsWith('ه')) { bases.push(w.slice(0, -1) + 'ة'); out.push(bases[1]); }
    for (const b of bases) for (const v of subs(b)) out.push(v);
    return out;
  };
  const subs = w => {
    const out = [], pos = [];   // where a ي / و may stand for ئ / ؤ: inside the word, and at its very end (شاطئ، جرؤ)
    for (let i = 1; i < w.length; i++) if (w[i] === 'ي' || w[i] === 'و') pos.push(i);
    const sub = i => w.slice(0, i) + (w[i] === 'ي' ? 'ئ' : 'ؤ') + w.slice(i + 1);
    for (const i of pos) out.push(sub(i));
    if (pos.length <= 6) for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) { const i = pos[a], j = pos[b]; const t = w.split(''); t[i] = w[i] === 'ي' ? 'ئ' : 'ؤ'; t[j] = w[j] === 'ي' ? 'ئ' : 'ؤ'; out.push(t.join('')); }
    return out;
  };

  // A root the list knows: its 3-letter past form is listed and at least two of its relatives (feminine, plural, verb forms ...) are too.
  const rootOK = r => has(r) && related(r, 2);
  const hz = createHamza(rootOK);

  // The three outcomes of the release spec: 'valid' (confirmed), 'uncertain' (accepted, evidence is thin), 'invalid' (refused). ok = status !== 'invalid'.
  const fin = r => ({ ...r, status: r.ok ? (r.soft ? 'uncertain' : 'valid') : 'invalid' });

  // The order matters: shape -> idhafa -> hamza/alif exactness -> the list -> inflections -> (human reading only) a doubtful word that starts with a hamza.
  function judge(raw, mode, loose) {
    if (badShape(raw)) return { ok: false, why: 'shape' };
    const w = normalize(raw);
    if (w.length < 2) return { ok: false, why: 'shape' };
    const vs = variants(w, mode);
    // The word as typed is an attached-pronoun form: refused. The one exception is Basic, which has no ة tile: a final ه may be the ة of a real word (كتابه / كتابة), unless it is a preposition + pronoun.
    if (possessive(vs[0]) && !(mode === 'basic' && !IDH_PREP.has(vs[0]) && vs[0].endsWith('ه') && vs.some(v => v !== vs[0] && v.endsWith('ة') && !possessive(v) && known(v, false)))) return { ok: false, why: 'idhafa' };
    let listHit = false;
    for (const v of vs) if (!possessive(v) && known(v, false)) listHit = true;
    const typed = clean(raw);
    const hs = mode === 'basic' ? vs : [typed];   // Basic: the hamza lexicon is read through every spelling the tiles allow
    for (const t of hs) {
      const h = hz.check(t, mode, listHit);
      if (h && h.v === 'ok') return { ok: true, verified: true };
      if (h && h.v === 'wrong') return { ok: false, why: 'spelling', hint: h.hint };
    }
    // An exact common spelling (data/common-words.bin): the folded list can only guess, this file confirms it. Basic reads the
    // spellings its tiles allow (ه for ة، ي / و for ئ / ؤ), so the same word can be confirmed there too (شاورما، بيتزا).
    if (mode !== 'basic' ? commonHas(typed) : vs.some(v => commonHas(v))) return { ok: true, verified: true };
    if (listHit) return { ok: true };
    // An inflected form of a listed word (plural, dual, feminine, verb endings) that the list itself does not carry: accepted, but only as 'uncertain' (the evidence is the listed stem, not the word).
    if (loose) for (const v of vs) if (!possessive(v) && known(v, true)) return { ok: true, soft: true };
    return { ok: false, why: 'unknown' };
  }

  // ---- the computer's trust filter: a word must be backed up by related forms, so stray list entries are never played ----
  const PRONOUN_END = /(هو|هم|هن|ها|هما|كم|كن|كما|ني|نا|تهم|تها|ته|تك|تنا|تني)$/;
  function trusted(raw) {
    let w = normalize(raw);
    if (w.length >= 4 && w.startsWith('ال')) w = w.slice(2);
    if (ALLOWED.has(w)) return true;
    if (w.charAt(0) === 'ا' && w.length <= 3) return false;   // the list knows many stray 3-letter alif fragments
    if (w.length <= 2) return true;
    if (/ءي$/.test(w)) return false;
    if (w.length >= 4 && PRONOUN_END.test(w) && !ownForms(w)) return false;
    let need = w.length === 3 ? 3 : w.length === 4 ? 2 : 1;
    if (w.length >= 4 && w.length <= 6 && (/ة$/.test(w) || /اء$/.test(w))) need = 0;
    if (need === 0) return true;
    let n = 0;
    for (const s of REL_SUF) {
      if (has(w + s)) n++;
      if (n < need && w.length > 3 && w.endsWith(s) && has(w.slice(0, -s.length))) n++;
      if (n >= need) return true;
    }
    for (const p of REL_PRE) {
      if (has(p + w)) n++;
      if (n < need && w.length > 3 && w.charAt(0) === p && has(w.slice(1))) n++;
      if (n >= need) return true;
    }
    return n >= need;
  }

  return {
    count: bloom.count,
    normalize,
    /** Lenient judge for human moves. */
    check: (raw, opts = {}) => fin(judge(raw, opts.mode || 'expanded', true)),
    /** Strict judge for the computer opponent: a listed, trusted, rule-abiding word. */
    isReal: (raw, opts = {}) => { const r = judge(raw, opts.mode || 'expanded', false); return r.ok && (r.verified || trusted(raw)); },
    /** words: raw tile spellings. Returns one verdict per word, in order: {word, ok, why?, soft?} (soft = accepted although the list cannot confirm it). */
    judgeAll: (words, opts = {}) => words.map(raw => ({ word: normalize(raw) || String(raw), ...fin(judge(raw, opts.mode || 'expanded', true)) })),
    /** The clearly unknown ones only: [{word, why}]. */
    rejected: (words, opts = {}) => words.map(raw => ({ word: normalize(raw) || String(raw), ...judge(raw, opts.mode || 'expanded', true) })).filter(r => !r.ok).map(({ word, why, hint }) => ({ word, why, hint }))
  };
}

// One Arabic sentence for the words a judge refused (shown to the player; the server and the local game use the same text).
const WHY = { unknown: 'غير معروفة في القاموس', idhafa: 'ممنوعة: ضمير متصل (إضافة)', shape: 'شكلها غير صالح (موضع الهمزة أو الألف)', spelling: 'إملاؤها غير صحيح' };
export const explainRejected = bad => bad.slice(0, 2).map(x => `«${x.word}» ${WHY[x.why] || WHY.unknown}${x.hint ? ` — الصواب «${x.hint}»` : ''}`).join(' · ') + (bad.length > 2 ? ` · +${bad.length - 2}` : '') + '. عدّل الكلمة أو أعد القطع.';
