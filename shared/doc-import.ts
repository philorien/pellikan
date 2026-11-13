// Turns an imported text or Markdown file into what user.db stores: a title, passages ("chunks") of a few paragraphs,
// and the Scripture references found in each passage (scanReferences).
//
// Pure: text in, data out. It runs in a Web Worker in the app (app/workers/extract.worker.ts) so that scanning a long
// book does not freeze the window, and directly in Node in the tests. EPUB, DOCX and PDF will each get their own
// extractor that produces the same ImportedDocument.
//
// Decisions worth knowing:
//   - Chunks are about 1,500 characters, never longer than 2,500, and never cross a heading. A chunk is the unit that is
//     searched and cited, so it is small enough to read at a glance and large enough to carry a thought.
//   - The scanner reads the chunk's heading together with its text. A commentary with a "Romans 8" heading followed by
//     notes that say "(v. 5)" then links that verse to Romans 8; without the heading it could not.
//   - Text is kept as written, including line breaks. Hard-wrapped files stay hard-wrapped, and the reader shows them
//     with their breaks. Nothing here is HTML: imported text is always shown as text.
//   - Markdown is reduced to plain text: headings become chunk headings, links and emphasis lose their markup, code
//     fences and HTML tags are dropped. It is not a Markdown renderer.
//
// Keep this file free of enums and parameter properties: it is imported directly by Node as well as by the Nuxt build.

import { scanReferences, splitByChapter } from './reference-scan.ts'

export type ImportFormat = 'txt' | 'md'

export interface ImportRef {
  /** Canonical book id 1..66 and English chapter and verse numbers, as in doc_refs. */
  book: number
  chapter: number
  from: number
  to: number
  confidence: 'high' | 'medium'
}

export interface ImportChunk {
  seq: number
  heading: string | null
  /** A human location such as "p. 112". Text and Markdown have none; page-based formats will. */
  loc: string | null
  text: string
  refs: ImportRef[]
}

export interface ImportedDocument {
  title: string
  author: string | null
  chunks: ImportChunk[]
  /** Characters of text kept, summed over the chunks. */
  chars: number
}

/** Largest file the app accepts. Text is small; a file past this is almost certainly not a book. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const TARGET_CHUNK = 1500
const MAX_CHUNK = 2500

/** The format for a file name, or null if the app cannot import it (yet). */
export function formatOf(fileName: string): ImportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase()
  if (ext === 'txt' || ext === 'text') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  return null
}

/** "my_notes-on-romans.md" -> "my notes on romans". The title when the file does not name one. */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '')
  // Underscores, and hyphens between two letters, separate words. "Romans 8-9" and "Part - Two" keep theirs.
  const spaced = stem.replace(/_+/g, ' ').replace(/([A-Za-z])-(?=[A-Za-z])/g, '$1 ').replace(/\s+/g, ' ').trim()
  return spaced || 'Untitled'
}

/**
 * Checks that decoded text is text. Returns a message for the user, or null.
 *   - Any replacement character (U+FFFD) means bytes that are not valid UTF-8: a Latin-1 or Windows-1252 file decodes
 *     to one for every accented letter. Valid UTF-8 text almost never contains one, and importing the file would store
 *     "caf\ufffd" with no way to tell, so the file is refused. This is deliberately not a percentage: English with the odd
 *     accent is 0.3% replacement characters and would pass a threshold while corrupting every passage.
 *   - More than 1% control characters means a binary file.
 */
export function textProblem(text: string): string | null {
  if (!text.trim()) return 'The file is empty.'
  let replaced = 0
  let control = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0xfffd) replaced++
    else if (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) control++
  }
  if (replaced) {
    return `${replaced === 1 ? 'One character in this file is' : `${replaced.toLocaleString('en-US')} characters in this file are`} not valid UTF-8 (the file is probably Latin-1 or Windows-1252). Save it as UTF-8 and try again.`
  }
  if (control / text.length > 0.01) return 'This does not look like a text file.'
  return null
}

// ---------------------------------------------------------------------------------------------
// Reading the file into blocks: headings and paragraphs
// ---------------------------------------------------------------------------------------------

type Block = { kind: 'heading'; text: string; level: number } | { kind: 'para'; text: string }

function normalize(raw: string): string {
  let text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n')
  // Zero-width and soft characters that publishers leave in, and that would break "Rom​8:28".
  text = text.replace(/[​‌‍⁠­]/g, '')
  return text.replace(/\u0000/g, '')
}

/** Removes inline Markdown markup from one line, keeping the words. */
function stripInline(s: string): string {
  let out = s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
  // Bold and italic: a marker pair around non-space text. Underscores inside a word (snake_case) are not markers.
  out = out.replace(/(\*\*|__)(\S(?:[^\n]*?\S)?)\1/g, '$2')
  out = out.replace(/(^|[\s(\[])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s.,;:!?)\]])/g, '$1$2')
  out = out.replace(/(^|[\s(\[])_(\S(?:[^_\n]*?\S)?)_(?=$|[\s.,;:!?)\]])/g, '$1$2')
  return out
}

interface FrontMatter { title: string | null; author: string | null; body: string }

/** Keys that mark a "---" block as front matter. Not an exhaustive list of what front matter can hold. */
const FRONT_MATTER_KEYS = new Set(['title', 'author', 'authors', 'subtitle', 'date', 'tags', 'categories', 'description', 'layout', 'lang', 'language', 'draft', 'slug', 'publisher'])

/**
 * A "---" block at the very top that is metadata: `key: value` lines, and at least one key from FRONT_MATTER_KEYS. A
 * file that merely opens with a horizontal rule ("---", then a heading, then text, then another "---") is not front
 * matter, and treating it as such would silently drop everything between the two rules. When in doubt the block stays
 * in the text: front matter shown as a paragraph is a blemish, a lost section is a defect.
 */
function frontMatter(text: string): FrontMatter {
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text)
  if (!m || !looksLikeMetadata(m[1]!)) return { title: null, author: null, body: text }
  const field = (name: string) => {
    const f = new RegExp(`^${name}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im').exec(m[1]!)
    return f ? f[1]!.replace(/^(["'])(.*)\1$/, '$2').trim() || null : null
  }
  return { title: field('title'), author: field('author'), body: text.slice(m[0].length) }
}

function looksLikeMetadata(block: string): boolean {
  let known = false
  for (const line of block.split('\n')) {
    if (!line.trim() || /^\s/.test(line) || /^\s*(?:-\s|#)/.test(line)) continue // blank, a continuation, a list item, a comment
    const key = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]|$)/.exec(line)?.[1]
    if (!key) return false // a line of prose or a heading: this is text between two rules
    if (FRONT_MATTER_KEYS.has(key.toLowerCase())) known = true
  }
  return known
}

function markdownBlocks(body: string): { blocks: Block[]; firstHeading: string | null } {
  const blocks: Block[] = []
  let firstHeading: string | null = null
  let para: string[] = []
  let fenced = false
  const flush = () => {
    const text = para.join('\n').trim()
    if (text) blocks.push({ kind: 'para', text })
    para = []
  }
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced // fence lines are dropped; what is inside is kept as written
      continue
    }
    if (fenced) {
      para.push(line)
      continue
    }
    if (!line.trim()) { flush(); continue }
    const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
    if (h) {
      flush()
      const text = stripInline(h[2]!).trim()
      if (text) {
        blocks.push({ kind: 'heading', text, level: h[1]!.length })
        if (h[1]!.length === 1) firstHeading ??= text
      }
      continue
    }
    if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) { flush(); continue } // horizontal rule
    para.push(stripInline(line.replace(/^ {0,3}>[ \t]?/, '')))
  }
  flush()
  return { blocks, firstHeading }
}

/**
 * A roman numeral in standard form, not any run of the letters I V X L C D M: "civil" and "mild" are made of those letters
 * and are not numerals. The lookahead stops the pattern matching the empty string.
 */
const ROMAN = '(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})'
/** "CHAPTER III", "Book 2: Acts", "Part I". */
const CHAPTER_MARKER = new RegExp(`^(?:chapter|book|part|section|lecture|sermon|canto)\\s+(?:\\d+|${ROMAN})\\b[.:)]?(?:\\s+\\S.*)?$`, 'i')

/**
 * Plain text has no headings, so a few conventions stand in: a chapter marker, or a short line in capitals, alone
 * between blank lines. A wrong guess costs a chunk boundary and a label, nothing more.
 */
function isTextHeading(line: string): boolean {
  if (line.length > 70) return false
  if (CHAPTER_MARKER.test(line)) return true
  return line.length <= 60 && /[A-Z].*[A-Z].*[A-Z]/.test(line) && line === line.toUpperCase() && !/[.!?]$/.test(line)
}

function textBlocks(body: string): Block[] {
  const blocks: Block[] = []
  for (const raw of body.split(/\n[ \t]*\n+/)) {
    const text = raw.replace(/^\n+|\s+$/g, '')
    if (!text) continue
    const single = text.includes('\n') ? '' : text.trim()
    blocks.push(single && isTextHeading(single) ? { kind: 'heading', text: single, level: 2 } : { kind: 'para', text })
  }
  return blocks
}

// ---------------------------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------------------------

/** Splits one over-long paragraph at sentence ends, then at line breaks, then at spaces, and last of all anywhere. */
function splitLong(text: string): string[] {
  const pieces: string[] = []
  let rest = text
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK)
    let cut = -1
    for (const re of [/[.!?]["'”’)\]]*[ \t\n]/g, /\n/g, /[ \t]/g]) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      let last = -1
      while ((m = re.exec(window))) last = m.index + m[0].length
      // Do not cut so early that the piece is a fragment.
      if (last > MAX_CHUNK / 3) { cut = last; break }
    }
    if (cut < 0) cut = MAX_CHUNK
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces.filter(Boolean)
}

/** One entry per chapter and range, the strongest confidence first, so a repeated citation is stored once. */
function refsFor(heading: string | null, text: string): ImportRef[] {
  // A single line break, not a paragraph break: "(v. 5)" in the text may refer to the chapter the heading names.
  const scanned = scanReferences(heading ? `${heading}\n${text}` : text)
  const byKey = new Map<string, ImportRef>()
  for (const r of scanned) {
    for (const p of splitByChapter(r)) {
      const key = `${p.bookId}.${p.chapter}.${p.verseStart}.${p.verseEnd}`
      const seen = byKey.get(key)
      if (!seen || (seen.confidence === 'medium' && r.confidence === 'high')) {
        byKey.set(key, { book: p.bookId, chapter: p.chapter, from: p.verseStart, to: p.verseEnd, confidence: r.confidence })
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1))
}

function chunkBlocks(blocks: Block[]): ImportChunk[] {
  const chunks: ImportChunk[] = []
  let heading: string | null = null
  let paras: string[] = []
  let size = 0
  const flush = () => {
    const text = paras.join('\n\n').trim()
    if (text) chunks.push({ seq: chunks.length, heading, loc: null, text, refs: refsFor(heading, text) })
    paras = []
    size = 0
  }
  for (const b of blocks) {
    if (b.kind === 'heading') {
      flush()
      heading = b.text
      continue
    }
    for (const piece of b.text.length > MAX_CHUNK ? splitLong(b.text) : [b.text]) {
      if (size > 0 && size + piece.length > TARGET_CHUNK) flush()
      paras.push(piece)
      size += piece.length + 2
    }
  }
  flush()
  return chunks
}

/**
 * Extracts a document from decoded text. Throws an Error with a message fit to show the user if there is nothing to
 * import. `fileName` supplies the title when the file does not name one.
 */
export function extractDocument(raw: string, format: ImportFormat, fileName: string): ImportedDocument {
  const problem = textProblem(raw)
  if (problem) throw new Error(problem)
  const text = normalize(raw)

  let title: string | null = null
  let author: string | null = null
  let blocks: Block[]
  if (format === 'md') {
    const fm = frontMatter(text)
    const parsed = markdownBlocks(fm.body)
    blocks = parsed.blocks
    title = fm.title ?? parsed.firstHeading
    author = fm.author
  } else {
    blocks = textBlocks(text)
  }

  const chunks = chunkBlocks(blocks)
  if (!chunks.length) throw new Error('No text was found in this file.')
  return {
    title: (title ?? titleFromFileName(fileName)).slice(0, 200),
    author: author ? author.slice(0, 200) : null,
    chunks,
    chars: chunks.reduce((n, c) => n + c.text.length, 0),
  }
}
