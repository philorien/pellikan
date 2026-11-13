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
  assert.match(textProblem('\u0001\u0002\u0003\u0004\u0005\u0006 binary'), /does not look like a text file/)
  assert.equal(textProblem('Plain text, with a tab\tand a form feed\f and accents: caf\u00e9.'), null)
  assert.throws(() => extractDocument('', 'txt', 'a.txt'), /empty/)
  assert.throws(() => extractDocument('# Heading only\n', 'md', 'a.md'), /No text was found/)
})

test('any replacement character refuses the file, however few', () => {
  // English with an accent now and then, written as Latin-1 and read as UTF-8: 0.3% of the characters, so a percentage
  // threshold would let it through and store a broken character in every passage.
  const plain = 'The grace of God is sufficient for all who believe, and his mercy endures forever. '
  let latin1 = ''
  for (let i = 1; latin1.length < 50_000; i++) latin1 += plain + (i % 3 === 0 ? 'At the caf\u00e9 they met. ' : '')
  const decoded = new TextDecoder('utf-8').decode(Buffer.from(latin1, 'latin1'))
  const bad = [...decoded].filter((c) => c === '\ufffd').length
  assert.ok(bad > 100 && bad / decoded.length < 0.01, `the sample should be below the old 1% line: ${bad}`)
  assert.throws(() => extractDocument(decoded, 'txt', 'latin1.txt'), new RegExp(`${bad} characters in this file are not valid UTF-8`))

  const long = 'A plain sentence about grace. '.repeat(2000)
  assert.match(textProblem(`${long}\ufffd${long}`), /^One character in this file is not valid UTF-8/) // a single stray byte in 58 kB
  assert.match(textProblem(`${long}\ufffd${long}\ufffd`), /^2 characters in this file are not valid UTF-8/)
  assert.equal(textProblem('Valid UTF-8 with accents: caf\u00e9, na\u00efve, \u00fcber, and Greek: \u03b1\u03b2\u03b3.'), null)
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

test('a file that opens with a horizontal rule loses nothing between the two rules', () => {
  const doc = extractDocument('---\n\n# My Notes\n\nFirst section about Romans 8:28 is here.\n\n---\n\nSecond section about John 3:16.\n', 'md', 'a.md')
  assert.equal(doc.title, 'My Notes')
  const text = doc.chunks.map((c) => c.text).join('\n')
  assert.match(text, /First section about Romans 8:28/)
  assert.match(text, /Second section about John 3:16/)
  assert.deepEqual(doc.chunks.flatMap(refs).sort(), [`${ROM}.8:28`, '43.3:16'].sort())
})

test('front matter is only front matter when it is metadata', () => {
  // A paragraph with a colon between two rules is text.
  const note = extractDocument('---\nNote: the following is about Romans 8:28.\n---\n\nBody about John 3:16.\n', 'md', 'a.md')
  assert.match(note.chunks[0].text, /Note: the following is about Romans 8:28/)
  // Prose between two rules is text, even if a line happens to look like "key: value".
  const prose = extractDocument('---\ntitle: A Real Sentence\nAnd then it keeps going as a paragraph.\n---\n\nBody.\n', 'md', 'a.md')
  assert.match(prose.chunks[0].text, /And then it keeps going/)
  // A block of keys we do not recognize stays in the text: shown as a paragraph is a blemish, lost text is a defect.
  const unknown = extractDocument('---\nfoo: bar\nbaz: qux\n---\n\nBody.\n', 'md', 'a.md')
  assert.match(unknown.chunks[0].text, /foo: bar/)
  // Real front matter is still read, with quoting, comments, lists and continuation lines.
  const real = extractDocument('---\n# a comment\ntitle: \'Notes: on Romans\'\ntags:\n  - study\n  - romans\nauthor: A. Writer\ndate: 2026-01-02\n---\n\nBody.\n', 'md', 'a.md')
  assert.deepEqual([real.title, real.author, real.chunks.length, real.chunks[0].text], ['Notes: on Romans', 'A. Writer', 1, 'Body.'])
  // Front matter with only tags and a date is still dropped.
  assert.equal(extractDocument('---\ntags: [a]\ndate: 2026-01-02\n---\n\nBody.\n', 'md', 'a.md').chunks[0].text, 'Body.')
  // The closing line may be "..." (YAML).
  assert.equal(extractDocument('---\ntitle: T\n...\n\nBody.\n', 'md', 'a.md').title, 'T')
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

test('a chapter marker needs a real number, not a word made of numeral letters', () => {
  const headings = (text) => extractDocument(`Intro.\n\n${text}\n\nBody.`, 'txt', 'a.txt').chunks.map((c) => c.heading).filter(Boolean)
  assert.deepEqual(headings('Part civil war notes'), []) // "civil" is C, I, V, I, L
  assert.deepEqual(headings('Book mild'), [])
  assert.deepEqual(headings('Section did this'), [])
  assert.deepEqual(headings('Chapter XIV.'), ['Chapter XIV.'])
  assert.deepEqual(headings('CHAPTER XXXIX'), ['CHAPTER XXXIX'])
  assert.deepEqual(headings('Book iv: The Church'), ['Book iv: The Church'])
  assert.deepEqual(headings('Part 3'), ['Part 3'])
  assert.deepEqual(headings('Lecture MCMXC'), ['Lecture MCMXC'])
  assert.deepEqual(headings('Chapter IIII'), []) // not standard form
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
