import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDocument, formatOf, titleFromFileName, textProblem, MAX_IMPORT_BYTES } from './doc-import.ts'

/** "Rom 8:28" style strings for a chunk's references. */
const refs = (chunk) => chunk.refs.map((r) => `${r.book}.${r.chapter}:${r.from}${r.to !== r.from ? '-' + r.to : ''}${r.confidence === 'medium' ? '?' : ''}`)
const ROM = 45

test('formatOf and titleFromFileName', () => {
  assert.equal(formatOf('notes.TXT'), 'txt')
  assert.equal(formatOf('notes.md'), 'md')
  assert.equal(formatOf('notes.markdown'), 'md')
  assert.equal(formatOf('book.epub'), null)
  assert.equal(formatOf('book.pdf'), null)
  assert.equal(formatOf('noextension'), null)
  assert.equal(titleFromFileName('my_notes-on-romans.md'), 'my notes on romans')
  assert.equal(titleFromFileName('Romans 8-9 notes.txt'), 'Romans 8-9 notes')
  assert.equal(titleFromFileName('Part - Two.txt'), 'Part - Two')
  assert.equal(titleFromFileName('C:\\Users\\me\\Sermon 12.txt'), 'Sermon 12')
  assert.equal(titleFromFileName('.md'), 'Untitled')
  assert.ok(MAX_IMPORT_BYTES >= 1024 * 1024)
})

test('text that is not text is refused with a message for the user', () => {
  assert.match(textProblem(''), /empty/)
  assert.match(textProblem('   \n\n  '), /empty/)
  assert.match(textProblem('caf\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd'), /UTF-8/)
  assert.match(textProblem('\u0001\u0002\u0003\u0004\u0005\u0006 binary'), /UTF-8/)
  assert.equal(textProblem('Plain text, with a tab\tand a form feed\f and accents: caf\u00e9.'), null)
  assert.throws(() => extractDocument('', 'txt', 'a.txt'), /empty/)
  assert.throws(() => extractDocument('# Heading only\n', 'md', 'a.md'), /No text was found/)
})

test('markdown: title, author, headings, and markup reduced to words', () => {
  const doc = extractDocument(
    [
      '---',
      'title: "Notes on Romans"',
      'author: A. Writer',
      'tags: [study]',
      '---',
      '# Ignored because the front matter names the book',
      '',
      '## Romans 8',
      '',
      'Paul writes **no condemnation** (see [Rom 8:1](https://example.com/x)) and _life_ in the *Spirit*.',
      '',
      '> A quotation: <em>all things</em> work together.',
      '',
      '```',
      'code stays as written',
      '```',
    ].join('\n'),
    'md',
    'notes.md',
  )
  assert.equal(doc.title, 'Notes on Romans')
  assert.equal(doc.author, 'A. Writer')
  assert.equal(doc.chunks.length, 1) // three short paragraphs under one heading are one chunk
  assert.equal(doc.chunks[0].heading, 'Romans 8')
  assert.equal(doc.chunks[0].text, 'Paul writes no condemnation (see Rom 8:1) and life in the Spirit.\n\nA quotation: all things work together.\n\ncode stays as written')
})

test('markdown without front matter takes its title from the first top-level heading', () => {
  const doc = extractDocument('# The Book\n\n## One\n\nText.\n', 'md', 'file.md')
  assert.equal(doc.title, 'The Book')
  assert.equal(doc.author, null)
  assert.deepEqual(doc.chunks.map((c) => [c.heading, c.text]), [['One', 'Text.']])
  assert.equal(extractDocument('Just text.\n', 'md', 'my_file.md').title, 'my file')
})

test('markdown markup that is not markup is left alone', () => {
  const doc = extractDocument('snake_case_name and 2 * 3 * 4 and a_b_c, plus **bold** and `code`.\n', 'md', 'a.md')
  assert.equal(doc.chunks[0].text, 'snake_case_name and 2 * 3 * 4 and a_b_c, plus bold and code.')
})

test('references are found per chunk, with a range stored one chapter at a time', () => {
  const doc = extractDocument('Paul writes in Rom 8:28; 9:5 and Gen 1:1-2:3.\n', 'txt', 'a.txt')
  assert.deepEqual(refs(doc.chunks[0]), [`${ROM}.8:28`, `${ROM}.9:5`, '1.1:1-31', '1.2:1-3'])
  assert.deepEqual(doc.chunks[0].refs.map((r) => r.confidence), ['high', 'high', 'high', 'high'])
})

test('a repeated citation is stored once, at its strongest confidence', () => {
  // "Romans 8" alone is medium; "Rom 8:1-39" written out in full is high and covers the same verses.
  const doc = extractDocument('In Romans 8 Paul begins. Later, Rom 8:1-39 is the whole of it, and Rom 8:28 again, Rom 8:28.\n', 'txt', 'a.txt')
  const all = refs(doc.chunks[0])
  assert.deepEqual(all, [`${ROM}.8:1-39`, `${ROM}.8:28`])
  assert.ok(doc.chunks[0].refs.every((r) => r.confidence === 'high'))
})

test('high confidence references come first', () => {
  const doc = extractDocument('Read Psalm 23 and then John 3:16.\n', 'txt', 'a.txt')
  assert.deepEqual(doc.chunks[0].refs.map((r) => r.confidence), ['high', 'medium'])
})

test('a verse-only mention takes its chapter from the chunk\'s heading', () => {
  const doc = extractDocument('# Notes\n\n## Romans 8\n\nPaul turns to the Spirit (v. 5) and ends with vv. 31-39.\n', 'md', 'a.md')
  assert.equal(doc.chunks[0].heading, 'Romans 8')
  assert.deepEqual(refs(doc.chunks[0]).sort(), [`${ROM}.8:1-39?`, `${ROM}.8:31-39?`, `${ROM}.8:5?`].sort())
})

test('the heading is scanned too, so a chunk under "Romans 8:28" cites it', () => {
  const doc = extractDocument('## Romans 8:28-30\n\nThe chain is unbroken.\n', 'md', 'a.md')
  assert.deepEqual(refs(doc.chunks[0]), [`${ROM}.8:28-30`])
})

test('a heading does not leak into the next section', () => {
  const doc = extractDocument('## Romans 8\n\nFirst.\n\n## Philemon\n\nSecond, see (v. 5).\n', 'md', 'a.md')
  assert.deepEqual(doc.chunks.map((c) => c.heading), ['Romans 8', 'Philemon'])
  assert.deepEqual(refs(doc.chunks[1]), []) // "Philemon" alone is not a chapter, and the earlier heading is not its topic
})

test('hard-wrapped text keeps its line breaks, and a citation may wrap once', () => {
  const doc = extractDocument('The apostle says (Rom.\n8:28) that all things work\ntogether.\n', 'txt', 'a.txt')
  assert.equal(doc.chunks[0].text, 'The apostle says (Rom.\n8:28) that all things work\ntogether.')
  assert.deepEqual(refs(doc.chunks[0]), [`${ROM}.8:28`])
})

test('plain text headings: chapter markers and short lines in capitals', () => {
  const doc = extractDocument(
    ['THE EPISTLE TO THE ROMANS', '', 'CHAPTER I.', '', 'Paul, a servant of Jesus Christ.', '', 'Chapter 2: Judgment', '', 'Therefore thou art inexcusable.', '', 'He said no.', '', 'It is finished.'].join('\n'),
    'txt',
    'romans.txt',
  )
  assert.deepEqual(doc.chunks.map((c) => c.heading), ['CHAPTER I.', 'Chapter 2: Judgment'])
  assert.equal(doc.chunks[1].text, 'Therefore thou art inexcusable.\n\nHe said no.\n\nIt is finished.')
  // The all-caps first line is a heading too, with nothing under it: it names no chunk.
  assert.equal(doc.chunks.length, 2)
})

test('short ordinary lines are not headings', () => {
  const doc = extractDocument('Part of the reason.\n\nHe said no.\n\nAMEN.\n\nOK\n', 'txt', 'a.txt')
  assert.equal(doc.chunks.length, 1)
  assert.equal(doc.chunks[0].heading, null)
  assert.equal(doc.chunks[0].text, 'Part of the reason.\n\nHe said no.\n\nAMEN.\n\nOK')
})

test('chunks are about 1,500 characters, never cross a heading, and never exceed 2,500', () => {
  const para = (n) => `Sentence ${n} of a long paragraph about grace and faith.`.repeat(1)
  const body = (count) => Array.from({ length: count }, (_, i) => para(i)).join(' ')
  const doc = extractDocument(['## One', '', body(10), '', body(10), '', body(10), '', '## Two', '', body(5)].join('\n'), 'md', 'a.md')
  assert.ok(doc.chunks.length >= 3)
  for (const c of doc.chunks) assert.ok(c.text.length <= 2500, `${c.text.length}`)
  assert.deepEqual([...new Set(doc.chunks.map((c) => c.heading))], ['One', 'Two'])
  const two = doc.chunks.filter((c) => c.heading === 'Two')
  assert.equal(two.length, 1)
  assert.ok(doc.chunks.every((c, i) => c.seq === i), 'seq counts up from zero across the document')
  assert.equal(doc.chars, doc.chunks.reduce((n, c) => n + c.text.length, 0))
})

test('one enormous paragraph is split at sentence ends', () => {
  const sentence = 'The grace of God is sufficient for all who believe. '
  const doc = extractDocument(sentence.repeat(200), 'txt', 'a.txt')
  assert.ok(doc.chunks.length >= 4)
  for (const c of doc.chunks) {
    assert.ok(c.text.length <= 2500)
    assert.ok(c.text.endsWith('believe.'), `piece ends mid-sentence: ...${c.text.slice(-20)}`)
  }
  // Nothing lost: every sentence is somewhere.
  assert.equal(doc.chunks.map((c) => c.text).join(' ').split('believe.').length - 1, 200)
})

test('text with no spaces at all still splits', () => {
  const doc = extractDocument('x'.repeat(6000), 'txt', 'a.txt')
  assert.ok(doc.chunks.length >= 3)
  assert.ok(doc.chunks.every((c) => c.text.length <= 2500))
  assert.equal(doc.chars, 6000)
})

test('line endings, a byte order mark and zero-width characters are normalized', () => {
  const doc = extractDocument('\uFEFFRom\u200B 8:28\r\n\r\nSecond\rparagraph.\r\n', 'txt', 'a.txt')
  assert.equal(doc.chunks[0].text, 'Rom 8:28\n\nSecond\nparagraph.')
  assert.deepEqual(refs(doc.chunks[0]), [`${ROM}.8:28`])
})

test('a long text is extracted in reasonable time', () => {
  const para = 'Paul wrote in Romans 8 that all things work together (v. 28), and John 3:16 says the rest.\n\n'
  const t = performance.now()
  const doc = extractDocument(para.repeat(20000), 'txt', 'big.txt') // ~1.8 MB
  assert.ok(doc.chunks.length > 1000)
  assert.ok(performance.now() - t < 5000, `took ${Math.round(performance.now() - t)} ms`)
})
