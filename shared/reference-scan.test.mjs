import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanReferences, splitByChapter } from './reference-scan.ts'

/** One reference as a short string: "Rom 8:28", "Rom 8:28-30", "Gen 1:1-2:3", "Rom 8" (whole chapter), "Matt 5-7". A trailing "?" marks medium confidence. */
function fmt(r) {
  const b = r.book.osis
  let s
  if (r.kind === 'chapter') s = r.chapter === r.endChapter ? `${b} ${r.chapter}` : `${b} ${r.chapter}-${r.endChapter}`
  else if (r.chapter !== r.endChapter) s = `${b} ${r.chapter}:${r.verse}-${r.endChapter}:${r.endVerse}`
  else s = r.verse === r.endVerse ? `${b} ${r.chapter}:${r.verse}` : `${b} ${r.chapter}:${r.verse}-${r.endVerse}`
  return s + (r.confidence === 'medium' ? '?' : '')
}
const scan = (text) => scanReferences(text).map(fmt)
const spans = (text) => scanReferences(text).map((r) => text.slice(r.start, r.end))

/** Each row: [text, expected references]. */
function each(rows) {
  for (const [text, expected] of rows) assert.deepEqual(scan(text), expected, JSON.stringify(text))
}

test('chapter and verse, in the common ways of writing them', () => {
  each([
    ['Rom 8:28', ['Rom 8:28']],
    ['Rom. 8:28', ['Rom 8:28']],
    ['Romans 8:28-30', ['Rom 8:28-30']],
    ['Romans 8:28–30', ['Rom 8:28-30']], // en dash
    ['Romans 8:28 – 30', ['Rom 8:28-30']],
    ['Romans 8.28-30', ['Rom 8:28-30']], // full stop between chapter and verse
    ['ROMANS 8:28', ['Rom 8:28']],
    ['Ps 119:105', ['Ps 119:105']],
    ['Psalm 23:1', ['Ps 23:1']],
    ['Psalms 23:1-6', ['Ps 23:1-6']],
    ['Song of Solomon 2:1', ['Song 2:1']],
    ['Song of Songs 2:1', ['Song 2:1']],
    ['Rev 22:20-21', ['Rev 22:20-21']],
    ['Gen 1:1-2:3', ['Gen 1:1-2:3']], // range across chapters
    ['2 Kings 21:18-26: 2 Chr. 33:20-25', ['2Kgs 21:18-26', '2Chr 33:20-25']], // a colon typed for a semicolon
    ['Jude 1:5', ['Jude 1:5']],
    ['as Paul says (Rom 8:28), all things', ['Rom 8:28']],
    ['see Rom 8:28.', ['Rom 8:28']],
  ])
})

test('numbered books', () => {
  each([
    ['1 Cor 13:4', ['1Cor 13:4']],
    ['1Cor 13:4', ['1Cor 13:4']],
    ['1 Cor. 13:4', ['1Cor 13:4']],
    ['I Cor. 13:4–7', ['1Cor 13:4-7']],
    ['II Kings 5:14', ['2Kgs 5:14']],
    ['First Corinthians 13:4', ['1Cor 13:4']],
    ['2nd Timothy 3:16', ['2Tim 3:16']],
    ['3 John 1:4', ['3John 1:4']],
    ['1 John 3:16', ['1John 3:16']],
    ['John 3:16', ['John 3:16']],
    ['I Sam. 3:10', ['1Sam 3:10']],
    // "Isa." is Isaiah, not "I Sa." (1 Samuel): a roman numeral needs a space before the name.
    ['Isa. xxxiv. 11', ['Isa 34:11']],
    ['Isaiah 53:5', ['Isa 53:5']],
    // A digit that belongs to something else is not a book number.
    ['page 12 John 3:16', ['John 3:16']],
    ['2 Mark 3:5', ['Mark 3:5']],
    // A numbered book named without its number could be either one, so it is left alone.
    ['Corinthians 13:4', []],
    ['Kings 5:14', []],
    ['Peter 2:9', []],
  ])
})

test('suffixes: part-verse letters, f. and ff.', () => {
  each([
    ['John 3:16a', ['John 3:16']],
    ['John 3:16b-17a', ['John 3:16-17']],
    ['Rom 8:28f', ['Rom 8:28-29']], // and the following verse
    ['Rom 8:28f.', ['Rom 8:28-29']],
    ['Rom 8:28ff', ['Rom 8:28-39']], // and the verses following, to the end of the chapter
    ['Rom 8:28 ff.', ['Rom 8:28-39']],
    ['Rom 8:28 for we know', ['Rom 8:28']], // "for" is not "f."
  ])
  assert.deepEqual(spans('See Rom 8:28ff. and John 3:16a.'), ['Rom 8:28ff.', 'John 3:16a'])
})

test('lists: commas continue the chapter, semicolons continue the book', () => {
  each([
    ['1 Cor 13:4, 7', ['1Cor 13:4', '1Cor 13:7']],
    ['cf. 1 Cor 13:4, 7', ['1Cor 13:4', '1Cor 13:7']],
    ['1 Cor 13:4,7-8', ['1Cor 13:4', '1Cor 13:7-8']],
    ['Rom 8:28, 31; 9:5; 1 Cor 13:4', ['Rom 8:28', 'Rom 8:31', 'Rom 9:5', '1Cor 13:4']],
    ['Rom 8:28, 9:5', ['Rom 8:28', 'Rom 9:5']],
    ['Rom 8:28; 1 Cor 13:4', ['Rom 8:28', '1Cor 13:4']],
    // After a comma, a number that starts another book is that book, not a verse.
    ['John 3:16, 1 John 4:8', ['John 3:16', '1John 4:8']],
    ['John 3:16, 2 Cor 5:17', ['John 3:16', '2Cor 5:17']],
    // Verse lists go up. A smaller number is something else.
    ['Rom 8:28, 3 things follow', ['Rom 8:28']],
    // A bare number after a semicolon could be a chapter or anything else.
    ['Matt 5:3; 15', ['Matt 5:3']],
    // "and" is not followed.
    ['Isaiah 53:5 and 6', ['Isa 53:5']],
  ])
  assert.deepEqual(spans('Rom 8:28, 31; 9:5'), ['Rom 8:28', '31', '9:5'])
})

test('older books: roman chapter numbers', () => {
  each([
    ['Rom. viii. 28', ['Rom 8:28']],
    ['Rom. viii, 28', ['Rom 8:28']],
    ['Ps. cxix. 105', ['Ps 119:105']],
    ['1 Cor. xiii. 4-7', ['1Cor 13:4-7']],
    ['John iii. 16', ['John 3:16']],
    ['Matt. v. 3, 5; vi. 9', ['Matt 5:3', 'Matt 5:5', 'Matt 6:9']],
    // A roman chapter needs a verse; on its own it is too easy to confuse with a word.
    ['Mark i think so', []],
    ['Rom. viii.', []],
    // Not a roman numeral.
    ['Acts ill. 5', []],
  ])
})

test('short abbreviations need a chapter and a verse', () => {
  each([
    ['Mt 5:3', ['Matt 5:3']],
    ['Mk 1:1; Lk 2:1; Jn 3:16', ['Mark 1:1', 'Luke 2:1', 'John 3:16']],
    ['(Jam. i. 17)', ['Jas 1:17']],
    ['Gn 1:1', ['Gen 1:1']],
    ['Ex 3:14', ['Exod 3:14']],
    ['Ge 10:10; Lu. iii. 31; Joh 1:1', ['Gen 10:10', 'Luke 3:31', 'John 1:1']],
    ['Dt 6:4', ['Deut 6:4']],
    ['Mt 5', []],
    ['Jn 3', []],
  ])
})

test('abbreviations that are also words need a citation around them', () => {
  each([
    ['(Is 53:5)', ['Isa 53:5']],
    ['Jer 1:5; Is 53:5', ['Jer 1:5', 'Isa 53:5']],
    ['Is. 53:5', ['Isa 53:5']],
    ['(Am 3:3)', ['Amos 3:3']],
    ['Is 5:30 okay for dinner?', []],
    ['He 4:12 it and left', []],
    ['Am 3:15 is too early', []],
    ['Re 3:20 meeting notes', []],
  ])
})

test('a chapter alone is medium confidence, and only for full names and standard abbreviations', () => {
  each([
    ['Romans 8', ['Rom 8?']],
    ['Rom. 8', ['Rom 8?']],
    ['Rom 8', ['Rom 8?']],
    ['Psalm 23', ['Ps 23?']],
    ['Matt 5-7', ['Matt 5-7?']],
    ['Matthew 5–7', ['Matt 5-7?']],
    ['1 Corinthians 13 is about love', ['1Cor 13?']],
    // Books with one chapter: the number is a verse.
    ['Jude 5', ['Jude 1:5?']],
    ['Obadiah 3-4', ['Obad 1:3-4?']],
    ['Philemon 6', ['Phlm 1:6?']],
  ])
})

test('verse-only mentions belong to the chapter the paragraph has named on its own', () => {
  each([
    ['In Romans 8 Paul turns to the Spirit (v. 5), and ends with vv. 31-39.', ['Rom 8?', 'Rom 8:5?', 'Rom 8:31-39?']],
    ['Psalm 23 opens with the shepherd. Verse 4 is the valley; verses 5–6 the table.', ['Ps 23?', 'Ps 23:4?', 'Ps 23:5-6?']],
    ['In Romans 8 (see vv. 29, 30) the chain is unbroken.', ['Rom 8?', 'Rom 8:29?', 'Rom 8:30?']],
    // A verse cited in passing does not change the topic...
    ['In Romans 8 Paul echoes Gal 5:16, and then (v. 5) goes on.', ['Rom 8?', 'Gal 5:16', 'Rom 8:5?']],
    // ...and is not a topic itself: in a commentary "v. 18" means the passage being discussed, which is unknown here.
    ['Both shall be one in Christ (Eph. ii. 14, 15), as it is promised, v. 18.', ['Eph 2:14', 'Eph 2:15']],
    ['John 3:16 is well known; verse 17 is not.', ['John 3:16']],
    // Another chapter named in between ends the topic: "v. 29" here is in chapter 5.
    ['In Romans 8 the name is God, while in ch. 5 it is the Lord, except in v. 29.', ['Rom 8?']],
    // "ch. v. 4" is chapter five, verse four, of some book.
    ['Romans 8 is sweet, but the end was bitter, Prov. ix. 17, and ch. v. 4.', ['Rom 8?', 'Prov 9:17']],
    // Not across a paragraph break.
    ['Romans 8 is the high point.\n\nSee v. 5 for more.', ['Rom 8?']],
    // Not without a chapter first.
    ['See v. 5 for more.', []],
    // Not when the verse does not exist in that chapter.
    ['Psalm 23 and v. 40', ['Ps 23?']],
    // After a range of chapters there is no single chapter to attach to.
    ['Matt 5-7, especially v. 3', ['Matt 5-7?']],
  ])
})

test('references that do not exist are not references', () => {
  each([
    ['John 45:1', []], // John has 21 chapters
    ['Luke 30:1', []],
    ['Rom 8:40', []], // Romans 8 has 39 verses
    ['Rom 8:28-40', []],
    ['Rom 8:30-28', []], // backwards
    ['Gen 2:3-1:1', []],
    ['Ps 151:1', []],
    ['John 0:1', []],
    ['John 3:0', []],
    ['Acts 1945', []],
    ['Mark 99', []],
    ['3 John 15', []], // 14 verses in the KJV numbering this app uses
    ['1 Macc. 1:57', []], // books outside the 66 are not linked
    ['Ecclus. 3:30', []],
    ['Esther 16:10', []],
  ])
})

test('words that only look like books', () => {
  each([
    ['Job is a hard book to read.', []],
    ['I work that job 3 days a week.', []],
    ['Mark my words.', []],
    ['Acts of kindness matter.', []],
    ['john 3:16', []], // lowercase: not written as a citation
    ['Johnson 3:16', []],
    ['Promise 3:5', []],
    ['Marks 3:5', []],
    ['at 3:16 in the afternoon', []],
    ['Numbers 1,000 and up', []],
    ['Luke 15-year-old boy', []],
    ['Mark 2nd edition', []],
    ['He read Romans. 8 people came.', []], // a sentence ending in a book's full name
    ['He read Mark\n3 times.', []], // a chapter alone must be on the same line as its book
    ['Rom 8:28th', []],
  ])
})

test('counts and clock times after a book that is also a name', () => {
  each([
    // A chapter alone followed by a quantity is a count.
    ['Call Mark 5 times.', []],
    ['Job 3 years ago', []],
    ['Numbers 10 to 20', []],
    ['Amos 5 people came', []],
    ['John 5 minutes later', []],
    ['Luke 2 days', []],
    ['Jude 5 minutes', []],
    ['Mark 5-7 years old', []],
    ['gave Ruth 4 dollars', []],
    // A time is never a reference, even when the verse exists.
    ['Meet Mark 5:30 pm', []],
    ['Luke 12:30 p.m.', []],
    ['Ruth 1:16 AM', []],
    ['Mark 5:30pm', []],
    ["Job 2 o'clock", []],
    ['said Mark\n5:30 pm', []],
    // Still citations.
    ['Psalm 23 in the KJV', ['Ps 23?']],
    ['Romans 8 and 9', ['Rom 8?']], // "and" in lists is a known gap: only Romans 8
    ['Ps 23:1 AMP', ['Ps 23:1']], // the Amplified Bible, not a.m.
    ['Matthew 5 to 7', []], // a range written with "to" is dropped, not half linked
  ])
})

test('documented tradeoffs', () => {
  // A citation may wrap once, because hard-wrapped texts break there. The cost: a name at a line end, then a time
  // without am/pm, links.
  each([['said Mark\n5:30 tomorrow', ['Mark 5:30']]])
  // Hebrew and Aramaic numbering: verses that exist only there are dropped (English numbering is canonical).
  each([['Dan 3:31', []], ['Mal 3:19', []]])
})

test('line breaks and odd spacing inside a citation', () => {
  each([
    ['Rom.\n8:28', ['Rom 8:28']],
    ['Rom\u00a08:28', ['Rom 8:28']],
    ['Rom 8 : 28', ['Rom 8:28']],
    ['Rom.8:28', ['Rom 8:28']],
  ])
})

test('spans cover exactly the citation text', () => {
  const text = 'As Paul wrote (Rom. 8:28; 1 Cor 13:4, 7), and in Psalm 23.'
  assert.deepEqual(spans(text), ['Rom. 8:28', '1 Cor 13:4', '7', 'Psalm 23'])
  const refs = scanReferences(text)
  for (let i = 1; i < refs.length; i++) assert.ok(refs[i].start >= refs[i - 1].end, 'references are in order and do not overlap')
})

test('a paragraph of real prose', () => {
  const text = [
    'The apostle returns to this theme often (Rom. 5:1-5; 8:18-25; 2 Cor. 4:16-18). In Romans 8 the argument',
    'reaches its height: nothing can separate us from the love of God (vv. 38-39). Compare Isaiah 40:31 and',
    'the whole of Psalm 46. John wrote his letter so that his readers might know they have eternal life',
    '(1 John 5:13), and Mark records that Jesus rose early (Mk 1:35).',
  ].join('\n')
  assert.deepEqual(scan(text), [
    'Rom 5:1-5', 'Rom 8:18-25', '2Cor 4:16-18', 'Rom 8?', 'Rom 8:38-39?', 'Isa 40:31', 'Ps 46?', '1John 5:13', 'Mark 1:35',
  ])
})

test('splitByChapter gives one verse range per chapter', () => {
  const pieces = (text) => splitByChapter(scanReferences(text)[0]).map((p) => `${p.bookId} ${p.chapter}:${p.verseStart}-${p.verseEnd}`)
  assert.deepEqual(pieces('Rom 8:28'), ['45 8:28-28'])
  assert.deepEqual(pieces('Gen 1:1-2:3'), ['1 1:1-31', '1 2:1-3'])
  assert.deepEqual(pieces('Psalm 23'), ['19 23:1-6'])
  assert.deepEqual(pieces('Matt 5-7'), ['40 5:1-48', '40 6:1-34', '40 7:1-29'])
})

test('empty and reference-free text', () => {
  assert.deepEqual(scan(''), [])
  assert.deepEqual(scan('No citations here at all, only prose about nothing in particular.'), [])
})

test('a long text scans in linear time', () => {
  const para = 'Paul wrote in Romans 8 that all things work together (v. 28), and John 3:16 says the rest. '
  const text = para.repeat(5000)
  const t = performance.now()
  const refs = scanReferences(text)
  assert.equal(refs.length, 15000)
  assert.ok(performance.now() - t < 2000, 'scanning ~450 kB took too long')
})
