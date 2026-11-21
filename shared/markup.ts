// A small, forgiving reader for XML and HTML, for the EPUB and DOCX extractors. Web Workers have no DOMParser, and the
// extractors have to run in one, so this is a tokenizer: tags and text, in order, with no tree.
//
// It makes one pass over the string and never backtracks, so a large book costs time in proportion to its size. It
// does not validate. Anything it cannot make sense of is passed through as text. Imported markup is only ever turned
// into plain text, never into HTML.

export type Token =
  | { t: 'open'; name: string; attrs: Record<string, string>; self: boolean }
  | { t: 'close'; name: string }
  | { t: 'text'; text: string }

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·',
  bull: '•', sect: '§', para: '¶', dagger: '†', Dagger: '‡', times: '×', minus: '−', shy: '', zwj: '', zwnj: '', thinsp: ' ',
  ensp: ' ', emsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä',
  iacute: 'í', icirc: 'î', iuml: 'ï', oacute: 'ó', ocirc: 'ô', ouml: 'ö', uacute: 'ú', ucirc: 'û', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ',
  Eacute: 'É', Aacute: 'Á', Oacute: 'Ó', Uacute: 'Ú', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', aelig: 'æ', AElig: 'Æ', oslash: 'ø',
}

/** Decodes the five XML entities, numeric references, and the common HTML names. Anything else is left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ''
    }
    return NAMED[body] ?? whole
  })
}

const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(src))) attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return attrs
}

/**
 * The tokens of `src`. With `html` set, tag names are lower-cased and the contents of <script> and <style> are skipped,
 * as HTML does; XML names keep their case and their prefix (`w:p`).
 */
export function* tokenize(src: string, opts: { html?: boolean } = {}): Generator<Token> {
  const html = opts.html ?? false
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      yield { t: 'text', text: decodeEntities(src.slice(i)) }
      return
    }
    if (lt > i) yield { t: 'text', text: decodeEntities(src.slice(i, lt)) }
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      i = end < 0 ? n : end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      yield { t: 'text', text: src.slice(i + 9, end < 0 ? n : end) }
      i = end < 0 ? n : end + 3
    } else if (src[i + 1] === '?' || src[i + 1] === '!') {
      // A processing instruction or DOCTYPE. A DOCTYPE may hold an internal subset in [...] that contains '>'.
      let depth = 0
      let j = i + 2
      for (; j < n; j++) {
        const c = src[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      i = j + 1
    } else {
      const close = src[i + 1] === '/'
      let j = i + (close ? 2 : 1)
      const nameStart = j
      while (j < n && !/[\s/>]/.test(src[j]!)) j++
      let name = src.slice(nameStart, j)
      if (!name || !/^[A-Za-z_]/.test(name)) {
        // A lone "<" in text, not a tag.
        yield { t: 'text', text: '<' }
        i++
        continue
      }
      // Find the end of the tag, skipping over quoted attribute values.
      let quote = ''
      const attrStart = j
      for (; j < n; j++) {
        const c = src[j]!
        if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (html) name = name.toLowerCase()
      if (close) {
        yield { t: 'close', name }
      } else {
        const raw = src.slice(attrStart, j)
        const self = raw.endsWith('/')
        yield { t: 'open', name, attrs: parseAttrs(self ? raw.slice(0, -1) : raw), self }
        if (html && !self && (name === 'script' || name === 'style')) {
          const end = src.toLowerCase().indexOf(`</${name}`, j)
          j = end < 0 ? n : src.indexOf('>', end)
          if (j < 0) j = n
          yield { t: 'close', name }
        }
      }
      i = j + 1
    }
  }
}

/** The text of the first `<name>...</name>` in `src`, entities decoded, or null. For small metadata files. */
export function firstText(src: string, name: string): string | null {
  let inside = false
  let out = ''
  for (const tok of tokenize(src)) {
    if (tok.t === 'open' && tok.name === name && !tok.self) { inside = true; out = '' }
    else if (tok.t === 'close' && tok.name === name && inside) return out.trim() || null
    else if (tok.t === 'text' && inside) out += tok.text
  }
  return null
}
