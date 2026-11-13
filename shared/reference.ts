// Scripture reference parsing: "Rom 8:28", "1 Cor 13", "Jn 3:16-18", "Song of Solomon 2:1".
//
// parseReference reads one reference that someone typed (the jump bar). Finding references inside running text is a
// different problem with different risks; that is scanReferences in reference-scan.ts, which shares the book names here.

import { BOOKS } from './books.ts'
import type { BookMeta } from './books.ts'

export interface ParsedReference {
  book: BookMeta
  chapter?: number
  verse?: number
  verseEnd?: number
}

// Extra abbreviations beyond the OSIS id, USFM id and full name (which are added automatically).
// An abbreviation must identify exactly one book. Ambiguous ones ("ph", "ju", "jo") are left out on purpose.
// Also read by reference-scan.ts, which is stricter about which of these it trusts inside running prose.
export const EXTRA: Record<string, string[]> = {
  Gen: ['gn', 'ge'],
  Exod: ['ex', 'exo'],
  Lev: ['lv'],
  Num: ['nm', 'nu'],
  Deut: ['dt', 'de'],
  Josh: ['jos'],
  Judg: ['jdg', 'jg'],
  Ruth: ['ru'],
  '1Sam': ['1sa', '1sm'],
  '2Sam': ['2sa', '2sm'],
  '1Kgs': ['1ki', '1kg', '1kings'],
  '2Kgs': ['2ki', '2kg', '2kings'],
  '1Chr': ['1ch', '1chron'],
  '2Chr': ['2ch', '2chron'],
  Ezra: ['ezr'],
  Neh: ['ne'],
  Esth: ['es', 'est'],
  Job: ['jb'],
  Ps: ['psa', 'psalm', 'pss', 'psm'],
  Prov: ['pr', 'prv', 'pro'],
  Eccl: ['ec', 'ecc', 'eccles', 'qoh'],
  Song: ['sng', 'sos', 'songofsongs', 'canticles', 'cant'],
  Isa: ['is'],
  Jer: ['je', 'jr'],
  Lam: ['la'],
  Ezek: ['eze', 'ezk'],
  Dan: ['da', 'dn'],
  Hos: ['ho'],
  Joel: ['jl'],
  Amos: ['am'],
  Obad: ['ob', 'oba'],
  Jonah: ['jon', 'jnh'],
  Mic: ['mc'],
  Nah: ['na', 'nam'],
  Hab: ['hb'],
  Zeph: ['zep', 'zp'],
  Hag: ['hg'],
  Zech: ['zec', 'zc'],
  Mal: ['ml'],
  Matt: ['mt', 'mat'],
  Mark: ['mk', 'mr', 'mrk'],
  Luke: ['lk', 'luk', 'lu'],
  John: ['jn', 'jhn', 'joh', 'jno'],
  Acts: ['ac', 'act'],
  Rom: ['ro', 'rm'],
  '1Cor': ['1co'],
  '2Cor': ['2co'],
  Gal: ['ga'],
  Eph: ['ep', 'ephes'],
  Phil: ['php', 'pp'],
  Col: [],
  '1Thess': ['1th', '1thes'],
  '2Thess': ['2th', '2thes'],
  '1Tim': ['1ti'],
  '2Tim': ['2ti'],
  Titus: ['tit'],
  Phlm: ['phm', 'philem'],
  Heb: ['he'],
  Jas: ['jm', 'jam'],
  '1Pet': ['1pe', '1pt'],
  '2Pet': ['2pe', '2pt'],
  '1John': ['1jn', '1jo', '1joh'],
  '2John': ['2jn', '2jo', '2joh'],
  '3John': ['3jn', '3jo', '3joh'],
  Jude: ['jud', 'jd'],
  Rev: ['re', 'rv', 'revelations', 'apocalypse'],
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

let aliasMap: Map<string, BookMeta> | null = null

function aliases(): Map<string, BookMeta> {
  if (aliasMap) return aliasMap
  const map = new Map<string, BookMeta>()
  const add = (key: string, book: BookMeta) => {
    const k = squash(key)
    if (k && !map.has(k)) map.set(k, book)
  }
  for (const b of BOOKS) {
    add(b.osis, b)
    add(b.usfm, b)
    add(b.name, b)
    add(b.name.replace(/^(\d) /, '$1'), b)
    for (const x of EXTRA[b.osis] ?? []) add(x, b)
  }
  aliasMap = map
  return map
}

const ORDINALS: Array<[RegExp, string]> = [
  [/^(?:first|1st)\s+(?=[a-z])/i, '1'],
  [/^(?:second|2nd)\s+(?=[a-z])/i, '2'],
  [/^(?:third|3rd)\s+(?=[a-z])/i, '3'],
]

function normalizeBookWord(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ')
  // Roman numerals: check longest first so "iii" is not read as "i".
  if (/^iii\s+[a-z]/i.test(s)) s = s.replace(/^iii\s+/i, '3 ')
  else if (/^ii\s+[a-z]/i.test(s)) s = s.replace(/^ii\s+/i, '2 ')
  else if (/^i\s+[a-z]/i.test(s)) s = s.replace(/^i\s+/i, '1 ')
  else {
    for (const [re, n] of ORDINALS) {
      if (re.test(s)) {
        s = s.replace(re, n + ' ')
        break
      }
    }
  }
  return squash(s)
}

const REF_RE = /^\s*((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[a-z][a-z .']*?)\s*(?:(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?)?)?\s*$/i

/** Parses one reference. Returns null if the book is not recognized. */
export function parseReference(input: string): ParsedReference | null {
  const m = REF_RE.exec(input)
  if (!m) return null
  const book = aliases().get(normalizeBookWord(m[1]!))
  if (!book) return null
  const chapter = m[2] ? Number(m[2]) : undefined
  const verse = m[3] ? Number(m[3]) : undefined
  const verseEnd = m[4] ? Number(m[4]) : undefined
  // Reject nonsense ranges rather than guessing.
  if (verse !== undefined && verseEnd !== undefined && verseEnd < verse) return null
  if (chapter === 0 || verse === 0) return null
  return { book, chapter, verse, verseEnd }
}
