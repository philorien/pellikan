# Data sources, licenses and known data issues

[![Code: AGPL v3](https://img.shields.io/github/license/philorien/pellikan?label=code)](LICENSE)
[![Data: licensed separately](https://img.shields.io/badge/data-licensed_separately-orange)](#data-sources-licenses-and-known-data-issues)

Pellikan bundles data from the projects below. `npm run data:fetch` downloads it from the upstream hosts into
`data/sources/` (git-ignored), and writes `data/sources/SOURCES.lock.json` with the URL and SHA-256 of every file, so a
build can state exactly which bytes it came from. The in-app Credits page is generated from the `sources` table in
`bible.db`, which `data/scripts/build-db.mjs` fills from the text in this file's tables.

I am not a lawyer. Verify each license against the upstream project before you distribute a build.

| Layer | Project | License | Notes |
| --- | --- | --- | --- |
| English text | World English Bible (ebible.org) | Public domain | The name "World English Bible" is a trademark of eBible.org. Do not use that name for a modified text. |
| English text (optional) | English Standard Version, from Crossway's ESV Classic Reference Bible ePub | Copyright Crossway. **Not freely redistributable.** See below. | Built in only if you supply the epub. Includes section headings, footnotes and about 98,000 cross-references. |
| Hebrew text | Westminster Leningrad Codex via OSHB | Public domain (text) | |
| Hebrew lemmas and morphology | Open Scriptures Hebrew Bible | CC BY 4.0 | Attribution required. |
| Greek text | SBL Greek New Testament | CC BY 4.0 per ebible.org | The MorphGNT README still cites the older SBLGNT EULA. Confirm the current terms before shipping. |
| Greek morphology and lemmas | MorphGNT | CC BY-SA 3.0 | ShareAlike. See below. |
| English text (bundled) | Berean Standard Bible (ebible.org) | Public domain | Dedicated to the public domain by BSB Publishing, LLC. Omits some verses the critical Greek text omits, so it has about 16 fewer verses than the KJV. |
| English text (bundled) | King James Version, 1769 text with Strong's numbers (ebible.org) | Public domain outside the UK | Crown letters patent apply to printing and importing printed copies in the UK. Pellikan is software, not a printer, but check before distributing in the UK. |
| English text (on demand) | American Standard Version, Young's Literal Translation, Darby (ebible.org) | Public domain | Not in `bible.db`. Downloaded by the app into the app data folder. See "Optional translations". |
| Lexicon | Strong's Hebrew, from the Open Scriptures Hebrew Lexicon | Strong's text public domain; encoding CC BY 4.0 | Credit "the Open Scriptures Hebrew Bible Project". |
| Lexicon | Brown-Driver-Briggs, same project | BDB text public domain; encoding CC BY 4.0 | The encoding is a work in progress; some entries are incomplete. Linked to Strong's numbers through the project's LexicalIndex.xml. |
| Lexicon | Strong's Greek (Open Scriptures JSON of Ulrik Petersen's XML) | CC BY-SA | **ShareAlike**, like MorphGNT. The 1890 text underneath is public domain. |
| Lexicon | Thayer's Greek-English Lexicon (nigelmsipa's digitization) | Public domain text; dataset CC0 | **OCR-derived.** One maintainer, one commit, pinned in `fetch.mjs`. Expect transcription errors. See below. |
| Dictionaries | Easton's (1897) and Smith's (1884) Bible Dictionaries, CrossWire modules | Public domain | Read from the SWORD module files directly (no libsword). |
| Commentary | Matthew Henry, CrossWire MHC module | Public domain | The Bible text quoted before each section was removed. |
| Cross-references | Treasury of Scripture Knowledge, CrossWire TSK module | Public domain | Parsed from the TSK's abbreviated notation by Pellikan. See below. |
| Cross-references | OpenBible.info | CC BY | Community votes. Only references with at least one positive vote are kept. Verify the license version before distributing. |

## Canonical verse numbering

Pellikan numbers verses the English (KJV) way, with the 66 OSIS book ids. The KJV is the reference versification
(the TSK, Matthew Henry and OpenBible are indexed by it) and every bundled translation is checked against it at
build time: same chapters, and a log line for any chapter that ends on a different verse. Hebrew verse numbers are
mapped to English through `versification_map`. Anything that numbers verses differently (Psalm titles, Malachi 3-4,
the Daniel additions, the Catholic canon, Septuagint psalm numbering) needs a mapping table to this scheme before it
is added. Do not add a translation without one. The deuterocanon is not loaded.

## Optional translations (downloaded on demand)

ASV, YLT and Darby are not in `bible.db`. `data/scripts/translations.mjs` lists them with `bundled: false`. How it works:

1. `npm run data:fetch -- --packs` downloads their source zips from ebible.org once and caches them in `data/sources/`.
2. `npm run data:packs` turns each into a pack: a gzipped SQLite file with the same schema as `bible.db` holding one
   translation, plus `manifest.json` listing every pack with its SHA-256. Output is in `data/build/packs/` (3 to 7 MB each).
   The script refuses a pack whose chapter structure differs from the canonical scheme.
3. **You publish that folder to a public HTTPS location.** The app reads the manifest from
   `https://github.com/philorien/pellikan/releases/download/packs/manifest.json` by default, or from the
   `PELLIKAN_PACKS_URL` environment variable (at build time or run time; plain `http` is accepted only for localhost).
   The repository is public and the `packs` release holds the manifest and the three packs, so the default URL works.
   After rebuilding packs, upload the manifest and the packs together (see CONTRIBUTING.md).
4. The app downloads a pack only from the manifest's host, never from ebible.org. It checks the SHA-256, unpacks to a
   temporary file, validates it (integrity check, exactly one translation, the right id), and renames it into
   `<app data>/translations/<ID>.db`. A failed install leaves nothing behind. Removing a translation deletes its file.

Reader and search queries for a downloaded translation run on that translation's own database. Queries that join the
original-language words, lexicons or cross-references (word occurrences, cross-reference text) use the WEB's text when a
downloaded translation is selected, because those tables live in `bible.db`.

## The ESV (optional, local only)

The ESV is not open data. The permissions notice inside the epub (its Copyright page) allows quoting up to 1,000
verses without written permission, only if the quotation is not a complete book of the Bible and is less than 50% of
the work quoting it. It also says "ESV" and "English Standard Version" are Crossway trademarks that need permission
to use. Pellikan's ESV text is the whole Bible, so a build that contains it is outside those terms unless Crossway
has given a separate license for it. A DRM-free file means the file is not locked, not that the text is licensed for
redistribution.

How the repo handles that:

- Release builds must not contain it: run `npm run data:build:release`, which passes `--no-esv`. The installer bundles
  `data/build/bible.db`, so a plain `npm run data:build` with the epub present would ship the ESV.
- The epub is never committed or downloaded. Put your own copy at `data/sources/esv/esv_classic_reference_bible_4.epub`
  (git-ignored), then `npm run data:build`. Without the file the build skips the ESV and everything else works.
- `data/build/bible.db` is git-ignored too, so the ESV text does not enter the repo. A Tauri bundle built while the
  epub is present does contain the full text. Do not publish or share that bundle without Crossway's permission.
- The Credits page and the reader footer print the notice that Crossway's permissions page requires, taken from the
  `sources` row for `ESV` in `data/scripts/build-db.mjs`. Keep "Used by permission" only if you actually have it.
- Cross-references become one `xref` note per target verse (the epub's own verse ids, not parsed from the
  abbreviated text). They are not marked in the verse text; they appear in the Cross References tab. Footnotes get a
  marker as usual.

## The ShareAlike question

MorphGNT's tagging is CC BY-SA 3.0. The built `bible.db` contains that tagging, so distributing the database means
distributing ShareAlike material, and the database (or at least that layer) should go out under CC BY-SA 3.0 or a
compatible license, with attribution. The application code is separate and can carry whatever license you choose, as
long as the data stays clearly separated and labelled. Whether combining the layers in one file makes the whole file
a single adaptation is a legal gray area. If it matters for your plans, ask a lawyer, or build a variant database
without the Greek tagging.

SWORD modules and the `libsword` library are GPL. Pellikan does not link or ship either, so the GPL does not
apply here. If you ever add SWORD module import, keep that code behind a clear boundary and re-check the license.

## Known data issues (measured, not guessed)

**0. The WEB puts the end of Romans in a different place.** The WEB follows the Majority Text and places the doxology at
Romans 14:24-26, so Romans 14 ends on verse 26 (KJV 23) and Romans 16 on verse 25 (KJV 27). The build prints this.
Cross-references and commentary into those verses line up with the KJV and BSB, not the WEB.

**0a. Thayer's is OCR-derived.** 191 ids appear twice because the dataset splits long entries over two records; the second
is merged into the first. 5,255 of 5,916 entries are linked to a Strong's number (3,573 by the dataset's own tagging, the
rest by matching the headword to exactly one Strong's lemma). The rest are findable only by headword. Spot-check before
quoting it.

**0b. TSK parsing is heuristic.** The TSK writes "Joh 1:1-3; 15" and expects the reader to know 15 means John 1:15. The
parser follows the usual convention (a bare number is a verse of the last chapter named) and a book plus a bare number
is a whole chapter. 46 of about 382,000 items were skipped as unparseable or out of range. The rest are not verified
one by one.

**0c. Greek words get Strong's numbers by lemma matching.** MorphGNT has no Strong's numbers. A word is tagged when its
accent-folded lemma matches exactly one Strong's Greek entry: 94% of the 137,554 words. Words whose lemma is ambiguous
once accents are removed stay untagged rather than guessed.

**1. The WEB's Strong's numbers on English words are not trustworthy in the Old Testament.** The tags in the
eBible USFM are not aligned to the word they sit on. Measured against OSHB: "God" (Elohim, H430) is tagged H3068
(YHWH) 1,252 times and H430 is not even in the top five. 95% of tags name a number that exists *somewhere* in the same
Hebrew verse, which is why it looks fine at a glance. The New Testament tags look much better (G2316 for "God" in 97%
of uses). For this reason the UI does not make English words clickable. Word study goes through the verse's Hebrew
and Greek words (OSHB and MorphGNT), which are reliable. The tags stay in `verses.tokens` for a future validated
alignment.

**2. Hebrew verse numbering differs from English.** About 2,000 verses (Psalm titles, Joel 2/3, Malachi 3/4, and
others). OSHB's `VerseMap.xml` is applied, so `words.eng_chapter` and `words.eng_verse` use English numbering. Always
query by those columns. Psalm titles that English Bibles leave unnumbered get `eng_verse = 0`.
Seven verses are only partly renumbered upstream (`type="partial"`). OSHB gives no word-level split point, so
they are left where the Hebrew puts them and recorded in `versification_map` with `partial = 1`. This is the
reason Ps 13:5 and Isa 64:1 have no Hebrew words.

**3. The Greek NT differs from English numbering in five places.** Fixed by an explicit table in
`data/scripts/loaders/morphgnt.mjs` (`NT_RENUMBER`): Acts 19:40/41, 2 Cor 13:12-14, 3 John 14/15, Rev 12:18/13:1.
`check-db.mjs` fails if a new mismatch appears.

**4. Passages the SBLGNT leaves out of the main text have no Greek words.** These are John 7:53 to 8:11, the
Romans 16 doxology (the WEB prints it at Rom 14:24-26), and verses found only in later manuscripts, such as Matt 17:21,
Matt 18:11 and Acts 8:37. The WEB includes them, so they show English text and a note in the study panel. This is a
textual choice, not a bug. `check-db.mjs` prints the full list (34 verses today).

**5. Neh 7:68** exists in the WEB but not in the Hebrew text.

**6. Hebrew `lemma` text is empty.** OSHB provides Strong's-style lemma numbers, not lemma spellings. Hebrew words
carry `lemma_key` (such as `H1254a`) and `strongs`. Lemma text and glosses need a lexicon loader (Open Scriptures
has one; check its license first). Greek has lemma text but no Strong's numbers, for the same reason in reverse.

**7. Source tracking.** `fetch.mjs` follows each project's default branch, so a re-fetch can pull newer data.
Pin to commit SHAs in `fetch.mjs` if you need byte-for-byte reproducible builds.
