// Reduces one XHTML or HTML document to headings and paragraphs, for the EPUB extractor. Everything that is not text is
// dropped: scripts, styles, images, the <head>. Block elements (p, div, li, h1..h6, ...) each become a paragraph or a
// heading; inline elements (em, a, span) contribute only their words.

import { tokenize } from './markup.ts'
import type { Block } from './doc-blocks.ts'

const BLOCK = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'tr', 'table', 'caption', 'blockquote', 'section', 'article', 'aside', 'header',
  'footer', 'main', 'pre', 'figure', 'figcaption', 'hr', 'address', 'details', 'summary', 'body',
])
const HEADING = /^h([1-6])$/
/** Elements whose contents are not part of the text. */
const SKIP = new Set(['head', 'script', 'style', 'title', 'svg', 'math', 'noscript', 'template'])

/** A footnote or note marker: "1", "[2]", "*", a dagger. Kept out of the text so "God1" does not appear. */
const NOTE_MARK = /^\s*[[(]?(?:\d{1,3}|[*†‡§])[\])]?\s*$/

export function htmlBlocks(html: string): Block[] {
  const blocks: Block[] = []
  let buf = ''
  let heading = 0 // level of the heading being read, or 0
  let skip = 0
  let pre = 0
  let sup: string | null = null // text of the <sup> being read, held until we know if it is a note marker

  const add = (text: string) => { if (sup !== null) sup += text; else buf += text }
  const flush = () => {
    const text = pre ? buf.replace(/^\n+|\s+$/g, '') : buf.replace(/\s+/g, ' ').trim()
    buf = ''
    if (!text) return
    if (heading) blocks.push({ kind: 'heading', text, level: heading })
    else blocks.push({ kind: 'para', text })
  }

  for (const tok of tokenize(html, { html: true })) {
    if (tok.t === 'text') {
      if (skip) continue
      // Non-breaking spaces are spaces for our purposes: "Rom 8:28" should still be found.
      add(pre ? tok.text.replace(/ /g, ' ') : tok.text.replace(/[\s ]+/g, ' '))
      continue
    }
    const name = tok.name
    if (tok.t === 'open') {
      if (SKIP.has(name)) { if (!tok.self) skip++; continue }
      if (skip) continue
      const h = HEADING.exec(name)
      if (h) { flush(); heading = Number(h[1]) }
      else if (BLOCK.has(name)) { flush(); if (name === 'pre') pre++ }
      else if (name === 'br') add(pre ? '\n' : ' ')
      else if (name === 'sup' && !tok.self) sup = ''
      else if ((name === 'td' || name === 'th') && !tok.self && buf && !/\s$/.test(buf)) add(' ')
      continue
    }
    // close
    if (SKIP.has(name)) { if (skip) skip--; continue }
    if (skip) continue
    if (HEADING.test(name)) { flush(); heading = 0 }
    else if (BLOCK.has(name)) { flush(); if (name === 'pre' && pre) pre-- }
    else if (name === 'sup' && sup !== null) {
      const held = sup
      sup = null
      if (!NOTE_MARK.test(held)) add(held)
    }
  }
  flush()
  return blocks
}
