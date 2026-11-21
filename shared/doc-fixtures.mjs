// Builds small EPUB, DOCX and PDF files in memory for the importer tests.
import { zipSync, strToU8 } from 'fflate'

const enc = (s) => strToU8(s)

/** A ZIP from { name: string | Uint8Array }. */
export const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc(v) : v])))

/**
 * An EPUB. `chapters` is [{ file, html, props? }]; they are listed in the manifest and spine in order.
 * `extra` adds files; `encryption` adds META-INF/encryption.xml; `opfDir` puts the package in a folder.
 */
export function makeEpub({ title = 'A Book', author = 'An Author', chapters, extra = {}, encryption = null, opfDir = 'OEBPS', skipFromArchive = [] }) {
  const prefix = opfDir ? `${opfDir}/` : ''
  const items = chapters.map((c, i) => `<item id="c${i}" href="${c.href ?? c.file}" media-type="application/xhtml+xml"${c.props ? ` properties="${c.props}"` : ''}/>`).join('')
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${prefix}content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    [`${prefix}content.opf`]: opf,
    ...extra,
  }
  for (const c of chapters) if (!skipFromArchive.includes(c.file)) files[`${prefix}${c.file}`] = c.html
  if (encryption) files['META-INF/encryption.xml'] = encryption
  return zip(files)
}

export const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>ignored</title><style>p { color: red }</style></head><body>${body}</body></html>`

/** A DOCX. `paragraphs` is XML for the body (see p() below); `styles` is the inner XML of styles.xml. */
export function makeDocx({ body, styles = '', title = null, author = null }) {
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`,
  }
  if (styles) files['word/styles.xml'] = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${styles}</w:styles>`
  if (title || author) {
    files['docProps/core.xml'] = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/">${title ? `<dc:title>${title}</dc:title>` : ''}${author ? `<dc:creator>${author}</dc:creator>` : ''}</cp:coreProperties>`
  }
  return zip(files)
}
/** A paragraph: p('text'), p('text', { style: 'Heading1' }), or p(runsXml, { raw: true }). */
export const p = (text, { style = null, outline = null, raw = false } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${outline !== null ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr>${raw ? text : `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`}</w:p>`

/**
 * A PDF with Helvetica text. `pages` is an array of arrays of lines: { text, x?, y, size? }. Written with a real
 * cross-reference table, so any reader accepts it. `info` adds a document Info dictionary.
 */
export function makePdf(pages, { info = null } = {}) {
  const objs = []
  const add = (body) => { objs.push(body); return objs.length }
  const catalog = add('')
  const pagesObj = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = []
  for (const lines of pages) {
    const stream = lines.map((l) => `BT /F1 ${l.size ?? 12} Tf ${l.x ?? 72} ${l.y} Td (${l.text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n')
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  const infoId = info ? add(`<< ${Object.entries(info).map(([k, v]) => `/${k} (${v})`).join(' ')} >>`) : 0
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${infoId ? ` /Info ${infoId} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

/** `n` body lines of one paragraph starting at y, 14 points apart. */
export const lines = (texts, y, { x = 72, size = 12 } = {}) => texts.map((text, i) => ({ text, x, y: y - i * 14, size }))
