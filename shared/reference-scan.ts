// Finds Scripture references inside running prose: "as Paul says (Rom. 8:28; 1 Cor 13:4, 7), and in Psalm 23".
//
// This is what links an imported book to the passages it cites. It is a different job from parseReference
// (reference.ts), which reads one reference that somebody typed on purpose. Here most of the text is not a reference,
// and book names are ordinary words: Job, Mark, Acts, Numbers, Is, Am. So the rule throughout is precision over
// recall. A reference that is missed costs nothing; a link on "Mark my words" makes the whole feature look broken.
//
// What makes a match:
//   - A book name with a capital first letter, then a chapter. Lowercase "john 3:16" is not treated as a citation.
//   - The chapter and verse must exist (versification.ts, KJV numbering). "Luke 30:1" and "Rom 8:40" are dropped.
//   - Full names and standard abbreviations (Romans, Rom, Ps) may cite a chapter alone: "Romans 8". That is the
//     weakest form, so it is marked medium confidence, and it is dropped when a quantity follows: "Mark 5 times",
//     "Job 3 years ago", "Numbers 10 to 20" (QUANTITY_WORDS).
//   - Nothing followed by a clock suffix is a reference: "Meet Mark 5:30 pm", "Luke 12:30 p.m.".
//   - Other abbreviations (Mt, Jn, Gn) need chapter and verse.
//   - Abbreviations that are also English words (Is, Am, He) additionally need a citation around them: an opening
//     bracket, a list separator, or a full stop after the abbreviation. "Is 5:30 okay for dinner?" is not Isaiah.
//   - Lists: "13:4, 7" continues the chapter (verses must go up), "8:28; 9:5" continues the book.
//   - Roman chapter numbers as older books print them: "Rom. viii. 28". These need a verse.
//   - "v. 5", "vv. 31-39", "verse 17" belong to a chapter that the same paragraph has named on its own ("In Romans 8
//     ... (v. 5)"), at medium confidence. A verse cited in passing ("see Eph 2:14 ... v. 18") is not a topic: in a
//     commentary "v. 18" then means the passage under discussion, which the scanner cannot know. Measured on Matthew
//     Henry, attaching to the last citation produced about 15,000 wrong links.
//
// Measured (`npm run data:check` repeats the first two): no matches in the whole KJV text, which is full of book
// names and has no citations; about 34,000 links in Matthew Henry's commentary; no matches in 5 MB of technical
// documentation (versions, columns, times). In Easton's and Smith's dictionaries, about 40,000 links, and the
// look-alikes left unlinked were typos in the source, books outside the 66, and bare "See 3:17".
//
// Known gaps, on purpose:
//   - "John chapter 3 verse 16" spelled out, "and" in lists ("vv. 3 and 5", "Acts 2 and 3" links only Acts 2), and a
//     bare chapter after a semicolon ("Matt 5:3; 15").
//   - Citations in Hebrew or Aramaic verse numbering where it differs from English. Dan 3:31-33, Mal 3:19-24 and Joel
//     3:1-5 (English 2:28-32) exist only in that numbering, so they are dropped or, where the English chapter happens to
//     be long enough, linked to the English verse of the same number. Jewish and many modern commentaries cite this way.
//     Fixing it needs to know which numbering a document uses (DATA_SOURCES.md, "Verse numbering").
//   - A citation may wrap onto the next line once ("Rom.\n8:28"), because hard-wrapped public-domain texts break
//     there. The cost is that "said Mark\n5:30" in a transcript links too. A chapter alone never wraps.
//   - Books whose names are also given names (Mark, Luke, John, Job, Amos, Ruth, Joel) followed by a number and a word
//     that is not in QUANTITY_WORDS still link a chapter alone at medium confidence: "gave Mark 5 apples" is Mark 5.
//
// No lookbehind in the regular expressions: the desktop app runs in the system web view, and older macOS versions
// reject a script that contains one. The character before a match is checked by hand instead.
//
// Keep this file free of enums and parameter properties: it is imported directly by Node as well as by the Nuxt build.

import { BOOKS } from './books.ts'
import type { BookMeta } from './books.ts'
import { EXTRA } from './reference.ts'
import { chapterCount, lastVerse } from './versification.ts'

export interface ScannedReference {
  /** Offsets into the scanned text. The first item of a list includes the book name; later items are just "7" or "9:5". */
  start: number
  end: number
  book: BookMeta
  /** Inclusive range in canonical numbering. A single verse has the same start and end; a whole chapter runs from verse 1 to its last verse. */
  chapter: number
  verse: number
  endChapter: number
  endVerse: number
  /** 'chapter' when only chapters were written ("Romans 8", "Matt 5-7"). */
  kind: 'verse' | 'chapter'
  /** 'medium' for a chapter alone and for verse-only mentions ("v. 5") resolved from context. */
  confidence: 'high' | 'medium'
}

// ---------------------------------------------------------------------------------------------
// Book names as they appear in prose
// ---------------------------------------------------------------------------------------------

/** name: may cite a chapter alone. short: needs chapter and verse. contextual: needs chapter, verse and a citation around it. */
type Tier = 'name' | 'short' | 'contextual'
interface Alias { book: BookMeta; tier: Tier; /** The book's whole name, so a full stop after it ends a sentence, not an abbreviation. */ full: boolean }

/** Full names that books.ts does not carry. */
const MORE_NAMES: Record<string, string[]> = { Ps: ['Psalm'], Song: ['Song of Songs', 'Canticles'], Rev: ['Revelations'] }

/** Abbreviations that are also English words, names or common tokens. */
const WORDLIKE = new Set([
  'is', 'am', 'he', 're', 'so', 'es', 'la', 'na', 'ne', 'ho', 'da', 'de', 'nu', 'ro', 'ga', 'ep', 'ac', 'ob', 'je', 'mr', 'pp',
  'act', 'mat', 'pro', 'cant', 'jon', 'jud', 'tit', 'ru', 'jam',
])

interface AliasTable { byKey: Map<string, Alias>; book: RegExp; bookAt: RegExp }
let table: AliasTable | null = null

const SP = '[ \\t\\u00a0]'
// A digit may touch the name ("1Cor"). A word or roman numeral needs a space, or "Isa." reads as "I Sa." (1 Samuel).
const NUM_PREFIX = `([1-3])${SP}*|(III|II|I|first|second|third|1st|2nd|3rd)${SP}+`

function aliases(): AliasTable {
  if (table) return table
  const byKey = new Map<string, Alias>()
  const words = new Set<string>()
  const numberOf = (b: BookMeta) => (/^[1-3]/.test(b.osis) ? Number(b.osis[0]) : 0)
  const add = (b: BookMeta, raw: string, tier: Tier, full: boolean) => {
    const w = raw.replace(/^[1-3]\s*/, '').toLowerCase()
    const key = `${numberOf(b)}:${w}`
    if (!w || byKey.has(key)) return
    byKey.set(key, { book: b, tier: WORDLIKE.has(w) ? 'contextual' : tier, full })
    words.add(w)
  }
  // Three passes, so that a short alias of one book can never take the name of another.
  for (const b of BOOKS) {
    add(b, b.name, 'name', true)
    for (const n of MORE_NAMES[b.osis] ?? []) add(b, n, 'name', true)
  }
  for (const b of BOOKS) add(b, b.osis, 'name', false)
  for (const b of BOOKS) {
    add(b, b.usfm, 'short', false)
    for (const x of EXTRA[b.osis] ?? []) add(b, x, 'short', false)
  }
  // Longest first, so "Song of Solomon" wins over "Song" and "Philemon" over "Phil".
  const alternation = [...words].sort((a, b) => b.length - a.length).map((w) => w.split(' ').join(`${SP}+`)).join('|')
  const source = `(?:${NUM_PREFIX})?(${alternation})(?![A-Za-z])`
  table = { byKey, book: new RegExp(source, 'gi'), bookAt: new RegExp(source, 'iy') }
  return table
}

const isAlnum = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c)
const isUpper = (c: string | undefined) => c !== undefined && c >= 'A' && c <= 'Z'

function prefixNumber(raw: string): number {
  if (/^[1-3]/.test(raw)) return Number(raw[0])
  if (/^I+$/.test(raw)) return raw.length // capital I only: "i john" is not 1 John
  const word = raw.toLowerCase()
  return word === 'first' ? 1 : word === 'second' ? 2 : word === 'third' ? 3 : 0
}

interface BookMatch { alias: Alias; start: number; /** Just past the book name. */ end: number }

/** Checks what the regular expression cannot: capitals, the character before, and whether a leading number belongs to the book. */
function resolveBook(text: string, m: RegExpExecArray, t: AliasTable): BookMatch | null {
  const prefix = m[1] ?? m[2]
  const words = m[3]!
  const wordsStart = m.index + m[0].length - words.length
  const end = m.index + m[0].length
  if (!isUpper(words[0])) return null
  const key = words.toLowerCase().replace(/[ \t\u00a0]+/g, ' ')
  if (prefix) {
    const n = prefixNumber(prefix)
    const before = text[m.index - 1]
    const alias = n ? t.byKey.get(`${n}:${key}`) : undefined
    // "12 John 3:16", "5:1 John says": the digit is part of something else.
    if (alias && !isAlnum(before) && !(before !== undefined && /[:\-‐-—]/.test(before))) return { alias, start: m.index, end }
  }
  // No number, or a number that is not this book's: "2 Mark 3:5" is Mark.
  const alias = t.byKey.get(`0:${key}`)
  if (!alias || (!prefix && isAlnum(text[wordsStart - 1]))) return null
  return { alias, start: wordsStart, end }
}

// ---------------------------------------------------------------------------------------------
// Numbers after the book
// ---------------------------------------------------------------------------------------------

/** Runs a sticky regular expression at `pos`. */
function at(re: RegExp, text: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos
  return re.exec(text)
}

const DASH = '[-\\u2010-\\u2014\\u2212]'
const GAP = new RegExp(`\\.?(${SP}*)(\\r?\\n${SP}*)?`, 'y') // between book and chapter: at most one line break
const ARABIC = /(\d{1,3})(?!\d)/y
const ROMAN = /([clxvi]{1,8})(?![A-Za-z])/y
const VERSE_SEP = new RegExp(`${SP}?:${SP}?(?=\\d)|\\.(?=\\d)`, 'y')
const ROMAN_SEP = new RegExp(`(?:[.,:]${SP}*|${SP}+)(?=\\d)`, 'y')
const VERSE = new RegExp(`(\\d{1,3})(?:([a-d])(?![A-Za-z0-9])|${SP}?(ff?)\\.?(?![A-Za-z0-9]))?`, 'y')
const TIGHT_DASH = new RegExp(`${DASH}(?=\\d)`, 'y')
const LOOSE_DASH = new RegExp(`${SP}${DASH}${SP}?(?=\\d)|${DASH}${SP}(?=\\d)`, 'y')
// The end of a range. A chapter here is written tight ("1:1-2:3"): in "21:18-26: 2 Chr" the colon is a slip for a semicolon.
const RANGE_END = new RegExp(`(\\d{1,3})(?::(\\d{1,3}))?([a-d])?(?![A-Za-z0-9])`, 'y')
const LIST_SEP = new RegExp(`${SP}*([,;])${SP}*(?:\\r?\\n${SP}*)?`, 'y')
const CHAPTER_COLON = new RegExp(`(\\d{1,3})${SP}?:${SP}?(?=\\d)`, 'y')

function romanValue(s: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const v = values[s[i]!]!
    n += v < (values[s[i + 1]!] ?? 0) ? -v : v
  }
  // Only the standard spelling counts: "ill" and "iiii" add up to something but are not numerals.
  let back = ''
  let rest = n
  for (const [value, sym] of [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as Array<[number, string]>) {
    while (rest >= value) { back += sym; rest -= value }
  }
  return back === s ? n : 0
}

interface Span { verse: number; endChapter: number; endVerse: number; end: number }

// "5:30 pm", "12:30 p.m.", "3 o'clock". Not "AMP" (the Amplified Bible) or "amen": the suffix must end the word.
const CLOCK = new RegExp(`${SP}*(?:[ap]\\.?m\\.?|o['\u2019]clock)(?![A-Za-z])`, 'iy')

/**
 * Words that, right after "Mark 5", make the number a count: "Mark 5 times", "Job 3 years ago", "Amos 5 people came".
 * Only consulted for a chapter alone: "Mark 5:3 times" is already a reference by its colon.
 */
const QUANTITY_WORDS = new Set([
  'time', 'times', 'x', 'second', 'seconds', 'sec', 'secs', 'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs',
  'day', 'days', 'night', 'nights', 'week', 'weeks', 'wk', 'wks', 'month', 'months', 'year', 'years', 'yr', 'yrs',
  'decades', 'centuries',
  'people', 'persons', 'men', 'women', 'kids', 'children', 'adults', 'guests', 'members', 'players', 'students', 'others',
  'percent', 'pct', 'pages', 'miles', 'km', 'kilometers', 'kilometres', 'meters', 'metres', 'feet', 'ft', 'inches',
  'pounds', 'lb', 'lbs', 'kg', 'kilos', 'grams', 'oz', 'ounces', 'dollars', 'cents', 'euros', 'bucks',
  'points', 'pts', 'goals', 'runs', 'laps', 'rounds', 'games', 'wins', 'losses', 'votes', 'stars', 'items', 'copies', 'steps',
])
// Short words such as "in", "g", "m" or "more" are left out on purpose: "Psalm 23 in the KJV" is a citation.

/** "Numbers 10 to 20", "Mark 5 or 6", "Luke 3 x 4", "John 5 of 9": a word between two numbers. Not "and": "Romans 8 and 9". */
const BETWEEN_NUMBERS = new Set(['to', 'or', 'x', 'by', 'of', 'through', 'thru', 'out', 'plus', 'minus', 'times'])
const NEXT_WORD = new RegExp(`${SP}+([A-Za-z][A-Za-z'\u2019]*)\\.?(?:${SP}+(\\d))?`, 'y')

/** True when what follows `pos` makes a bare number read as a count or a time rather than a chapter. */
function countFollows(text: string, pos: number): boolean {
  if (at(CLOCK, text, pos)) return true
  const m = at(NEXT_WORD, text, pos)
  if (!m) return false
  const word = m[1]!.toLowerCase()
  return QUANTITY_WORDS.has(word) || (m[2] !== undefined && BETWEEN_NUMBERS.has(word))
}

/**
 * Reads a verse at `pos` (which is at a digit) with whatever follows it: a part letter, f./ff., or a range. Returns
 * null if the verse or its range does not exist in `chapter`, or if it is a clock time ("5:30 pm").
 */
function verseSpan(text: string, pos: number, bookId: number, chapter: number): Span | null {
  const span = verseSpanAt(text, pos, bookId, chapter)
  return span && !at(CLOCK, text, span.end) ? span : null
}

function verseSpanAt(text: string, pos: number, bookId: number, chapter: number): Span | null {
  const m = at(VERSE, text, pos)
  if (!m) return null
  const verse = Number(m[1])
  const last = lastVerse(bookId, chapter)
  let end = pos + m[0].length
  if (verse < 1 || verse > last || isAlnum(text[end])) return null
  if (m[3]) return { verse, endChapter: chapter, endVerse: m[3].length === 2 ? last : Math.min(verse + 1, last), end }

  const single: Span = { verse, endChapter: chapter, endVerse: verse, end }
  const tight = at(TIGHT_DASH, text, end)
  const dash = tight ?? at(LOOSE_DASH, text, end)
  if (!dash) return single
  // "8:28-40" is a range that does not exist, so the citation is wrong. "3:16 - 5 stars" is a verse and a dash.
  const bad = tight ? null : single
  const r = at(RANGE_END, text, end + dash[0].length)
  if (!r) return bad
  end += dash[0].length + r[0].length
  if (r[2] !== undefined) {
    const endChapter = Number(r[1])
    const endVerse = Number(r[2])
    if (endChapter <= chapter || endVerse < 1 || endVerse > lastVerse(bookId, endChapter)) return bad
    return { verse, endChapter, endVerse, end }
  }
  const endVerse = Number(r[1])
  if (endVerse <= verse || endVerse > last) return bad
  return { verse, endChapter: chapter, endVerse, end }
}

/** Reads everything after a book name: the first chapter or chapter:verse, then any list that continues it. */
function afterBook(text: string, found: BookMatch, t: AliasTable, out: ScannedReference[]): boolean {
  const { alias } = found
  const book = alias.book
  const gap = at(GAP, text, found.end)!
  const dotted = text[found.end] === '.'
  const wrapped = gap[2] !== undefined
  let pos = found.end + gap[0].length

  if (alias.tier === 'contextual' && !dotted) {
    // "(Is 53:5)" and "Jer 1:5; Is 53:5" are citations. "Is 5:30 okay?" is a question about the time.
    let i = found.start - 1
    while (i >= 0 && /\s/.test(text[i]!)) i--
    if (i < 0 || !'([;,'.includes(text[i]!)) return false
  }

  const push = (start: number, chapter: number, s: Span, kind: 'verse' | 'chapter', confidence: 'high' | 'medium') => {
    out.push({ start, end: s.end, book, chapter, verse: s.verse, endChapter: s.endChapter, endVerse: s.endVerse, kind, confidence })
  }

  let chapter: number
  let span: Span | null
  let romanList = false
  const arabic = at(ARABIC, text, pos)
  if (arabic) {
    chapter = Number(arabic[1])
    pos += arabic[0].length
    const sep = at(VERSE_SEP, text, pos)
    if (sep) {
      if (chapter < 1 || chapter > chapterCount(book.id)) return false
      span = verseSpan(text, pos + sep[0].length, book.id, chapter)
      if (!span) return false
      push(found.start, chapter, span, 'verse', 'high')
    } else {
      // A number with no verse. Only trusted after a full name or standard abbreviation, on the same line.
      const next = text[pos]
      if (alias.tier !== 'name' || wrapped || (dotted && alias.full)) return false
      if (isAlnum(next) || next === '%' || /^,\d{3}(?!\d)/.test(text.slice(pos, pos + 5)) || new RegExp(`^${DASH}[A-Za-z]`).test(text.slice(pos, pos + 2))) return false
      if (countFollows(text, pos)) return false
      if (chapterCount(book.id) === 1) {
        // Jude 5, Philemon 6: the book has one chapter, so the number is a verse.
        chapter = 1
        span = verseSpan(text, pos - arabic[0].length, book.id, 1)
        if (!span) return false
        push(found.start, 1, span, 'verse', 'medium')
      } else {
        if (chapter < 1 || chapter > chapterCount(book.id)) return false
        let endChapter = chapter
        const dash = at(TIGHT_DASH, text, pos) ?? at(LOOSE_DASH, text, pos)
        const to = dash && at(ARABIC, text, pos + dash[0].length)
        if (dash && to) {
          const afterTo = pos + dash[0].length + to[0].length
          const n = Number(to[1])
          if (n > chapter && n <= chapterCount(book.id) && !isAlnum(text[afterTo]) && !at(VERSE_SEP, text, afterTo)) {
            // "Mark 5-7 years" is an age range.
            if (countFollows(text, afterTo)) return false
            endChapter = n
            pos = afterTo
          }
        }
        push(found.start, chapter, { verse: 1, endChapter, endVerse: lastVerse(book.id, endChapter), end: pos }, 'chapter', 'medium')
        return true // a chapter alone does not start a list
      }
    }
  } else {
    // "Rom. viii. 28"
    const roman = at(ROMAN, text, pos)
    chapter = roman ? romanValue(roman[1]!) : 0
    const sep = roman && at(ROMAN_SEP, text, pos + roman[0].length)
    if (!roman || !sep || chapter < 1 || chapter > chapterCount(book.id)) return false
    span = verseSpan(text, pos + roman[0].length + sep[0].length, book.id, chapter)
    if (!span) return false
    push(found.start, chapter, span, 'verse', 'high')
    romanList = true
  }

  // The list: ", 7" is another verse of this chapter, ", 9:5" and "; 9:5" another chapter of this book.
  for (;;) {
    pos = span.end
    const sep = at(LIST_SEP, text, pos)
    if (!sep) break
    const q = pos + sep[0].length
    // Another book starts here ("John 3:16, 1 John 4:8"): the main loop takes it from there.
    const nextBook = at(t.bookAt, text, q)
    if (nextBook && resolveBook(text, nextBook, t)) break

    let nextChapter = span.endChapter
    let versePos = q
    const withChapter = at(CHAPTER_COLON, text, q)
    const roman = romanList && sep[1] === ';' ? at(ROMAN, text, q) : null
    if (withChapter) {
      nextChapter = Number(withChapter[1])
      versePos = q + withChapter[0].length
    } else if (roman) {
      const rsep = at(ROMAN_SEP, text, q + roman[0].length)
      if (!rsep) break
      nextChapter = romanValue(roman[1]!)
      versePos = q + roman[0].length + rsep[0].length
    } else if (sep[1] === ';') {
      break
    }
    if (nextChapter < 1 || nextChapter > chapterCount(book.id)) break
    const next = verseSpan(text, versePos, book.id, nextChapter)
    if (!next) break
    // Within a chapter the verses of a list go up: in "8:28, 3 things" the 3 is not a verse.
    if (versePos === q && next.verse <= span.endVerse) break
    chapter = nextChapter
    span = next
    push(q, chapter, span, 'verse', 'high')
  }
  return true
}

// ---------------------------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------------------------

const VERSE_WORD = new RegExp(`(?:vv?\\.|vss?\\.|ver\\.|verses?)${SP}*(?=\\d)`, 'gi')
const PARAGRAPH_BREAK = /\n[ \t\u00a0]*\r?\n/
/** "ch. 5", "chap. v", "chapter 12": another chapter, of a book the scanner may not know, has been named. */
const OTHER_CHAPTER = /\b(?:ch|chap)\.[ \t\u00a0]*(?:\d|[clxvi]+\b)|\bchapter[ \t\u00a0]+\d/i
/** How far back a "v. 5" may look for its chapter, in characters. */
const CONTEXT_REACH = 2000

/** Every Scripture reference in `text`, in order, without overlaps. */
export function scanReferences(text: string): ScannedReference[] {
  const t = aliases()
  const out: ScannedReference[] = []
  /** The chapter under discussion: the last one named on its own ("In Romans 8 ..."). It is what "v. 5" refers to. */
  let topic: { book: BookMeta; chapter: number; end: number } | null = null
  let pos = 0
  // The next candidate of each kind at or after `pos`. Looked up only when the previous one has been passed, so the
  // text is read once however many references it holds.
  let bookMatch: RegExpExecArray | null | undefined
  let verseMatch: RegExpExecArray | null | undefined

  for (;;) {
    if (bookMatch === undefined || (bookMatch && bookMatch.index < pos)) bookMatch = at(t.book, text, pos)
    if (verseMatch === undefined || (verseMatch && verseMatch.index < pos)) verseMatch = at(VERSE_WORD, text, pos)
    if (!bookMatch && !verseMatch) break

    if (bookMatch && (!verseMatch || bookMatch.index <= verseMatch.index)) {
      const m = bookMatch
      bookMatch = undefined
      const found = resolveBook(text, m, t)
      const before = out.length
      if (found && afterBook(text, found, t, out)) {
        const last = out[out.length - 1]!
        pos = last.end
        // A range of chapters leaves no single chapter to attach to. A cited verse does not change the topic.
        if (last.kind === 'chapter') topic = last.chapter === last.endChapter ? { book: last.book, chapter: last.chapter, end: last.end } : null
      } else {
        out.length = before
        pos = m.index + m[0].length
      }
      continue
    }

    const m = verseMatch!
    verseMatch = undefined
    const digits = m.index + m[0].length
    pos = digits
    if (!topic || isAlnum(text[m.index - 1]) || m.index - topic.end > CONTEXT_REACH) continue
    const between = text.slice(topic.end, m.index)
    if (PARAGRAPH_BREAK.test(between) || OTHER_CHAPTER.test(between)) { topic = null; continue }
    // "ch. v. 4" is chapter five, verse four, of a book the scanner cannot name.
    if (/ch(?:ap)?\.[ \t\u00a0]*$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) continue
    let span = verseSpan(text, digits, topic.book.id, topic.chapter)
    let start = m.index
    while (span && span.endChapter === topic.chapter) {
      out.push({ start, end: span.end, book: topic.book, chapter: topic.chapter, verse: span.verse, endChapter: span.endChapter, endVerse: span.endVerse, kind: 'verse', confidence: 'medium' })
      pos = span.end
      // "vv. 29, 30"
      const sep = at(LIST_SEP, text, pos)
      if (!sep || sep[1] !== ',') break
      start = pos + sep[0].length
      const next = /\d/.test(text[start] ?? '') ? verseSpan(text, start, topic.book.id, topic.chapter) : null
      if (!next || next.verse <= span.endVerse) break
      span = next
    }
  }
  return out
}

/** One piece per chapter, for storing a reference as plain verse ranges ("Gen 1:1-2:3" is Gen 1:1-31 and Gen 2:1-3). */
export function splitByChapter(ref: Pick<ScannedReference, 'book' | 'chapter' | 'verse' | 'endChapter' | 'endVerse'>): Array<{ bookId: number; chapter: number; verseStart: number; verseEnd: number }> {
  const pieces = []
  for (let c = ref.chapter; c <= ref.endChapter; c++) {
    pieces.push({ bookId: ref.book.id, chapter: c, verseStart: c === ref.chapter ? ref.verse : 1, verseEnd: c === ref.endChapter ? ref.endVerse : lastVerse(ref.book.id, c) })
  }
  return pieces
}
