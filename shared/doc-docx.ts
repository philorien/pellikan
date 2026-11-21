// DOCX: a ZIP whose body is word/document.xml. Each <w:p> is a paragraph; a paragraph whose style is a heading (or has
// an outline level) is a heading. Text is in <w:t>. The title and author come from docProps/core.xml.
//
// Read: the body, including table cells and text boxes. Left out: tracked deletions, field codes, headers, footers and
// footnotes. Not supported: the old binary .doc format (a different file type that happens to share the extension).

import { firstText, tokenize } from './markup.ts'
import { decodeXmlBytes, looksLikeZip, readZip } from './zip.ts'
import { ImportError } from './doc-blocks.ts'
import type { Block, ExtractedBlocks } from './doc-blocks.ts'

interface Style { name: string; outline: number | null }

/** style id -> name and outline level, from word/styles.xml. */
function readStyles(xml: string): Map<string, Style> {
  const styles = new Map<string, Style>()
  let id: string | null = null
  for (const tok of tokenize(xml)) {
    if (tok.t === 'open' && tok.name === 'w:style' && !tok.self) {
      id = tok.attrs['w:styleId'] ?? null
      if (id) styles.set(id, { name: '', outline: null })
    } else if (tok.t === 'close' && tok.name === 'w:style') {
      id = null
    } else if (tok.t === 'open' && id) {
      const style = styles.get(id)!
      if (tok.name === 'w:name') style.name = tok.attrs['w:val'] ?? ''
      else if (tok.name === 'w:outlineLvl') style.outline = Number(tok.attrs['w:val'])
    }
  }
  return styles
}

/** The heading level (1 to 6) a style or paragraph outline level makes, or 0 for body text. */
function headingLevel(style: Style | undefined, outline: number | null): number {
  const lvl = outline ?? style?.outline ?? null
  if (lvl !== null && Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) return Math.min(lvl + 1, 6)
  const name = style?.name ?? ''
  const m = /^heading\s*(\d)$/i.exec(name)
  if (m) return Math.min(Number(m[1]), 6)
  if (/^title$/i.test(name)) return 1
  return 0
}

export function extractDocx(bytes: Uint8Array): ExtractedBlocks {
  if (!looksLikeZip(bytes)) {
    throw new ImportError(
      bytes[0] === 0xd0 && bytes[1] === 0xcf
        ? 'This is an old Word file (.doc). Open it in Word and save it as .docx, then import that.'
        : 'This is not a valid DOCX file (it is not a ZIP archive).',
    )
  }
  const files = readZip(bytes, (n) => n === 'word/document.xml' || n === 'word/styles.xml' || n === 'docProps/core.xml')
  const body = files['word/document.xml']
  if (!body) throw new ImportError('This is not a valid DOCX file: it has no word/document.xml.')
  const styles = files['word/styles.xml'] ? readStyles(decodeXmlBytes(files['word/styles.xml'])) : new Map<string, Style>()
  const core = files['docProps/core.xml'] ? decodeXmlBytes(files['docProps/core.xml']) : ''

  const blocks: Block[] = []
  let inPara = false
  let text = ''
  let styleId: string | null = null
  let outline: number | null = null
  let inText = false
  const outer: Array<[string, string | null, number | null]> = [] // a text box holds paragraphs inside a paragraph
  let skip = 0 // depth inside content that is not part of the text: field codes, deleted text, the fallback copy of a text box
  const SKIP = new Set(['w:instrText', 'w:delText', 'w:del', 'mc:Fallback'])

  for (const tok of tokenize(decodeXmlBytes(body))) {
    if (tok.t === 'text') {
      if (inText && !skip) text += tok.text
      continue
    }
    if (tok.t === 'open') {
      if (SKIP.has(tok.name)) { if (!tok.self) skip++; continue }
      if (skip) continue
      switch (tok.name) {
        case 'w:p':
          if (!tok.self) {
            if (inPara) outer.push([text, styleId, outline])
            inPara = true; text = ''; styleId = null; outline = null
          }
          break
        case 'w:pStyle': if (inPara) styleId = tok.attrs['w:val'] ?? null; break
        case 'w:outlineLvl': if (inPara) outline = Number(tok.attrs['w:val']); break
        case 'w:t': if (!tok.self) inText = true; break
        case 'w:tab': if (inPara) text += ' '; break
        case 'w:br': case 'w:cr': if (inPara) text += tok.attrs['w:type'] === 'page' ? ' ' : '\n'; break
        case 'w:noBreakHyphen': if (inPara) text += '-'; break
      }
      continue
    }
    if (SKIP.has(tok.name)) { if (skip) skip--; continue }
    if (skip) continue
    if (tok.name === 'w:t') inText = false
    else if (tok.name === 'w:p' && inPara) {
      const clean = text.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
      if (clean) {
        const level = headingLevel(styleId ? styles.get(styleId) : undefined, outline)
        // A long paragraph is not a heading however it is styled: some documents style whole body text as "Heading 1".
        if (level && clean.length <= 200 && !clean.includes('\n')) blocks.push({ kind: 'heading', text: clean, level })
        else blocks.push({ kind: 'para', text: clean })
      }
      const saved = outer.pop()
      if (saved) [text, styleId, outline] = saved
      else inPara = false
    }
  }
  return { title: firstText(core, 'dc:title'), author: firstText(core, 'dc:creator'), blocks }
}
