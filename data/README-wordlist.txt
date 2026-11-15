words.bin        - Bloom-filter word list (2.4 MB; 'AWL1' header: 19,200,000 bits, 23 hashes, 384,796 keys). Read by js/dictionary.js (browser, worker and Edge Function share the one file format).
                   Keys are SKELETON spellings: diacritics and tatweel removed, أ إ آ ٱ -> ا, ى -> ي; ة ؤ ئ ء keep their letters. A key with a '#' suffix marks a word that cannot take ال.
                   Because the skeleton is folded, this file cannot say which alif is a hamza: js/hamza.js judges that (exact spelling), see docs/AUTO_WORDS_AND_COMPUTER.md.
common-words.bin - Bloom-filter list of 26,982 EXACT common spellings (145 KB; 'AWL1': 1,163,816 bits, 30 hashes, theoretical false-positive 1e-9). Same format, passed as the optional
                   second argument of createDictionary(). It confirms common words the folded list can only guess (متأخرة، مفاجأة، إلقاء، رؤى، أريكة…) and curated loanwords (شوكولاتة، بيتزا…).
                   data/common-words.txt is the same list in sorted plain text; `node tools/build-common-words.mjs --check` proves the binary is exactly its filter.
Bloom bounds    - words.bin: theoretical false-positive 1.1e-10 (about 1 in 9 billion lookups). common-words.bin: 1e-9. A Bloom collision is therefore almost never the reason a word is
                   accepted; the real limit is CONTENT (a spell-checker artefact, dialect, a folded alif, a debated orthography).
OLD CLAIMS      - An earlier version of this file said "533,860 word forms" and "~0.011% of random nonsense accepted". The words.bin header says 384,796 keys; the 533,860 figure could not be
                   reproduced from the file and is withdrawn. Random nonsense is accepted far more often than 0.011% at 3 letters (about a fifth of random letter triples are listed,
                   because they are real roots): the validator therefore never relies on the list alone for short words.
Provenance      - common-words.bin IS reproducible here: tools/build-common-words.mjs downloads the pinned AyaSpell ar.aff / ar.dic and the pinned FrequencyWords ar_50k.txt, checks their
                   SHA-256, expands the affix rules (tools/lib/ayaspell.mjs), intersects the forms with the frequency list, applies the curated include/exclude lists, and writes both files.
                   words.bin is still a RECEIVED artefact: its exact AyaSpell version and original build script are not in this repository, so that folded file cannot be regenerated here.
                   The cached upstream downloads live in tools/.cache/ (git-ignored); delete them to force a fresh download.

Source: AyaSpell Arabic Hunspell dictionary by Taha Zerrouki and Mohamed Kebdani,
tri-licensed GPL 2.0 / LGPL 2.1 / MPL 1.1 (see AYASPELL-COPYING.txt, AYASPELL-AUTHORS.txt). https://github.com/linuxscout/ayaspell
FrequencyWords by Hermit Dave, CC-BY-SA: https://github.com/hermitdave/FrequencyWords
Both word lists are derived from AyaSpell (the common list also from FrequencyWords). Keep this credit with the files. Not legal advice.
