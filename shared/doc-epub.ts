// EPUB: a ZIP holding XHTML chapters, listed in reading order (the "spine") by a package file (the OPF) that META-INF/
// container.xml points to. The chapters become headings and paragraphs; the title and author come from the package
// metadata.
//
// Not handled: DRM (refused with a message, not read as gibberish), and text that is only in images.

import { firstText, tokenize } from './markup.ts'
import { decodeXmlBytes, looksLikeZip, readZip } from './zip.ts'
import { htmlBlocks } from './html-blocks.ts'
import { ImportError } from './doc-blocks.ts'
import type { Block, ExtractedBlocks } from './doc-blocks.ts'

/** Resolves a manifest href against the folder of the package file, undoing URL escapes and dropping a #fragment. */
function resolve(dir: string, href: string): string {
  let path = href.split('#')[0]!
  try { path = decodeURIComponent(path) } catch { /* keep it as written */ }
  const parts = (path.startsWith('/') ? path.slice(1) : dir + path).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

interface Item { href: string; type: string; props: string }

export function extractEpub(bytes: Uint8Array): ExtractedBlocks {
  if (!looksLikeZip(bytes)) throw new ImportError('This is not a valid EPUB file (it is not a ZIP archive).')

  // Read the small files first, then only the chapters the spine names.
  const meta = readZip(bytes, (n) => n === 'META-INF/container.xml' || n === 'META-INF/encryption.xml' || /\.opf$/i.test(n))
  const container = meta['META-INF/container.xml']
  if (!container) throw new ImportError('This is not a valid EPUB file: it has no META-INF/container.xml.')
  let opfPath: string | null = null
  for (const tok of tokenize(decodeXmlBytes(container))) {
    if (tok.t === 'open' && tok.name === 'rootfile' && tok.attrs['full-path']) { opfPath = tok.attrs['full-path']; break }
  }
  const opfBytes = opfPath ? meta[opfPath] : undefined
  if (!opfPath || !opfBytes) throw new ImportError('This is not a valid EPUB file: its package file is missing.')
  const opf = decodeXmlBytes(opfBytes)
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const manifest = new Map<string, Item>()
  const spine: string[] = []
  for (const tok of tokenize(opf)) {
    if (tok.t !== 'open') continue
    if (tok.name === 'item' && tok.attrs.id && tok.attrs.href) {
      manifest.set(tok.attrs.id, { href: resolve(dir, tok.attrs.href), type: tok.attrs['media-type'] ?? '', props: tok.attrs.properties ?? '' })
    } else if (tok.name === 'itemref' && tok.attrs.idref) {
      spine.push(tok.attrs.idref)
    }
  }
  const title = firstText(opf, 'dc:title')
  const author = firstText(opf, 'dc:creator')

  const chapters = spine
    .map((id) => manifest.get(id))
    .filter((it): it is Item => !!it && /x?html/i.test(it.type) && !/\bnav\b/.test(it.props)) // the navigation document repeats the headings
  if (!chapters.length) throw new ImportError('No readable chapters were found in this EPUB.')

  // DRM: encryption.xml lists encrypted files. Font obfuscation also appears there, so only a chapter being listed counts.
  const enc = meta['META-INF/encryption.xml']
  if (enc) {
    const listed = decodeXmlBytes(enc)
    for (const ch of chapters) {
      const name = ch.href
      if (listed.includes(`"${name}"`) || listed.includes(`'${name}'`)) {
        throw new ImportError('This EPUB is protected by DRM, so Pellikan cannot read it. Pellikan does not remove DRM.')
      }
    }
  }

  const wanted = new Set(chapters.map((c) => c.href))
  const files = readZip(bytes, (n) => wanted.has(n))
  const blocks: Block[] = []
  for (const ch of chapters) {
    const data = files[ch.href]
    if (!data) continue // listed in the spine but not in the archive: skip it rather than refuse the whole book
    blocks.push(...htmlBlocks(decodeXmlBytes(data)))
  }
  return { title, author, blocks }
}
