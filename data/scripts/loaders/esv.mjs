// ESV loader: reads the Crossway "ESV Classic Reference Bible" ePub (DRM-free) from data/sources/esv/.
//
// The ESV is copyrighted. This file only reads an epub the user supplies; the text is never committed or
// downloaded (data/sources and data/build are git-ignored), and the build skips ESV when the epub is absent.
// See DATA_SOURCES.md for the licence caveat before distributing any build that contains this text.
//
// Output matches web.mjs (verses / headings / notes in the same shapes), so the UI needs no ESV-specific code:
//   tokens = [[text, null, flags, noteSeq?], ...]   flags: 1 = words of Christ, 2 = footnote marker
//
// Cross-references are stored as notes (kind 'xref', one row per target verse) and are NOT emitted as inline
// tokens: the epub has ~44,000 of them and a marker for each would bury the text. They feed the Cross
// References tab instead. Footnotes (~3,800) do get an inline marker.

import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { BOOKS } from '../../../shared/books.ts'

const JESUS = 1
const NOTE = 2

const POETRY = new Set(['line-group', 'line', 'line-indent', 'line-space', 'no-indent-line-space', 'line-group-after-heading'])
// Paragraph classes whose text is a heading rather than verse text, and the heading kind each becomes.
const HEADING_P = { heading: 'ms', 'psalm-title': 'd', 'psalm-acrostic-title': 'd', speaker: 'sp' }
// Spans whose content is chrome (book title, chapter/verse numbers), never verse text.
const SKIP_SPAN = new Set(['book-name', 'chapter-num', 'verse-num'])
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/ /g, ' ')
}
const plain = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** Footnote and cross-reference bodies live in hidden <section>s at the end of each text file. */
function parseNotePopups(html) {
  const footnotes = new Map() // 'p43001004.1' -> text
  for (const m of html.matchAll(/<span id="(p\d+\.\d+)" class="footnote-popup">\s*<span class="footnote-ref">[^<]*<\/span>(.*?)<\/span><\/span>/gs)) {
    footnotes.set(m[1], plain(m[2]))
  }
  const xrefs = new Map() // 'r43001001.a' -> [{ book, chapter, verse, text }]
  for (const m of html.matchAll(/<span id="(r\d+\.[a-z]+)" class="crossref-popup">(.*?)<\/span><\/span><\/p>/gs)) {
    const body = m[2].replace(/<span class="crossref-verse">.*?<\/span>/s, '').replace(/<span class="crossref-letter">.*?<\/span>/s, '')
    const refs = []
    for (const a of body.matchAll(/<a [^>]*href="[^"#]*#v(\d{2})(\d{3})(\d{3})"[^>]*>([^<]*)<\/a>/g)) {
      const bookId = Number(a[1]), chapter = Number(a[2]), verse = Number(a[3])
      const book = BOOKS[bookId - 1]
      if (!book) continue
      refs.push({ bookId, chapter, verse, text: refText(book.name, chapter, verse, plain(a[4])) })
    }
    xrefs.set(m[1], refs)
  }
  return { footnotes, xrefs }
}

/** "Rev. 1:4" with link text "1:4" or "8" -> "Revelation 1:4"; keeps a verse range ("1:1-3") when the link text has one. */
function refText(bookName, chapter, verse, linkText) {
  const range = /(?:(\d+):)?(\d+)\s*[–—-]\s*(?:(\d+):)?(\d+)\s*$/.exec(linkText)
  if (range) {
    const endCh = range[3] ? Number(range[3]) : null
    const endV = Number(range[4])
    if (endCh && endCh !== chapter) return `${bookName} ${chapter}:${verse}–${endCh}:${endV}`
    if (endV > verse) return `${bookName} ${chapter}:${verse}–${endV}`
  }
  return `${bookName} ${chapter}:${verse}`
}

/**
 * Walks one text file. `acc` collects verses across files (a verse can run over a file boundary), keyed by the
 * epub's own verse id, e.g. "43001001". Pure: no I/O.
 */
export function parseEsvTextFile(html, acc) {
  const hiddenAt = html.indexOf('<section class="hidden">')
  const main = html.slice(html.indexOf('<body'), hiddenAt < 0 ? undefined : hiddenAt)
  const { footnotes, xrefs } = parseNotePopups(html)

  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/gs
  const stack = []
  let verseKey = null // verse the text currently belongs to
  let pClass = ''
  let pFresh = false // no text emitted yet in this <p>
  let headingKind = null // inside a heading paragraph: its kind
  let headingText = ''
  let headingId = null
  let pendingHeadings = [] // waiting for the next verse to start
  let pendingMarkers = [] // footnotes found inside headings; attached to the next verse

  const verseOf = (key) => {
    let v = acc.get(key)
    if (!v) {
      v = { key, tokens: [], notes: [], headings: [], para: 0, poetry: 0 }
      acc.set(key, v)
    }
    return v
  }
  const addNote = (v, kind, text) => {
    v.notes.push({ kind, text })
    return v.notes.length
  }
  const startVerse = (key) => {
    verseKey = key
    const v = verseOf(key)
    if (pendingHeadings.length) {
      v.headings.push(...pendingHeadings)
      pendingHeadings = []
    }
    for (const text of pendingMarkers) {
      v.tokens.push(['', null, NOTE, addNote(v, 'footnote', text)])
    }
    pendingMarkers = []
    return v
  }
  const inside = (pred) => stack.some(pred)

  for (const m of main.matchAll(TAG)) {
    if (m[5] !== undefined) {
      // Text node.
      if (!stack.length || inside((s) => s.skip)) continue
      if (!inside((s) => s.tag === 'p')) continue
      const raw = decode(m[5]).replace(/\s+/g, ' ')
      if (headingKind) {
        headingText += raw
        continue
      }
      if (!verseKey || !raw.trim() && pFresh) continue
      // Headings (and footnotes found inside them) belong to the verse that this text starts or continues.
      const v = pendingHeadings.length || pendingMarkers.length ? startVerse(verseKey) : verseOf(verseKey)
      let text = raw
      const prev = v.tokens.at(-1)
      const atLineStart = !prev || (typeof prev[0] === 'string' && prev[0].endsWith('\n'))
      if (atLineStart) text = text.replace(/^ +/, '')
      if (!text) continue
      if (pFresh) {
        // First text in this paragraph.
        if (v.tokens.some((t) => !(t[2] & NOTE))) v.tokens.push(['\n', null, 0])
        else if (!v.sawText) v.para = 1
        pFresh = false
        text = text.replace(/^ +/, '')
        if (!text) continue
      }
      v.sawText = true
      if (POETRY.has(pClass)) v.poetry = 1
      v.tokens.push([text, null, inside((s) => s.woc) ? JESUS : 0])
      continue
    }

    const [, closing, tag, attrs] = m
    const name = tag.toLowerCase()
    if (closing) {
      // Pop to the matching open tag.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === name) {
          const [el] = stack.splice(i)
          if (name === 'p' && el.tag === 'p' && headingKind) {
            const text = headingText.replace(/\s+/g, ' ').trim()
            if (text) pendingHeadings.push({ kind: headingKind, text })
            // A heading's id names the verse it sits above. Some verse-number spans carry no id and no usable
            // class (Ps 119:9, Song 1:5), so this is the only marker for where that verse starts.
            if (headingId && (!verseKey || headingId > verseKey)) {
              verseKey = headingId
              verseOf(headingId)
            }
            headingKind = null
            headingText = ''
          }
          break
        }
      }
      if (name === 'p') pClass = ''
      continue
    }
    if (VOID.has(name) || m[4]) continue

    const cls = (/class="([^"]*)"/.exec(attrs) ?? [])[1] ?? ''
    const el = { tag: name, cls, skip: false, woc: false }

    if (name === 'p') {
      pClass = cls.split(/\s+/)[0]
      pFresh = true
      if (pClass in HEADING_P) {
        headingKind = HEADING_P[pClass]
        headingText = ''
        headingId = (/\bid="v(\d{8})"/.exec(attrs) ?? [])[1] ?? null
      } else {
        // Chapter-first verses (Exod 36:1, Col 4:1) carry their id on the paragraph, with a stale line class.
        const pid = (/\bid="v(\d{8})"/.exec(attrs) ?? [])[1]
        if (pid && (!verseKey || pid > verseKey)) startVerse(pid)
      }
    } else if (name === 'span') {
      const parts = cls.split(/\s+/)
      // Verse boundaries. The h-class on a line is unreliable at chapter starts (Prov 11:1 still carries the
      // previous verse's class), so also trust the id on the verse-number / chapter-number span, and never let a
      // stale (lower) key move the verse backwards. Verse ids are fixed-width, so string order is canon order.
      if (!headingKind) {
        const h = parts.find((c) => /^h\d{8}$/.test(c))
        const idKey = (/\bid="v(\d{8})"/.exec(attrs) ?? [])[1]
        for (const key of [h && h.slice(1), idKey]) {
          if (key && (!verseKey || key > verseKey || (key === verseKey && (pendingHeadings.length || pendingMarkers.length)))) startVerse(key)
        }
      }
      if (parts.includes('woc')) el.woc = true
      if (parts.some((c) => SKIP_SPAN.has(c))) el.skip = true
      if (parts.includes('crossref') || parts.includes('footnote')) el.skip = true
      if (parts.includes('footnote-popup') || parts.includes('crossref-popup')) el.skip = true
    } else if (name === 'a') {
      const onclick = (/onclick="([^"]*)"/.exec(attrs) ?? [])[1] ?? ''
      const id = (/nav\.show\('([rp]\d+\.[a-z0-9]+)'/.exec(onclick) ?? [])[1]
      if (id && inside((s) => s.cls.split(/\s+/).includes('footnote') || s.cls.split(/\s+/).includes('crossref'))) {
        if (id.startsWith('p')) {
          const text = footnotes.get(id)
          if (text) {
            if (headingKind || !verseKey) pendingMarkers.push(text)
            else {
              const v = verseOf(verseKey)
              v.tokens.push(['', null, NOTE, addNote(v, 'footnote', text)])
            }
          }
        } else if (verseKey && !headingKind) {
          const v = verseOf(verseKey)
          // Several letters on a verse often point at the same place; list each target once.
          for (const r of xrefs.get(id) ?? []) if (!v.notes.some((n) => n.kind === 'xref' && n.text === r.text)) addNote(v, 'xref', r.text)
        }
      }
    }
    stack.push(el)
  }
  return acc
}

function finish(v) {
  const tokens = []
  for (const t of v.tokens) {
    const prev = tokens.at(-1)
    if (prev && !(prev[2] & NOTE) && !(t[2] & NOTE) && prev[2] === t[2]) prev[0] += t[0]
    else tokens.push(t.slice())
  }
  // Trim the verse ends.
  // The first text token may sit behind a footnote marker (a footnote found inside the heading above).
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i][2] & NOTE) continue
    tokens[i][0] = tokens[i][0].replace(/^\s+/, '')
    if (!tokens[i][0]) { tokens.splice(i, 1); i--; continue }
    break
  }
  while (tokens.length && !(tokens.at(-1)[2] & NOTE) && !tokens.at(-1)[0].trim()) tokens.pop()
  const last = tokens.at(-1)
  if (last && !(last[2] & NOTE)) last[0] = last[0].replace(/\s+$/, '')
  // Spaces around a line break are noise.
  for (const t of tokens) if (!(t[2] & NOTE)) t[0] = t[0].replace(/ *\n */g, '\n')
  return tokens
}

/** Reads the epub and inserts the 66 books as translation `sourceId`. */
export async function loadEsv(db, { epubPath, sourceId = 'ESV', log = () => {} }) {
  const files = unzipSync(new Uint8Array(await readFile(epubPath)))
  const names = Object.keys(files).filter((n) => /OEBPS\/Text\/b\d{2}\.\d{2}\.[^/]+\.text\.xhtml$/.test(n)).sort()
  if (!names.length) throw new Error('ESV epub has no OEBPS/Text/bNN.NN.*.text.xhtml files; the layout changed. Update loaders/esv.mjs.')

  const acc = new Map()
  for (const n of names) parseEsvTextFile(strFromU8(files[n]), acc)

  const insVerse = db.prepare('INSERT INTO verses (translation_id, book_id, chapter, verse, text, tokens, para, poetry) VALUES (?,?,?,?,?,?,?,?)')
  const insHeading = db.prepare('INSERT INTO headings (translation_id, book_id, chapter, before_verse, seq, kind, text) VALUES (?,?,?,?,?,?,?)')
  const insNote = db.prepare('INSERT INTO notes (translation_id, book_id, chapter, verse, seq, kind, text) VALUES (?,?,?,?,?,?,?)')
  const stats = { books: new Set(), verses: 0, headings: 0, footnotes: 0, xrefs: 0 }
  const chapters = new Map()

  db.exec('BEGIN')
  try {
    for (const key of [...acc.keys()].sort()) {
      const v = acc.get(key)
      const bookId = Number(key.slice(0, 2)), chapter = Number(key.slice(2, 5)), verse = Number(key.slice(5, 8))
      if (!BOOKS[bookId - 1]) throw new Error(`ESV: unknown book in verse id ${key}`)
      const tokens = finish(v)
      const text = tokens.map((t) => t[0]).join('')
      if (!text) {
        // A verse the ESV leaves out (e.g. Matt 17:21) can still carry a footnote; keep only real text.
        if (!v.notes.length) continue
      }
      insVerse.run(sourceId, bookId, chapter, verse, text, JSON.stringify(tokens), v.para, v.poetry)
      v.headings.forEach((h, i) => insHeading.run(sourceId, bookId, chapter, verse, i + 1, h.kind, h.text))
      v.notes.forEach((n, i) => insNote.run(sourceId, bookId, chapter, verse, i + 1, n.kind, n.text))
      stats.books.add(bookId)
      stats.verses++
      stats.headings += v.headings.length
      stats.footnotes += v.notes.filter((n) => n.kind === 'footnote').length
      stats.xrefs += v.notes.filter((n) => n.kind === 'xref').length
      chapters.set(bookId, Math.max(chapters.get(bookId) ?? 0, chapter))
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  log(`ESV: ${stats.books.size} books, ${stats.verses} verses, ${stats.headings} headings, ${stats.footnotes} footnotes, ${stats.xrefs} cross-references`)
  return { stats: { ...stats, books: stats.books.size }, chapters }
}
