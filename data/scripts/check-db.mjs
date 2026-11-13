#!/usr/bin/env node
// Sanity checks on a built data/build/bible.db. Exits non-zero if anything is off.
//
//   npm run data:check

import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { toFtsQuery } from '../../shared/text.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const db = new DatabaseSync(ROOT + 'build/bible.db', { readOnly: true })

let failed = 0
function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
}
const one = (sql, ...p) => db.prepare(sql).get(...p)
const count = (sql, ...p) => Object.values(one(sql, ...p))[0]

check('integrity_check', one('PRAGMA integrity_check').integrity_check === 'ok')
check('foreign_key_check is empty', db.prepare('PRAGMA foreign_key_check').all().length === 0)
check('schema version', one('PRAGMA user_version').user_version === 2)

// Known totals for these exact editions.
check('66 books', count('SELECT count(*) FROM books') === 66)
check('every book has chapters', count('SELECT count(*) FROM books WHERE chapters < 1') === 0)
check('WEB has 31,103 verses', count("SELECT count(*) FROM verses WHERE translation_id='WEB'") === 31103)
check('KJV has 31,102 verses (the reference versification)', count("SELECT count(*) FROM verses WHERE translation_id='KJV'") === 31102)
check('BSB has more than 31,000 verses', count("SELECT count(*) FROM verses WHERE translation_id='BSB'") > 31000)
check('ASV, YLT and Darby are NOT bundled (downloaded on demand)', count("SELECT count(*) FROM verses WHERE translation_id IN ('ASV','YLT','DARBY')") === 0)
// Every translation keeps the canonical (KJV) chapter structure: same chapters, never a verse the KJV does not have.
const strayVerses = count(`SELECT count(*) FROM verses v JOIN (SELECT book_id, chapter, max(verse) AS n FROM verses WHERE translation_id='KJV' GROUP BY 1, 2) k
  ON k.book_id = v.book_id AND k.chapter = v.chapter WHERE v.translation_id IN ('BSB') AND v.verse > k.n`)
check('BSB has no verse beyond the KJV chapter ends', strayVerses === 0, strayVerses ? `${strayVerses} verses` : '')
check('Greek NT is 137,554 words', count("SELECT count(*) FROM words WHERE lang='grc'") === 137554)
check('Hebrew/Aramaic words > 300,000', count("SELECT count(*) FROM words WHERE lang IN ('heb','arc')") > 300000)
check('OT has 929 chapters, NT 260', count("SELECT sum(chapters) FROM books WHERE testament='OT'") === 929 && count("SELECT sum(chapters) FROM books WHERE testament='NT'") === 260)

// Lexicons, dictionaries, commentary, cross-references.
check("Strong's Hebrew has 8,000+ entries", count("SELECT count(*) FROM lexicon_entries WHERE source_id='STRONGS_H'") > 8000)
check("Strong's Greek has 5,000+ entries", count("SELECT count(*) FROM lexicon_entries WHERE source_id='STRONGS_G'") > 5000)
check('BDB is linked to Strong\'s numbers', count("SELECT count(DISTINCT entry_pk) FROM lexicon_links l JOIN lexicon_entries e ON e.id = l.entry_pk WHERE e.source_id='BDB'") > 7000)
check("H1254 (bara, create) has Strong's and BDB", count("SELECT count(DISTINCT e.source_id) FROM lexicon_links l JOIN lexicon_entries e ON e.id = l.entry_pk WHERE l.strongs='H1254'") >= 2)
check("G3056 (logos) has Strong's and Thayer's", count("SELECT count(DISTINCT e.source_id) FROM lexicon_links l JOIN lexicon_entries e ON e.id = l.entry_pk WHERE l.strongs='G3056'") >= 2)
const greekTagged = count("SELECT count(*) FROM words WHERE lang='grc' AND strongs IS NOT NULL")
check('90%+ of Greek words carry a Strong\'s number', greekTagged / 137554 > 0.9, `${(greekTagged / 1375.54).toFixed(1)}%`)
check('lexicon links point at real entries', count('SELECT count(*) FROM lexicon_links l LEFT JOIN lexicon_entries e ON e.id = l.entry_pk WHERE e.id IS NULL') === 0)
check("Easton's has ~3,900 entries and Smith's ~4,600", count("SELECT count(*) FROM dictionary_entries WHERE source_id='EASTON'") > 3800 && count("SELECT count(*) FROM dictionary_entries WHERE source_id='SMITH'") > 4500)
check('no replacement characters in dictionaries or commentary', count("SELECT (SELECT count(*) FROM dictionary_entries WHERE instr(body, char(65533)) > 0) + (SELECT count(*) FROM commentary_entries WHERE instr(body, char(65533)) > 0)") === 0)
check('dictionary FTS finds "Nicodemus"', count("SELECT count(*) FROM dictionary_fts WHERE dictionary_fts MATCH '\"Nicodemus\"'") > 0)
check('Matthew Henry covers John 3:16', count("SELECT count(*) FROM commentary_entries WHERE source_id='MHC' AND book_id=43 AND chapter=3 AND verse_start<=16 AND verse_end>=16") === 1)
check('Matthew Henry has no leftover markup', count("SELECT count(*) FROM commentary_entries WHERE body LIKE '%<div%' OR body LIKE '%<hi %' OR body LIKE '%osisRef%'") === 0)
check('TSK has 300,000+ references', count("SELECT count(*) FROM cross_references WHERE source_id='TSK'") > 300000)
check('OpenBible has 300,000+ references', count("SELECT count(*) FROM cross_references WHERE source_id='OPENBIBLE'") > 300000)
check('John 3:16 -> Romans 5:8 in OpenBible', count("SELECT count(*) FROM cross_references WHERE source_id='OPENBIBLE' AND book_id=43 AND chapter=3 AND verse=16 AND to_book_id=45 AND to_chapter=5 AND to_verse=8") === 1)
check('John 3:16 -> 1 John 4:9 in the TSK', count("SELECT count(*) FROM cross_references WHERE source_id='TSK' AND book_id=43 AND chapter=3 AND verse=16 AND to_book_id=62 AND to_chapter=4 AND to_verse=9") >= 1)
check('every cross-reference target exists in the KJV', count(`SELECT count(*) FROM cross_references x WHERE NOT EXISTS (
  SELECT 1 FROM verses v WHERE v.translation_id='KJV' AND v.book_id=x.to_book_id AND v.chapter=x.to_chapter AND v.verse=x.to_verse)`) === 0)
check('every source row has a license and attribution', count("SELECT count(*) FROM sources WHERE license = '' OR attribution = ''") === 0)

// Every verse token list must reproduce the plain text.
let badTokens = 0
for (const v of db.prepare('SELECT text, tokens FROM verses').iterate()) {
  if (JSON.parse(v.tokens).map((t) => t[0]).join('') !== v.text) badTokens++
}
check('verse tokens join back to text', badTokens === 0, badTokens ? `${badTokens} mismatches` : '')

// Each original-language verse (English numbering) should exist in the English text, except psalm titles (verse 0).
const orphans = count(`
  SELECT count(*) FROM (
    SELECT DISTINCT w.book_id, w.eng_chapter, w.eng_verse FROM words w
    WHERE w.eng_verse > 0 AND NOT EXISTS (
      SELECT 1 FROM verses v WHERE v.translation_id = 'WEB' AND v.book_id = w.book_id AND v.chapter = w.eng_chapter AND v.verse = w.eng_verse)
  )`)
check('every original-language verse exists in WEB', orphans === 0, orphans ? `${orphans} unmatched (listing below)` : '')
if (orphans) {
  for (const r of db.prepare(`
    SELECT DISTINCT b.osis, w.eng_chapter c, w.eng_verse v FROM words w JOIN books b ON b.id = w.book_id
    WHERE w.eng_verse > 0 AND NOT EXISTS (SELECT 1 FROM verses x WHERE x.translation_id = 'WEB' AND x.book_id = w.book_id AND x.chapter = w.eng_chapter AND x.verse = w.eng_verse)
    ORDER BY w.book_id, c, v LIMIT 15`).all()) console.log(`       ${r.osis} ${r.c}:${r.v}`)
}
// ...and the reverse, ignoring verses WEB has that the source text lacks (textual-critical omissions are expected in Greek).
const noOriginal = db.prepare(`
  SELECT b.osis, v.chapter c, v.verse n FROM verses v JOIN books b ON b.id = v.book_id
  WHERE v.translation_id = 'WEB' AND NOT EXISTS (SELECT 1 FROM words w WHERE w.book_id = v.book_id AND w.eng_chapter = v.chapter AND w.eng_verse = v.verse)
  ORDER BY v.book_id, c, n`).all()
console.log(`info ${noOriginal.length} WEB verses have no original-language words (expected for NT verses SBLGNT omits, and the 7 partial-mapping verses)`)
if (noOriginal.length <= 40) console.log('       ' + noOriginal.map((r) => `${r.osis} ${r.c}:${r.n}`).join(', '))

// Stronger than "exists": every OT chapter must END on the same verse number in the Hebrew and in the WEB.
// (Catches a shifted map that an existence check cannot, e.g. a verse silently aligned to its neighbor.)
const shifted = db.prepare(`
  SELECT b.osis, c.ch, (SELECT max(verse) FROM verses v WHERE v.translation_id = 'WEB' AND v.book_id = b.id AND v.chapter = c.ch) AS web,
         (SELECT max(eng_verse) FROM words w WHERE w.book_id = b.id AND w.eng_chapter = c.ch AND w.lang IN ('heb','arc')) AS heb
  FROM books b JOIN (SELECT DISTINCT book_id, eng_chapter AS ch FROM words WHERE lang IN ('heb','arc')) c ON c.book_id = b.id
  WHERE web IS NOT heb`).all()
check('OT chapters end on the same verse in Hebrew and WEB', shifted.length === 0, shifted.map((r) => `${r.osis} ${r.ch} (web ${r.web}, heb ${r.heb})`).join(', '))

// Spot checks that would expose a mis-aligned book or a bad versification map.
const ps3 = count("SELECT count(*) FROM words WHERE book_id=19 AND eng_chapter=3 AND eng_verse=0")
check('Psalm 3 title is 6 words', ps3 === 6, `got ${ps3}`)
check('Joel 2:28-32 has Hebrew words', count('SELECT count(DISTINCT eng_verse) FROM words WHERE book_id=29 AND eng_chapter=2 AND eng_verse BETWEEN 28 AND 32') === 5)
check('Gen 1:1 first Hebrew word is H7225', one("SELECT strongs FROM words WHERE book_id=1 AND eng_chapter=1 AND eng_verse=1 ORDER BY seq LIMIT 1").strongs === 'H7225')
check('John 1:1 first Greek word', one("SELECT text FROM words WHERE book_id=43 AND eng_chapter=1 AND eng_verse=1 ORDER BY seq LIMIT 1").text === 'Ἐν')
check('2 Cor 13:14 is the grace benediction', /χάρις/.test(one("SELECT group_concat(text,' ') t FROM words WHERE book_id=47 AND eng_chapter=13 AND eng_verse=14").t ?? ''))
check('Rev 13:1 starts with the sand-of-the-sea clause', one("SELECT text FROM words WHERE book_id=66 AND eng_chapter=13 AND eng_verse=1 ORDER BY seq LIMIT 1").text === 'καὶ')
check('lemma λόγος counted', count("SELECT occurrences FROM lemmas WHERE lemma_key='λόγος'") > 300)
check('no qere duplicates counted in lemmas', count("SELECT sum(occurrences) FROM lemmas WHERE lang IN ('heb','arc')") === count("SELECT count(*) FROM words WHERE lang IN ('heb','arc') AND variant IS NOT 'qere'"))

// Search works, and is stemmed.
const q = toFtsQuery('loved world', { prefix: false })
const hits = count("SELECT count(*) FROM verses_fts WHERE verses_fts MATCH ?", q)
check('FTS finds "loved world"', hits > 0, `${hits} hits`)
const jn316 = one("SELECT v.chapter, v.verse FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid WHERE verses_fts MATCH ? AND v.book_id = 43 ORDER BY rank LIMIT 1", toFtsQuery('God so loved the world', { prefix: false }))
check('FTS ranks John 3:16 first for its own wording', jn316?.chapter === 3 && jn316?.verse === 16, jn316 ? `${jn316.chapter}:${jn316.verse}` : 'none')

// Every shared query file must at least prepare against this schema, and user.sql must apply to an empty DB.
const qdir = ROOT + 'queries/'
for (const f of (await readdir(qdir)).filter((n) => n.endsWith('.sql'))) {
  try {
    db.prepare(await readFile(qdir + f, 'utf8'))
    check(`query ${f} prepares`, true)
  } catch (err) {
    check(`query ${f} prepares`, false, err.message)
  }
}
// The Rust side only runs queries listed in src-tauri/src/db.rs. A query file missing from that list works in
// `nuxt dev` and then fails inside the desktop app, so compare the two lists.
{
  const rs = await readFile(ROOT + '../src-tauri/src/db.rs', 'utf8')
  const registered = [...rs.matchAll(/^\s*q!\("([a-z_]+)"\),/gm)].map((m) => m[1]).sort()
  const files = (await readdir(qdir)).filter((n) => n.endsWith('.sql')).map((n) => n.slice(0, -4)).sort()
  const missing = files.filter((f) => !registered.includes(f))
  const stale = registered.filter((r) => !files.includes(r))
  check('every query file is registered in src-tauri/src/db.rs', !missing.length && !stale.length,
    [missing.length && `unregistered: ${missing}`, stale.length && `no file: ${stale}`].filter(Boolean).join('; '))
}
let u = null
try {
  u = new DatabaseSync(':memory:')
  u.exec('PRAGMA foreign_keys = ON')
  const sql = await readFile(ROOT + 'schema/user.sql', 'utf8')
  u.exec(sql)
  u.exec(sql) // must be idempotent: the app runs it on every launch
  check('user.sql applies twice cleanly', true)
} catch (err) {
  u = null
  check('user.sql applies twice cleanly', false, err.message)
}
// The user-database statements (notes, highlights, settings) get the same two checks against user.sql.
if (u) {
  const udir = qdir + 'user/'
  const files = (await readdir(udir)).filter((n) => n.endsWith('.sql'))
  for (const f of files) {
    try {
      u.prepare(await readFile(udir + f, 'utf8'))
      check(`user query ${f} prepares`, true)
    } catch (err) {
      check(`user query ${f} prepares`, false, err.message)
    }
  }
  const rs = await readFile(ROOT + '../src-tauri/src/db.rs', 'utf8')
  const registered = [...rs.matchAll(/^\s*uq!\("([a-z_]+)"\),/gm)].map((m) => m[1]).sort()
  const names = files.map((n) => n.slice(0, -4)).sort()
  const missing = names.filter((f) => !registered.includes(f))
  const stale = registered.filter((r) => !names.includes(r))
  check('every user query file is registered in src-tauri/src/db.rs', !missing.length && !stale.length,
    [missing.length && `unregistered: ${missing}`, stale.length && `no file: ${stale}`].filter(Boolean).join('; '))
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
