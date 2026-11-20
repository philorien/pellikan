// Lexicons: Strong's Hebrew and Greek, Brown-Driver-Briggs, Thayer's. Every entry is linked to Strong's numbers
// (lexicon_links) so the word-study panel can show all of them for one word.
//
//   STRONGS_H  Strong's Hebrew, from the Open Scriptures Hebrew Lexicon (HebrewStrong.xml). Text public domain, markup CC BY 4.0.
//   BDB        Brown-Driver-Briggs, same project. Linked to Strong's through LexicalIndex.xml.
//   STRONGS_G  Strong's Greek, Open Scriptures JSON of Ulrik Petersen's XML. CC BY-SA.
//   THAYER     Thayer's Greek-English Lexicon (1889), an OCR-derived dataset. Public domain text, accuracy unverified.

import { readFile } from 'node:fs/promises'
import { markupToText, decodeEntities } from './markup.mjs'
import { normalizeGreek } from '../../../shared/text.ts'

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2])]))
const strongNumber = (raw) => (/^\d+/.exec(raw) ? 'H' + /^\d+/.exec(raw)[0] : null)

/** Strong's Hebrew: <entry id="H1"><w pos pron xlit xml:lang>..</w><source>..</source><meaning>..</meaning><usage>..</usage></entry> */
export function parseStrongsHebrew(xml) {
  const out = []
  for (const m of xml.matchAll(/<entry id="(H\d+)">([\s\S]*?)<\/entry>/g)) {
    const [, id, inner] = m
    const w = /<w ([^>]*)>([^<]*)<\/w>/.exec(inner)
    if (!w) continue
    const a = attrs(w[1])
    const meaning = /<meaning>([\s\S]*?)<\/meaning>/.exec(inner)?.[1]
    const def = meaning ? /<def>([\s\S]*?)<\/def>/.exec(meaning)?.[1] : null
    const meaningText = meaning ? markupToText(meaning) : ''
    const derivation = markupToText(/<source>([\s\S]*?)<\/source>/.exec(inner)?.[1] ?? '')
    const usage = markupToText(/<usage>([\s\S]*?)<\/usage>/.exec(inner)?.[1] ?? '')
    out.push({
      entry_id: id,
      lang: a['xml:lang'] === 'arc' ? 'arc' : 'heb',
      headword: decodeEntities(w[2]),
      translit: a.xlit ?? null,
      pron: a.pron ?? null,
      pos: a.pos ?? null,
      gloss: def ? markupToText(def) : meaningText.split(/[,;]/)[0] || null,
      body: meaningText || usage || derivation || decodeEntities(w[2]),
      derivation: derivation || null,
      usage: usage || null,
    })
  }
  return out
}

/** Strong's Greek: a JS file assigning one big JSON object. */
export function parseStrongsGreek(js) {
  const start = js.indexOf('{"G')
  const end = js.lastIndexOf('};')
  if (start < 0 || end < 0) throw new Error("Strong's Greek: object not found")
  const dict = JSON.parse(js.slice(start, end + 1))
  return Object.entries(dict)
    .filter(([, e]) => e.lemma)
    .map(([id, e]) => {
      const def = (e.strongs_def ?? '').trim()
      return {
        entry_id: id,
        lang: 'grc',
        headword: e.lemma,
        translit: e.translit ?? null,
        pron: null,
        pos: null,
        gloss: (e.kjv_def ?? '').trim() || def.split(/[,;]/)[0] || null,
        body: def || e.kjv_def || e.lemma,
        derivation: (e.derivation ?? '').trim() || null,
        usage: (e.kjv_def ?? '').trim() || null,
      }
    })
    .sort((a, b) => parseInt(a.entry_id.slice(1)) - parseInt(b.entry_id.slice(1)))
}

/** LexicalIndex.xml: bdb id -> { strongs: ['H6'], gloss, translit }. */
export function parseLexicalIndex(xml) {
  const map = new Map()
  for (const m of xml.matchAll(/<entry id="[^"]+">([\s\S]*?)<\/entry>/g)) {
    const inner = m[1]
    const gloss = /<def>([\s\S]*?)<\/def>/.exec(inner)?.[1]
    const translit = /<w xlit="([^"]*)"/.exec(inner)?.[1]
    for (const x of inner.matchAll(/<xref ([^>]*)\/>/g)) {
      const a = attrs(x[1])
      if (!a.bdb) continue
      const rec = map.get(a.bdb) ?? { strongs: new Set(), gloss: null, translit: null }
      const n = a.strong ? strongNumber(a.strong) : null
      if (n) rec.strongs.add(n)
      rec.gloss ??= gloss ? markupToText(gloss) : null
      rec.translit ??= translit ? decodeEntities(translit) : null
      map.set(a.bdb, rec)
    }
  }
  return map
}

/** BDB: nested <entry id="a.ab.ac"> with <sense n="1">, <def>, <ref r="Job.8.12">. Rendered as numbered plain text. */
export function parseBdb(xml, index) {
  const out = []
  for (const m of xml.matchAll(/<entry id="([^"]+)"([^>]*)>([\s\S]*?)<\/entry>/g)) {
    const [, id, , inner] = m
    const cleaned = inner
      .replace(/<status\b[^>]*>[\s\S]*?<\/status>/g, '')
      .replace(/<sense\b([^>]*)>/g, (_, a) => `\n${attrs(a).n ? attrs(a).n + '. ' : ''}`)
      .replace(/<\/sense>/g, '')
    const body = markupToText(cleaned)
    const headword = markupToText(/<w\b[^>]*>([\s\S]*?)<\/w>/.exec(inner)?.[1] ?? '').replace(/[[\]]/g, '').trim()
    if (!headword || body.length <= headword.length + 1) continue
    const li = index.get(id)
    out.push({
      entry_id: id,
      lang: 'heb',
      headword,
      translit: li?.translit ?? null,
      pron: null,
      pos: markupToText(/<pos>([\s\S]*?)<\/pos>/.exec(inner)?.[1] ?? '') || null,
      gloss: li?.gloss ?? null,
      body,
      derivation: null,
      usage: null,
      strongs: li ? [...li.strongs] : [],
    })
  }
  return out
}

/** Thayer's JSONL. `strongs` is a string in schema v2 and an array in the README; accept both. */
export function parseThayer(jsonl) {
  // 191 ids appear twice: the dataset splits a long entry over two records and the second starts mid-entry (its "lemma"
  // is a fragment of text). Those are merged into the first record rather than treated as separate entries.
  const out = []
  const byId = new Map()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    const e = JSON.parse(line)
    const strongs = [].concat(e.strongs ?? []).filter((s) => /^G\d+$/.test(s))
    const body = (Array.isArray(e.paragraphs) && e.paragraphs.length ? e.paragraphs.join('\n') : e.text ?? '').trim()
    if (!body || !e.lemma) continue
    const earlier = byId.get(String(e.id))
    if (earlier) {
      earlier.body += '\n' + body
      for (const g of strongs) if (!earlier.strongs.includes(g)) earlier.strongs.push(g)
      continue
    }
    const entry = {
      entry_id: String(e.id),
      lang: 'grc',
      headword: e.lemma,
      translit: e.transliteration ?? null,
      pron: null,
      pos: (e.grammar ?? '').trim() || null,
      gloss: null,
      body,
      derivation: null,
      usage: null,
      strongs,
    }
    byId.set(entry.entry_id, entry)
    out.push(entry)
  }
  return out
}

function insertEntries(db, sourceId, entries, selfLink) {
  const ins = db.prepare(
    'INSERT INTO lexicon_entries (source_id, entry_id, lang, headword, translit, pron, pos, gloss, body, derivation, usage) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  const link = db.prepare('INSERT OR IGNORE INTO lexicon_links (strongs, entry_pk) VALUES (?,?)')
  db.exec('BEGIN')
  try {
    for (const e of entries) {
      const { lastInsertRowid: pk } = ins.run(sourceId, e.entry_id, e.lang, e.headword, e.translit, e.pron, e.pos, e.gloss, e.body, e.derivation, e.usage)
      if (selfLink) link.run(e.entry_id, pk)
      for (const s of e.strongs ?? []) link.run(s, pk)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export async function loadLexicons(db, { hebrewDir, greekJs, thayerJsonl, ids, log = () => {} }) {
  const hs = parseStrongsHebrew(await readFile(hebrewDir + 'HebrewStrong.xml', 'utf8'))
  insertEntries(db, ids.strongsH, hs, true)
  log(`${ids.strongsH}: ${hs.length} entries`)

  const index = parseLexicalIndex(await readFile(hebrewDir + 'LexicalIndex.xml', 'utf8'))
  const bdb = parseBdb(await readFile(hebrewDir + 'BrownDriverBriggs.xml', 'utf8'), index)
  insertEntries(db, ids.bdb, bdb, false)
  log(`${ids.bdb}: ${bdb.length} entries, ${bdb.filter((e) => e.strongs.length).length} linked to a Strong's number`)

  const gs = parseStrongsGreek(await readFile(greekJs, 'utf8'))
  insertEntries(db, ids.strongsG, gs, true)
  log(`${ids.strongsG}: ${gs.length} entries`)

  const th = parseThayer(await readFile(thayerJsonl, 'utf8'))

  // Thayer's entries with no Strong's tag: link by headword when it matches exactly one Strong's Greek lemma.
  const byLemma = new Map()
  for (const e of gs) {
    const k = normalizeGreek(e.headword)
    byLemma.set(k, byLemma.has(k) ? null : e.entry_id)
  }
  // Thayer's headwords look like "ἀγαθο-ποιέω" or "Α, α, ἄλφα": drop syllable hyphens and keep the first form.
  const thayerKey = (h) => normalizeGreek(h.split(',')[0].replace(/[-\u2010-\u2015\u00b7\s]/g, ''))
  let viaLemma = 0
  for (const e of th) {
    if (e.strongs.length) continue
    const hit = byLemma.get(thayerKey(e.headword))
    if (hit) { e.strongs = [hit]; viaLemma++ }
  }
  insertEntries(db, ids.thayer, th, false)
  log(`${ids.thayer}: ${th.length} entries, ${th.filter((e) => e.strongs.length).length} linked (${viaLemma} by matching headword)`)

  // Give every Greek word in the NT a Strong's number when its lemma matches exactly one Strong's entry.
  const upd = db.prepare("UPDATE words SET strongs = ? WHERE lang = 'grc' AND lemma_key = ?")
  const lemmas = db.prepare("SELECT DISTINCT lemma_key, lemma FROM words WHERE lang = 'grc'").all()
  let matched = 0
  db.exec('BEGIN')
  for (const l of lemmas) {
    const hit = byLemma.get(normalizeGreek(l.lemma ?? ''))
    if (hit) { upd.run(hit, l.lemma_key); matched++ }
  }
  db.exec('COMMIT')
  const cov = db.prepare("SELECT sum(strongs IS NOT NULL) AS tagged, count(*) AS total FROM words WHERE lang = 'grc'").get()
  log(`Greek words with a Strong's number: ${cov.tagged}/${cov.total} (${matched}/${lemmas.length} lemmas matched exactly one entry)`)
  return { hebrew: hs.length, bdb: bdb.length, greek: gs.length, thayer: th.length, greekWordCoverage: cov }
}
