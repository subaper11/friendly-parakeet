// AyaSpell (Hunspell) source reader: enough of the .aff/.dic format to turn the dictionary's stems and affix rules into the
// exact word forms they spell. Used only by tools/build-common-words.mjs (a build-time tool, never shipped to the game).
//
// What it supports (what AyaSpell's ar.aff actually uses):
//   FLAG long (two-character flags) | FLAG num (comma-separated numbers) | one-character flags
//   AF alias tables (the `AF 333` line is a COUNT, the alias lines end with `#` or `# n`)
//   PFX / SFX rule groups with Y/N cross-product, strip, add (with /continuation) and conditions
// It deliberately does NOT try to be a full Hunspell engine: no COMPLEXPREFIXES, no NEEDAFFIX / FORBIDDENWORD / ONLYINCOMPOUND
// semantics (AyaSpell's template does not declare them), no ICONV/OCONV, no compound rules. The output is over-generated on
// purpose and then intersected with a frequency list, so an occasional extra form is harmless.
//
// The AyaSpell dictionary is tri-licensed GPL 2.0 / LGPL 2.1 / MPL 1.1. Keep data/AYASPELL-* with anything derived from it.

// Arabic diacritics, Quranic marks and tatweel: stripped before a form can match the game's folded list.
const MARKS = new Set([...'ًٌٍَُِّْٰـ']);
export const stripMarks = s => [...String(s)].filter(c => !MARKS.has(c)).join('');

const splitLines = text => String(text).replace(/^\uFEFF/, '').split(/\r?\n/);

// ---------- .aff ----------
export function parseAff(text) {
  const lines = splitLines(text);
  const flagMode = (() => {
    const l = lines.find(x => /^FLAG\s+/i.test(x));
    const v = l ? l.split(/\s+/)[1].toLowerCase() : '';
    return v === 'long' || v === 'num' ? v : 'short';
  })();

  // AF aliases are 1-based. Skip the `AF <count>` header (exactly two tokens). A real alias line has a trailing `#` / `# n`.
  const aliases = [];
  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] !== 'AF' || t.length < 3) continue;
    aliases.push(t[1]);
  }

  const groups = new Map();   // flag -> { type, flag, cross, rules: [] }
  let cur = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const head = line.match(/^(PFX|SFX)\s+(\S+)\s+(Y|N)\s+(\d+)\s*$/);
    if (head) {
      cur = { type: head[1], flag: head[2], cross: head[3] === 'Y', rules: [] };
      groups.set(head[2], cur);
      continue;
    }
    const rule = line.match(/^(PFX|SFX)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!rule || !cur || rule[2] !== cur.flag) continue;
    const add = rule[4].split('/')[0];
    cur.rules.push({
      strip: rule[3] === '0' ? '' : rule[3],
      add: add === '0' ? '' : add,
      cond: rule[5],
      re: condition(rule[5], rule[1])
    });
  }
  return { flagMode, aliases, groups };
}

// Hunspell conditions are regex fragments anchored at the start for PFX and the end for SFX. `.` is one character.
function condition(c, type) {
  const src = !c || c === '.' ? '[\\s\\S]' : (() => {
    let s = '';
    for (let i = 0; i < c.length; i++) {
      if (c[i] === '[') { const j = c.indexOf(']', i); if (j < 0) { s += '\\['; continue; } s += c.slice(i, j + 1); i = j; }
      else if (c[i] === '.') s += '[\\s\\S]';
      else s += c[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return s;
  })();
  return type === 'SFX' ? new RegExp('(?:' + src + ')$') : new RegExp('^(?:' + src + ')');
}

// ---------- .dic ----------
// Returns one entry per stem: { word, flags: raw flag token (alias number or flag string) }.
export function parseDic(text) {
  const out = [];
  for (const line of splitLines(text).slice(1)) {   // line 1 is the entry count
    if (!line.trim()) continue;
    const head = line.split(/\s/)[0];
    if (!head) continue;
    const slash = head.lastIndexOf('/');
    const word = stripMarks(slash < 0 ? head : head.slice(0, slash));
    if (!word) continue;
    out.push({ word, flags: slash < 0 ? '' : head.slice(slash + 1) });
  }
  return out;
}

function flagSet(raw, aff) {
  if (!raw) return [];
  if (/^\d+$/.test(raw)) return (aff.aliases[Number(raw) - 1] || '').match(/../g) || [];
  if (aff.flagMode === 'num') return raw.split(',');
  if (aff.flagMode === 'long') return raw.match(/../g) || [];
  return [...raw];
}

// Apply every rule of one group to one word. `type` is the group's PFX/SFX.
function applyGroup(group, word) {
  const out = [];
  for (const r of group.rules) {
    if (!r.re.test(word)) continue;
    if (r.strip && !(group.type === 'SFX' ? word.endsWith(r.strip) : word.startsWith(r.strip))) continue;
    const base = r.strip ? (group.type === 'SFX' ? word.slice(0, -r.strip.length) : word.slice(r.strip.length)) : word;
    const form = stripMarks(group.type === 'SFX' ? base + r.add : r.add + base);
    if (form) out.push(form);
  }
  return out;
}

// Expand all stems into the exact forms the dictionary spells (stem + one prefix/suffix + cross prefix+suffix).
export function expandForms(entries, aff) {
  const forms = new Set();
  for (const { word, flags } of entries) {
    forms.add(word);
    const fs = flagSet(flags, aff);
    const prefixes = [], suffixes = [];
    for (const f of fs) {
      const g = aff.groups.get(f);
      if (!g) continue;
      const grown = applyGroup(g, word);
      (g.type === 'PFX' ? prefixes : suffixes).push({ g, grown });
      for (const w of grown) forms.add(w);
    }
    for (const p of prefixes) {
      if (!p.g.cross) continue;
      for (const pw of p.grown) for (const s of suffixes) {
        if (!s.g.cross) continue;
        for (const w of applyGroup(s.g, pw)) forms.add(w);
      }
    }
  }
  return forms;
}
