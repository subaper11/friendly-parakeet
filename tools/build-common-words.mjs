// Build the EXACT common-word filter (data/common-words.bin + data/common-words.txt).
//
// Why a second filter. data/words.bin is folded (أ إ آ ٱ -> ا, ى -> ي) and was built from a spell-checker's forms, so it cannot
// confirm the exact spelling of a common word. This tool starts from the AyaSpell source, expands every stem through the affix
// rules, keeps the forms that also appear in a frequency list of real usage, and stores them in the SAME 'AWL1' Bloom format.
// js/dictionary.js consults it after the shape / idhafa / hamza checks: an exact hit is 'valid, verified' and the word is never
// 'uncertain' again. The list is small (~27k), so the false-positive rate can be pushed to 1e-9 cheaply.
//
//   node tools/build-common-words.mjs            download (cached) + verify + rebuild data/common-words.{txt,bin}
//   node tools/build-common-words.mjs --check    offline: is data/common-words.bin exactly the filter of data/common-words.txt?
//
// Sources are pinned by content SHA-256, not by a branch name: a silent upstream edit fails the build instead of changing the game.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { parseAff, parseDic, expandForms, stripMarks } from './lib/ayaspell.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, 'tools', '.cache');
const OUT_TXT = path.join(root, 'data', 'common-words.txt');
const OUT_BIN = path.join(root, 'data', 'common-words.bin');

const SOURCES = [
  {
    name: 'ar.aff', url: 'https://raw.githubusercontent.com/linuxscout/ayaspell/master/templates/ar.aff',
    sha256: '86133C08F63E7BA8AA71CBECE12D3BCA9BCB4BDD267FDD3F0413865F5F8B7F59'
  },
  {
    name: 'ar.dic', url: 'https://raw.githubusercontent.com/linuxscout/ayaspell/master/templates/ar.dic',
    sha256: '23DFFF18431A3D908BC90E9C319B009A0D74664DC9FF5F9985994EDEE50D4321'
  },
  {
    name: 'ar_50k.txt', url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/ar/ar_50k.txt',
    sha256: '9D728D5CC49AE78358107E08E3A5B56FFEE92DAC06C2F8A8C6DE3BD42617D539'
  }
];

// Spellings the frequency list contains but that are not the standard orthography. They are refused by js/hamza.js (MISSPELLED)
// and must never enter the exact filter: an exact hit bypasses the leniency of the folded list.
const EXCLUDE = new Set(`
مسئول مسئولة مسئولات مسئولون مسئولين مسئولية مسئولا مسئوليتي
شئ شئون
مسايل
إستخدام إستمرار إجتماع إنتظار إحترام إستقبال إستفسار إستعداد إستعراض إستعلام إستثمار إستشارة إستقرار إستراتيجية
إبن إثنين إذني إرمي إرني إمرتي إلق إلقي إنش إنشات
أسئل أسئلك أسئله أتسائل بدئت بريئه بطئ تملئ جرئ خطئ شيئ عبئ لشيئ ملئ لملئ مائه مخطئه هيئه ورائه
`.trim().split(/\s+/));

// Words that real usage carries and AyaSpell's template does not expand (loanwords and recent vocabulary). Curated by hand,
// kept short and auditable: these are the words that the frequency list proves people use but the spell-checker lacks.
const INCLUDE = new Set(`
شوكولاتة بيتزا شاورما برجر همبرجر كيك لازانيا دونات كرواسان سباغيتي معكرونة ساندويتش
موبايل تلفون تلفزيون سيرفر سوفتوير هاردوير بلوتوث أونلاين إنترنت إيميل
واتساب فيسبوك تويتر يوتيوب جوجل نتفليكس سوبرماركت ماكدونالدز
`.trim().split(/\s+/));

const WORD_RE = /^[\u0621-\u064A]{2,15}$/;
const pct = n => n.toLocaleString('en-US');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase(); }
function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

async function source(s) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, s.name);
  let buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (buf && sha256(buf) === s.sha256) return buf.toString('utf8');
  console.log(`downloading ${s.name} ...`);
  const res = await fetch(s.url);
  if (!res.ok) fail(`${s.name}: HTTP ${res.status}`);
  buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== s.sha256) fail(`${s.name}: SHA-256 ${got}, expected ${s.sha256}`);
  fs.writeFileSync(file, buf);
  return buf.toString('utf8');
}

// ---------- the file format (identical to data/words.bin, see js/dictionary.js) ----------
function hash(s, seed) {
  let x = seed >>> 0;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489909) >>> 0; x ^= x >>> 16;
  return x >>> 0;
}
function bloom(words, fp = 1e-9) {
  const n = words.length;
  const m = Math.ceil((-n * Math.log(fp) / (Math.LN2 ** 2)) / 8) * 8;
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  const out = new Uint8Array(16 + m / 8);
  out[0] = 0x41; out[1] = 0x57; out[2] = 0x4C; out[3] = 0x31;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, m, true); out[8] = k; dv.setUint32(12, n, true);
  for (const w of words) {
    const h1 = hash(w, 2166136261), h2 = (hash(w, 0x9747b28c) | 1) >>> 0;
    for (let i = 0; i < k; i++) {
      const idx = ((h1 + Math.imul(i, h2)) >>> 0) % m;
      out[16 + (idx >> 3)] |= 1 << (idx & 7);
    }
  }
  return { bytes: Buffer.from(out), m, k, n, fpr: (1 - Math.exp(-k * n / m)) ** k };
}

const readTxt = txt => String(txt).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

// ---------- --check ----------
if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUT_TXT) || !fs.existsSync(OUT_BIN)) fail('data/common-words.{txt,bin} missing: run node tools/build-common-words.mjs');
  const words = readTxt(fs.readFileSync(OUT_TXT, 'utf8'));
  const bad = words.filter(w => !WORD_RE.test(w));
  if (bad.length) fail(`${bad.length} invalid entries in common-words.txt, e.g. ${bad.slice(0, 3).join(' ')}`);
  if (new Set(words).size !== words.length) fail('duplicate entries in common-words.txt');
  const built = bloom(words);
  const have = fs.readFileSync(OUT_BIN);
  if (!built.bytes.equals(have)) fail('common-words.bin is not the filter of common-words.txt: rebuild it');
  console.log(`ok: ${pct(words.length)} exact common words, m=${pct(built.m)} bits, k=${built.k}, false-positive ${built.fpr.toExponential(2)}, ${pct(have.length)} bytes`);
  process.exit(0);
}

// ---------- build ----------
const aff = parseAff(await source(SOURCES[0]));
const dic = parseDic(await source(SOURCES[1]));
const freqText = await source(SOURCES[2]);
console.log(`AyaSpell: ${pct(dic.length)} stems, ${aff.groups.size} affix groups, flag mode ${aff.flagMode}, ${pct(aff.aliases.length)} aliases`);

const forms = expandForms(dic, aff);
console.log(`expanded: ${pct(forms.size)} exact forms`);

const freq = [];
const seenFreq = new Set();
for (const line of freqText.split(/\r?\n/)) {
  const w = stripMarks((line.split(/\s/)[0] || '').trim());
  if (!w || seenFreq.has(w) || !WORD_RE.test(w)) continue;
  seenFreq.add(w); freq.push(w);
}
const keep = new Set();
for (const w of freq) if (forms.has(w) && !EXCLUDE.has(w)) keep.add(w);
for (const w of INCLUDE) if (WORD_RE.test(w) && !EXCLUDE.has(w)) keep.add(w);
const words = [...keep].sort();

const built = bloom(words);
const header = `# Exact common-word filter for the automatic validator (data/common-words.bin).
#
# Built by tools/build-common-words.mjs from:
#   AyaSpell ar.dic + ar.aff (linuxscout/ayaspell, GPL-2.0 / LGPL-2.1 / MPL-1.1)  sha256 23DFFF18... / 86133C08...
#   FrequencyWords ar_50k.txt (hermitdave/FrequencyWords, CC-BY-SA)                sha256 9D728D5C...
# Method: expand every AyaSpell stem through its affix rules, keep the exact forms that also occur in the frequency list,
# remove curated misspellings (مسئولية، شئون، مسايل ...) and add curated modern loanwords. Sorted, unique, ${words.length} words.
# The .bin is the same 'AWL1' Bloom format as data/words.bin: ${built.m} bits, ${built.k} hashes, theoretical false-positive ${built.fpr.toExponential(2)}.
`;
fs.writeFileSync(OUT_TXT, header + words.join('\n') + '\n');
fs.writeFileSync(OUT_BIN, built.bytes);
console.log(`wrote data/common-words.txt (${pct(words.length)} words) and data/common-words.bin (${pct(built.bytes.length)} bytes, m=${pct(built.m)}, k=${built.k}, fp=${built.fpr.toExponential(2)})`);
