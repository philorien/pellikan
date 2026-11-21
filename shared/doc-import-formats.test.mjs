import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { extractFile, formatOf, maxBytesFor, MAX_IMPORT_BYTES } from './doc-import.ts'
import { tokenize, decodeEntities, firstText } from './markup.ts'
import { htmlBlocks } from './html-blocks.ts'
import { readZip, looksLikeZip } from './zip.ts'
import { makeEpub, makeDocx, makePdf, xhtml, p, lines, zip } from './doc-fixtures.mjs'

const rejects = (promise, pattern) => assert.rejects(promise, (err) => { assert.match(err.message, pattern); return true })

// ---------------------------------------------------------------------------------------------
// File types
// ---------------------------------------------------------------------------------------------

test('EPUB, DOCX and PDF are recognised by extension, with their own size limits', () => {
  assert.equal(formatOf('Book.EPUB'), 'epub')
  assert.equal(formatOf('notes.docx'), 'docx')
  assert.equal(formatOf('scan.pdf'), 'pdf')
  assert.equal(formatOf('old.doc'), null) // the binary Word format is a different file type
  assert.equal(maxBytesFor('txt'), MAX_IMPORT_BYTES)
  assert.ok(maxBytesFor('pdf') > maxBytesFor('txt'))
})

// ---------------------------------------------------------------------------------------------
// The markup reader
// ---------------------------------------------------------------------------------------------

test('entities: the XML five, numeric references, and common HTML names; unknown ones are kept', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), 'a & b <c> "d" \'e\'')
  assert.equal(decodeEntities('&#8212; &#x2014; &mdash; &nbsp;|&eacute;'), '— — —  |é')
  assert.equal(decodeEntities('&bogus; &#0; &#xD800; & alone'), '&bogus;   & alone')
})

test('the tokenizer handles comments, CDATA, processing instructions, a DOCTYPE subset, quoted ">" and a lone "<"', () => {
  const src = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b>c">]><r><!-- <skipped> --><a href="x>y" title=\'q\'>t</a><![CDATA[<raw>]]> 1 < 2<br/></r>'
  const out = [...tokenize(src)].map((t) => (t.t === 'text' ? `"${t.text}"` : t.t === 'open' ? `<${t.name}${t.self ? '/' : ''}${Object.keys(t.attrs).length ? JSON.stringify(t.attrs) : ''}>` : `</${t.name}>`))
  assert.deepEqual(out, ['<r>', '<a{"href":"x>y","title":"q"}>', '"t"', '</a>', '"<raw>"', '" 1 "', '"<"', '" 2"', '<br/>', '</r>'])
})

test('in HTML mode names are lower-cased and script and style contents are skipped', () => {
  const out = [...tokenize('<P>a</P><SCRIPT>if (a < b) x()</SCRIPT><style>p{}</style>b', { html: true })].map((t) => t.t === 'text' ? t.text : t.name)
  assert.deepEqual(out, ['p', 'a', 'p', 'script', 'script', 'style', 'style', 'b'])
})

test('the tokenizer reads a large document in one quick pass', () => {
  const big = '<p class="a">Some <em>marked</em> text &amp; more.</p>\n'.repeat(150_000) // about 8 MB
  const t0 = performance.now()
  let n = 0
  for (const tok of tokenize(big, { html: true })) if (tok.t === 'text') n++
  assert.ok(n > 400_000)
  assert.ok(performance.now() - t0 < 5000, 'no backtracking blow-up')
})

test('firstText finds a metadata element', () => {
  assert.equal(firstText('<m><dc:title> A &amp; B </dc:title><dc:title>second</dc:title></m>', 'dc:title'), 'A & B')
  assert.equal(firstText('<m/>', 'dc:title'), null)
})

test('HTML becomes headings and paragraphs; scripts, styles and note markers are dropped', () => {
  const blocks = htmlBlocks(xhtml('<h1>Chapter <em>One</em></h1><p>God<sup>1</sup> so loved<br/>the world.<script>x()</script></p><div>Para&nbsp;two<a href="#n"><sup>[2]</sup></a>.</div><ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table><pre>l1\nl2</pre><p>x<sup>note text</sup></p>'))
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'Chapter One', level: 1 },
    { kind: 'para', text: 'God so loved the world.' },
    { kind: 'para', text: 'Para two.' },
    { kind: 'para', text: 'one' },
    { kind: 'para', text: 'two' },
    { kind: 'para', text: 'a b' },
    { kind: 'para', text: 'l1\nl2' },
    { kind: 'para', text: 'xnote text' }, // a <sup> that is not a note marker is text
  ])
})

// ---------------------------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------------------------

const chapters = [
  { file: 'ch1.xhtml', html: xhtml('<h1>Romans 8</h1><p>Notes on the chapter (v. 28) and <a href="x">Rom. 8:1</a>.</p>') },
  { file: 'text/ch%202.xhtml', href: 'text/ch%202.xhtml', html: xhtml('<h2>Second</h2><p>More text.</p>') },
]

test('an EPUB is read in spine order, with its title and author, and references found using the chapter heading', async () => {
  const bytes = makeEpub({
    title: 'Notes &amp; Studies', author: 'A. Writer',
    chapters: [...chapters, { file: 'nav.xhtml', props: 'nav', html: xhtml('<h1>Contents</h1><p>Skip me</p>') }],
    extra: { 'OEBPS/text/ch 2.xhtml': chapters[1].html, 'OEBPS/cover.jpg': new Uint8Array(1000) },
  })
  const doc = await extractFile(bytes, 'epub', 'x.epub')
  assert.equal(doc.title, 'Notes & Studies')
  assert.equal(doc.author, 'A. Writer')
  assert.deepEqual(doc.chunks.map((c) => [c.heading, c.text]), [
    ['Romans 8', 'Notes on the chapter (v. 28) and Rom. 8:1.'],
    ['Second', 'More text.'],
  ])
  const refs = doc.chunks[0].refs.map((r) => `${r.book}.${r.chapter}.${r.from}-${r.to}.${r.confidence}`)
  assert.ok(refs.includes('45.8.1-1.high'))
  assert.ok(refs.includes('45.8.28-28.medium'), 'a "(v. 28)" resolved from the "Romans 8" heading')
})

test('an EPUB whose package is at the top level, with a chapter missing from the archive, still imports the rest', async () => {
  const bytes = makeEpub({ opfDir: '', chapters: [chapters[0], { file: 'gone.xhtml', html: '' }], skipFromArchive: ['gone.xhtml'] })
  const doc = await extractFile(bytes, 'epub', 'x.epub')
  assert.equal(doc.chunks.length, 1)
})

test('an EPUB that is DRM-protected is refused with a message, not read as gibberish', async () => {
  const bytes = makeEpub({
    chapters: [chapters[0]],
    encryption: '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData></EncryptedData></encryption>'.replace('URI="OEBPS/ch1.xhtml"', 'URI="OEBPS/ch1.xhtml"'),
  })
  // encryption.xml names files with a URI attribute; the extractor matches on the quoted path.
  await rejects(extractFile(bytes, 'epub', 'x.epub'), /DRM/)
})

test('font obfuscation in encryption.xml is not DRM', async () => {
  const bytes = makeEpub({ chapters: [chapters[0]], encryption: '<encryption><EncryptedData><CipherReference URI="OEBPS/fonts/a.otf"/></EncryptedData></encryption>' })
  assert.equal((await extractFile(bytes, 'epub', 'x.epub')).chunks.length, 1)
})

test('files that are not EPUBs are refused with a clear message', async () => {
  await rejects(extractFile(new TextEncoder().encode('just text'), 'epub', 'x.epub'), /not a valid EPUB/)
  await rejects(extractFile(zip({ 'a.txt': 'x' }), 'epub', 'x.epub'), /container\.xml/)
  await rejects(extractFile(makeEpub({ chapters: [{ file: 'a.png', html: 'x' }].map((c) => ({ ...c, file: 'a.xhtml', html: '' })) }).subarray(0, 40), 'epub', 'x.epub'), /damaged|not a valid/)
})

// ---------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------

const STYLES = '<w:style w:styleId="Kop1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Big"><w:name w:val="Big"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style><w:style w:styleId="Title"><w:name w:val="Title"/></w:style>'

test('a DOCX gives headings from styles, paragraphs, tabs, breaks and table cells; deleted text and field codes are left out', async () => {
  const body = [
    p('A Title', { style: 'Title' }),
    p('Romans 8', { style: 'Kop1' }), // a localised style id, named by styles.xml
    p('A sub heading', { style: 'Big' }), // a style with an outline level
    p('Plain paragraph with Rom. 8:28.'),
    p('<w:r><w:t>one</w:t></w:r><w:r><w:tab/><w:t>two</w:t></w:r><w:r><w:br/><w:t>three</w:t></w:r><w:r><w:br w:type="page"/><w:t>four</w:t></w:r>', { raw: true }),
    p('<w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r>', { raw: true }),
    '<w:tbl><w:tr><w:tc>' + p('cell A') + '</w:tc><w:tc>' + p('cell B') + '</w:tc></w:tr></w:tbl>',
    p('Anchor <w:r><w:t>text </w:t></w:r><w:r><mc:AlternateContent><mc:Choice><w:txbxContent>' + p('inside a box') + '</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>' + p('inside a box') + '</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>after</w:t></w:r>', { raw: true }).replace('Anchor ', ''),
    p('x'.repeat(300), { style: 'Kop1' }), // a whole body paragraph styled as a heading is not a heading
    p('   '),
  ].join('')
  const doc = await extractFile(makeDocx({ body, styles: STYLES, title: 'Doc &amp; Title', author: 'Me' }), 'docx', 'x.docx')
  assert.equal(doc.title, 'Doc & Title')
  assert.equal(doc.author, 'Me')
  const all = doc.chunks.map((c) => `${c.heading ?? '-'}: ${c.text}`).join('\n=====\n')
  assert.match(all, /A sub heading: Plain paragraph with Rom\. 8:28\./) // the nearest heading above it
  assert.match(all, /one two\nthree four/) // a line break stays one; a page break is a space
  assert.match(all, /kept/)
  assert.doesNotMatch(all, /deleted|PAGE/)
  assert.match(all, /cell A\n\ncell B/)
  assert.equal((all.match(/inside a box/g) ?? []).length, 1, 'the fallback copy of a text box is not read twice')
  assert.match(all, /text after/, 'the paragraph around a text box keeps its own text')
  assert.match(all, /x{300}/)
  assert.ok(doc.chunks.some((c) => c.heading === 'Romans 8') === false, 'a later heading replaces an earlier one with nothing between')
})

test('a DOCX with no title falls back to the file name', async () => {
  const doc = await extractFile(makeDocx({ body: p('Text here.') }), 'docx', 'my_notes.docx')
  assert.equal(doc.title, 'my notes')
  assert.equal(doc.author, null)
})

test('an old binary .doc and a non-ZIP are refused with different messages', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  await rejects(extractFile(ole, 'docx', 'x.docx'), /old Word file/)
  await rejects(extractFile(new TextEncoder().encode('hello there'), 'docx', 'x.docx'), /not a valid DOCX/)
  await rejects(extractFile(zip({ 'a.txt': 'x' }), 'docx', 'x.docx'), /word\/document\.xml/)
  await rejects(extractFile(makeDocx({ body: p(' ') }), 'docx', 'x.docx'), /No text was found/)
})

// ---------------------------------------------------------------------------------------------
// ZIP safety
// ---------------------------------------------------------------------------------------------

test('only the requested entries are inflated', () => {
  const bytes = zip({ 'a.txt': 'aaa', 'b.txt': 'bbb', 'img/c.png': new Uint8Array(100) })
  assert.deepEqual(Object.keys(readZip(bytes, (n) => n.endsWith('.txt'))).sort(), ['a.txt', 'b.txt'])
  assert.equal(looksLikeZip(bytes), true)
  assert.equal(looksLikeZip(new Uint8Array([1, 2, 3, 4, 5, 6])), false)
})

/** Rewrites the declared uncompressed size in every header of a ZIP, to simulate an archive that lies. */
function lieAboutSize(bytes, size) {
  const out = bytes.slice()
  const dv = new DataView(out.buffer)
  for (let i = 0; i < out.length - 30; i++) {
    const sig = dv.getUint32(i, true)
    if (sig === 0x04034b50) dv.setUint32(i + 22, size, true)
    if (sig === 0x02014b50) dv.setUint32(i + 24, size, true)
  }
  return out
}

test('an entry that declares a huge size is refused before anything is inflated', () => {
  const bytes = lieAboutSize(zip({ 'a.txt': 'small' }), 200 * 1024 * 1024)
  assert.throws(() => readZip(bytes, () => true), /far larger than any book/)
})

test('an entry that lies about being small is cut off at the size it declared, not inflated in full', () => {
  const bomb = zipSync({ 'a.txt': new Uint8Array(40 * 1024 * 1024).fill(65) }) // 40 MB of "A" in about 40 KB
  const out = readZip(lieAboutSize(bomb, 1000), () => true)
  assert.equal(out['a.txt'].length, 1000)
})

test('many entries that together declare too much are refused', () => {
  const files = {}
  for (let i = 0; i < 4; i++) files[`f${i}.txt`] = 'x'
  const bytes = lieAboutSize(zip(files), 60 * 1024 * 1024) // each under the per-entry limit, together over the total
  assert.throws(() => readZip(bytes, () => true), /far more text than a book/)
})

test('a damaged archive is refused with a message', async () => {
  const bytes = makeDocx({ body: p('Text.') })
  const cut = bytes.subarray(0, Math.floor(bytes.length / 2))
  await rejects(extractFile(cut, 'docx', 'x.docx'), /damaged|not a valid/)
})

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

const running = (n) => [{ text: 'The Book of Notes', y: 760 }, { text: String(n), y: 40, x: 300 }]

test('a PDF gives headings, paragraphs and page locations, and drops running headers and page numbers', async () => {
  const pdf = makePdf([
    [...running(1), { text: 'Chapter One', y: 700, size: 22 }, ...lines(['In Romans 8:28 Paul writes that all things work to-', 'gether for good, and the apostle means it.', 'A third line of the same paragraph.'], 660), ...lines(['A new paragraph after a gap.'], 590)],
    [...running(2), ...lines(['This paragraph is cut by the page and continues'], 700), ...lines(['here without a capital letter.'], 686)],
    [...running(3), ...lines(['Third page.'], 700)],
    [...running(4), ...lines(['Fourth page.'], 700)],
  ], { info: { Title: 'The Real Title', Author: 'Some One' } })
  const doc = await extractFile(pdf, 'pdf', 'x.pdf')
  assert.equal(doc.title, 'The Real Title')
  assert.equal(doc.author, 'Some One')
  const text = doc.chunks.map((c) => c.text).join('\n')
  assert.doesNotMatch(text, /Book of Notes/, 'the running header is gone')
  assert.doesNotMatch(text, /^\d$/m, 'page numbers are gone')
  assert.match(text, /work together for good/, 'a hyphenated word is joined')
  assert.match(text, /A third line of the same paragraph\.\n\nA new paragraph after a gap\./)
  assert.match(text, /continues here without a capital letter\./, 'a sentence across a page break is joined')
  assert.equal(doc.chunks[0].heading, 'Chapter One')
  assert.equal(doc.chunks[0].loc, 'pp. 1-4')
  assert.deepEqual(doc.chunks[0].refs.map((r) => [r.book, r.chapter, r.from, r.confidence]), [[45, 8, 28, 'high']])
})

test('PDF chunks name the page they start on, and a long book is split with locations that follow the pages', async () => {
  const pages = []
  for (let n = 1; n <= 6; n++) pages.push([...running(n), ...lines(Array.from({ length: 30 }, (_, i) => `Page ${n} line ${i} has some words in it to fill the page out.`), 720)])
  const doc = await extractFile(makePdf(pages), 'pdf', 'x.pdf')
  assert.ok(doc.chunks.length > 1)
  assert.ok(doc.chunks.every((c) => /^pp?\. \d/.test(c.loc)))
  assert.equal(doc.chunks[0].loc.startsWith('p. 1') || doc.chunks[0].loc.startsWith('pp. 1'), true)
  assert.ok(doc.chunks.at(-1).loc.endsWith('6'))
})

test('a PDF with no text layer, a non-PDF, and a damaged PDF are each refused with a message', async () => {
  await rejects(extractFile(makePdf([[{ text: ' ', y: 700 }]]), 'pdf', 'scan.pdf'), /no text Pellikan can read/)
  await rejects(extractFile(new TextEncoder().encode('not a pdf at all'), 'pdf', 'x.pdf'), /not a valid PDF/)
  const good = makePdf([lines(['Some text on a page that is long enough.'], 700)])
  await rejects(extractFile(new TextEncoder().encode('%PDF-1.4\ngarbage that is not a pdf body'), 'pdf', 'x.pdf'), /could not be read/)
  assert.equal((await extractFile(good, 'pdf', 'x.pdf')).chunks.length, 1)
})

test('junk PDF titles left by other tools are not used', async () => {
  for (const Title of ['Microsoft Word - draft.docx', 'Untitled', 'thing.indd']) {
    const doc = await extractFile(makePdf([lines(['Some text on a page that is long enough.'], 700)], { info: { Title } }), 'pdf', 'my_book.pdf')
    assert.equal(doc.title, 'my book', Title)
  }
})

test('extractFile reads bytes for text formats too, and refuses text for binary ones', async () => {
  const doc = await extractFile(new TextEncoder().encode('# Romans 8\n\nSee Rom. 8:28.'), 'md', 'x.md')
  assert.equal(doc.title, 'Romans 8')
  await assert.rejects(extractFile('text', 'pdf', 'x.pdf'), /has to be read as bytes/)
})

test('a Node Buffer is accepted for every format, and the caller\'s bytes are left intact', async () => {
  const pdf = Buffer.from(makePdf([lines(['Some text on a page that is long enough.'], 700)]))
  const before = Buffer.from(pdf)
  assert.equal((await extractFile(pdf, 'pdf', 'x.pdf')).chunks.length, 1)
  assert.deepEqual(pdf, before, 'extraction does not detach or change the input')
  assert.equal((await extractFile(Buffer.from(makeDocx({ body: p('Hello there.') })), 'docx', 'x.docx')).chunks.length, 1)
})
