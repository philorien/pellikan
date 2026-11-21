// PDF: text only. pdf.js reads the text layer; this file turns its positioned fragments back into lines, paragraphs and
// headings. A PDF has no paragraphs, only text placed on a page, so everything here is a heuristic:
//   - lines are fragments on the same baseline; a gap wider than a space gets a space;
//   - a paragraph ends at a bigger-than-usual vertical gap, at a short line that ends a sentence, or at an indented line;
//   - a line ending in "-" and followed by a lowercase word is joined ("recon-" + "ciliation");
//   - a line set in a clearly larger type than the body text, and short, is a heading;
//   - a line that repeats at the top or bottom of many pages (a running title, a page number) is dropped;
//   - a paragraph that runs over a page break is joined.
// A wrong guess costs a paragraph break or a heading label, never lost text, except running headers that really are text.
//
// pdf.js runs in the same thread as this code (the app calls it inside a Worker already), so no second Worker is
// started and no eval is needed. Scans without a text layer are refused with a message: there is no OCR.

import { ImportError } from './doc-blocks.ts'
import type { Block, ExtractedBlocks } from './doc-blocks.ts'

interface Line { text: string; x: number; y: number; size: number; width: number }
interface Page { number: number; lines: Line[] }

export function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may follow a few bytes of junk. The spec allows up to 1024.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

async function loadPdfjs() {
  // Loading the worker module registers its message handler as globalThis.pdfjsWorker, which pdf.js then uses in this
  // thread instead of starting a Worker of its own. (In a Worker the module also announces itself to the page with a
  // "ready" message; useDocuments.ts ignores it.)
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return await import('pdfjs-dist/legacy/build/pdf.mjs')
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)]! : 0
}

type Item = { str: string; transform: number[]; width: number; hasEOL?: boolean }

/** Joins a page's text fragments into lines. */
function linesOf(items: Item[]): Line[] {
  const lines: Line[] = []
  let cur: Line | null = null
  let endX = 0
  const finish = () => { if (cur && cur.text.trim()) { cur.text = cur.text.replace(/\s+/g, ' ').trim(); lines.push(cur) } cur = null }
  for (const it of items) {
    const [a = 1, b = 0, , , x = 0, y = 0] = it.transform
    const size = Math.hypot(a, b) || 1
    if (!it.str) { if (it.hasEOL) finish(); continue }
    if (cur && Math.abs(y - cur.y) > 0.4 * Math.max(cur.size, size)) finish()
    if (!cur) {
      cur = { text: '', x, y, size, width: 0 }
    } else if (x - endX > 0.15 * size && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) {
      cur.text += ' ' // a gap with no space fragment in it
    }
    cur.text += it.str
    cur.size = Math.max(cur.size, size)
    endX = x + it.width
    cur.width = endX - cur.x
    if (it.hasEOL) finish()
  }
  finish()
  return lines
}

const key = (l: Line) => l.text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()

/** Removes lines that repeat in the first or last two lines of many pages, and bare page numbers there. */
function dropRunningText(pages: Page[]) {
  if (pages.length < 3) return
  const counts = new Map<string, number>()
  const slots = (p: Page) => [...p.lines.slice(0, 2), ...p.lines.slice(-2)]
  for (const p of pages) for (const k of new Set(slots(p).map(key))) counts.set(k, (counts.get(k) ?? 0) + 1)
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4))
  for (const p of pages) {
    const edge = new Set(slots(p))
    p.lines = p.lines.filter((l) => !edge.has(l) || ((counts.get(key(l)) ?? 0) < threshold && !/^\d{1,4}$/.test(l.text)))
  }
}

const SENTENCE_END = /[.!?:"”’')\]]$/

/** Paragraphs and headings from the lines of every page. */
function blocksOf(pages: Page[]): Block[] {
  // The body text size: the most common size, by characters.
  const bySize = new Map<number, number>()
  for (const p of pages) for (const l of p.lines) bySize.set(Math.round(l.size * 2) / 2, (bySize.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length)
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12

  // The usual distance between two lines of one paragraph, over the whole document: a page with one paragraph and a
  // heading has too few gaps to tell. Gaps over twice the body size are paragraph or section gaps, not line pitch.
  const gaps: number[] = []
  for (const p of pages) p.lines.slice(1).forEach((l, i) => { const d = p.lines[i]!.y - l.y; if (d > 0 && d < body * 2) gaps.push(d) })
  const pitch = median(gaps)

  const blocks: Block[] = []
  let para: { text: string; page: number } | null = null
  let lastHeadingSize = 0
  const endPara = () => { if (para) blocks.push({ kind: 'para', text: para.text, page: para.page }); para = null }

  for (const page of pages) {
    const lines = page.lines
    const left = median(lines.map((l) => l.x))
    const widest = Math.max(0, ...lines.map((l) => l.width))
    let prev: Line | null = null
    for (const line of lines) {
      const isHeading = line.size >= body * 1.2 && line.text.length <= 120 && !/[,;]$/.test(line.text)
      if (isHeading) {
        endPara()
        const last = blocks.at(-1)
        // A title that wraps onto a second line in the same type is one heading.
        if (last && last.kind === 'heading' && lastHeadingSize === line.size && prev && prev.size === line.size) last.text += ` ${line.text}`
        else blocks.push({ kind: 'heading', text: line.text, level: line.size >= body * 1.6 ? 1 : 2, page: page.number })
        lastHeadingSize = line.size
        prev = line
        continue
      }
      let breaks = !para
      if (para && prev) {
        const gap = prev.y - line.y
        breaks =
          (pitch > 0 && gap > pitch * 1.5) ||
          (prev.width < widest * 0.6 && SENTENCE_END.test(prev.text)) ||
          (line.x - left > line.size && SENTENCE_END.test(prev.text))
      }
      if (breaks || !para) {
        endPara()
        para = { text: line.text, page: page.number }
      } else if (/[A-Za-z]-$/.test(para.text) && /^[a-z]/.test(line.text)) {
        para.text = para.text.slice(0, -1) + line.text // "recon-" + "ciliation"
      } else {
        para.text += ` ${line.text}`
      }
      prev = line
    }
    // A paragraph may continue on the next page: it is kept open when it does not end like a sentence.
    if (para && SENTENCE_END.test(para.text)) endPara()
  }
  endPara()
  return blocks
}

/** A document title from PDF metadata, or null when it is missing or is leftover from the tool that made the file. */
function usableTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/^Microsoft Word - /i, '').trim()
  if (!t || /\.(docx?|indd|pdf|tex|pages|rtf|odt)$/i.test(t) || /^untitled/i.test(t)) return null
  return t
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedBlocks> {
  if (!looksLikePdf(bytes)) throw new ImportError('This is not a valid PDF file.')
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // a copy: pdf.js takes ownership of what it is given, and refuses a Node Buffer
    useSystemFonts: false,
    useWasm: false, // only image decoding uses it, and no images are read
    useWorkerFetch: false,
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    await task.destroy().catch(() => {})
    const name = (err as { name?: string })?.name
    if (name === 'PasswordException') throw new ImportError('This PDF is password protected. Remove the password and try again.')
    throw new ImportError('This PDF could not be read. It may be damaged.')
  }
  try {
    const pages: Page[] = []
    let chars = 0
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const lines = linesOf(content.items.filter((i) => 'str' in i) as unknown as Item[])
      chars += lines.reduce((s, l) => s + l.text.length, 0)
      pages.push({ number: n, lines })
      page.cleanup()
    }
    if (chars < 20) {
      throw new ImportError('This PDF has no text Pellikan can read. It may be a scan, and Pellikan does not read text from images yet.')
    }
    dropRunningText(pages)
    let title: string | null = null
    let author: string | null = null
    try {
      const meta = await doc.getMetadata()
      const info = (meta.info ?? {}) as Record<string, unknown>
      title = usableTitle(info.Title)
      author = typeof info.Author === 'string' && info.Author.trim() ? info.Author.trim() : null
    } catch { /* metadata is a nicety */ }
    return { title, author, blocks: blocksOf(pages) }
  } finally {
    await task.destroy()
  }
}
