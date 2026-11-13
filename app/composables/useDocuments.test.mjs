import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useDocuments, sha256Hex, IMPORT_BATCH } from './useDocuments.ts'
import { MAX_IMPORT_BYTES } from '../../shared/doc-import.ts'

// Stand-ins for what Nuxt provides: useState, and the user.db calls from useBible.ts. The calls are recorded and
// answered from a script, so the order of statements and what each one carries can be checked.
const states = new Map()
globalThis.useState = (key, init) => {
  if (!states.has(key)) states.set(key, { value: init() })
  return states.get(key)
}
globalThis.errorMessage = (err) => (err instanceof Error ? err.message : String(err))

let calls
let answers
let failOn
beforeEach(() => {
  states.clear()
  calls = []
  answers = {}
  failOn = () => false
  globalThis.userQuery = async (name, params = {}) => {
    calls.push({ name, params })
    if (failOn(name, calls.filter((c) => c.name === name).length)) throw new Error(`${name} failed`)
    const a = answers[name]
    return typeof a === 'function' ? a(params) : a ?? []
  }
  globalThis.userBatch = async (ops) => {
    const n = calls.filter((c) => c.name === 'batch').length + 1
    calls.push({ name: 'batch', ops })
    if (failOn('batch', n)) throw new Error('batch failed')
  }
  answers.document_add = [{ id: 7 }]
})

const names = () => calls.map((c) => c.name)
const file = (name, text) => new File([text], name)

test('sha256Hex matches the known digest of "abc"', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc').buffer), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('an import stores the document, its chunks and references, then marks it ready', async () => {
  const docs = useDocuments()
  assert.equal(await docs.importFile(file('romans.md', '# Notes\n\n## Romans 8\n\nSee Rom 8:28 and v. 5.\n')), true)

  assert.deepEqual(names(), ['document_by_hash', 'document_add', 'batch', 'document_finish', 'documents_all'])
  const add = calls[1].params
  assert.deepEqual({ title: add.title, author: add.author, format: add.format, original_name: add.original_name }, { title: 'Notes', author: null, format: 'md', original_name: 'romans.md' })
  assert.match(add.sha256, /^[0-9a-f]{64}$/)

  const batch = calls[2].ops
  assert.deepEqual(batch.map((o) => o.name), ['doc_chunks_add', 'doc_refs_add'])
  assert.equal(batch[0].params.document, 7)
  assert.equal(batch[0].params.chunks, batch[1].params.chunks) // the same JSON feeds both statements
  const chunks = JSON.parse(batch[0].params.chunks)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].heading, 'Romans 8')
  assert.deepEqual(chunks[0].refs.map((r) => [r.book, r.chapter, r.from, r.to, r.confidence]), [[45, 8, 28, 28, 'high'], [45, 8, 1, 39, 'medium'], [45, 8, 5, 5, 'medium']])

  assert.equal(calls[3].params.id, 7)
  assert.equal(docs.importing.value, null)
  assert.equal(docs.error.value, null)
  assert.match(docs.notice.value, /Imported “Notes”: 1 passages, 3 Scripture references/)
})

test('a long book is saved in batches of IMPORT_BATCH chunks', async () => {
  const para = (i) => `Paragraph ${i}. ${'The grace of God is enough. '.repeat(50)}`
  const text = Array.from({ length: IMPORT_BATCH * 2 + 40 }, (_, i) => para(i)).join('\n\n')
  await useDocuments().importFile(file('long.txt', text))
  const batches = calls.filter((c) => c.name === 'batch')
  assert.equal(batches.length, 3)
  const sizes = batches.map((b) => JSON.parse(b.ops[0].params.chunks).length)
  assert.deepEqual(sizes.slice(0, 2), [IMPORT_BATCH, IMPORT_BATCH])
  const seqs = batches.flatMap((b) => JSON.parse(b.ops[0].params.chunks).map((c) => c.seq))
  assert.deepEqual(seqs, seqs.map((_, i) => i), 'seq counts up across batches')
})

test('if saving fails part way, the half-imported document is removed and the error is shown', async () => {
  failOn = (name, n) => name === 'batch' && n === 2
  const para = (i) => `Paragraph ${i}. ${'The grace of God is enough. '.repeat(50)}`
  const docs = useDocuments()
  const ok = await docs.importFile(file('long.txt', Array.from({ length: IMPORT_BATCH * 2 }, (_, i) => para(i)).join('\n\n')))

  assert.equal(ok, false)
  assert.deepEqual(calls.filter((c) => c.name === 'document_remove').map((c) => c.params), [{ id: 7 }])
  assert.ok(!names().includes('document_finish'), 'a failed import is never marked ready')
  assert.match(docs.error.value, /long\.txt could not be imported: batch failed/)
  assert.equal(docs.importing.value, null)
  assert.equal(docs.notice.value, null)
})

test('if even the clean-up fails, the original error is still the one shown', async () => {
  failOn = (name, n) => name === 'document_finish' || name === 'document_remove'
  const docs = useDocuments()
  assert.equal(await docs.importFile(file('a.txt', 'Some text.')), false)
  assert.match(docs.error.value, /a\.txt could not be imported: document_finish failed/)
})

test('the same file again is refused, unless the earlier attempt never finished', async () => {
  const docs = useDocuments()
  answers.document_by_hash = [{ id: 3, title: 'Old title', status: 'ready' }]
  assert.equal(await docs.importFile(file('a.txt', 'Some text.')), false)
  assert.match(docs.error.value, /“Old title” is already in your library/)
  assert.ok(!names().includes('document_add'))

  calls.length = 0
  answers.document_by_hash = [{ id: 3, title: 'Old title', status: 'failed' }]
  assert.equal(await docs.importFile(file('a.txt', 'Some text.')), true)
  assert.deepEqual(calls.filter((c) => c.name === 'document_remove').map((c) => c.params), [{ id: 3 }])
  assert.ok(names().includes('document_add'))
})

test('files it cannot import are refused before anything is stored', async () => {
  const docs = useDocuments()
  assert.equal(await docs.importFile(file('book.pdf', '%PDF-')), false)
  assert.match(docs.error.value, /imports \.txt and \.md files so far/)

  const big = file('big.txt', 'x')
  Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 })
  assert.equal(await docs.importFile(big), false)
  assert.match(docs.error.value, /larger than 25 MB/)

  assert.equal(await docs.importFile(file('empty.md', '  \n')), false)
  assert.match(docs.error.value, /empty\.md could not be imported: The file is empty/)
  assert.equal(await docs.importFile(file('bad.txt', 'café ����������')), false)
  assert.match(docs.error.value, /UTF-8/)

  assert.ok(!names().includes('document_add'), 'nothing was stored for any of them')
})

test('only one import runs at a time', async () => {
  const docs = useDocuments()
  const first = docs.importFile(file('a.txt', 'One.'))
  assert.equal(await docs.importFile(file('b.txt', 'Two.')), false) // started while the first is running
  assert.equal(await first, true)
  assert.equal(calls.filter((c) => c.name === 'document_add').length, 1)
})

test('load() clears interrupted imports once per app session, not on every visit', async () => {
  const docs = useDocuments()
  answers.documents_all = [{ id: 1, title: 'T', status: 'ready' }]
  await docs.load()
  await docs.load()
  // Once: a book that is "processing" later in the session is a real import in progress, not an interrupted one.
  assert.equal(calls.filter((c) => c.name === 'documents_fail_stale').length, 1)
  assert.equal(calls.filter((c) => c.name === 'documents_all').length, 2)
  assert.equal(names()[0], 'documents_fail_stale', 'it runs before the list is read')
  assert.deepEqual(docs.documents.value.map((d) => d.title), ['T'])
  assert.equal(docs.loaded.value, true)
})

test('a failed load says so', async () => {
  failOn = (name) => name === 'documents_all'
  const docs = useDocuments()
  await docs.load()
  assert.match(docs.error.value, /could not be loaded: documents_all failed/)
})

test('remove() deletes, refreshes the list, and reports a failure', async () => {
  const docs = useDocuments()
  await docs.remove(4)
  assert.deepEqual(names(), ['document_remove', 'documents_all'])
  assert.deepEqual(calls[0].params, { id: 4 })

  failOn = (name) => name === 'document_remove'
  await docs.remove(5)
  assert.match(docs.error.value, /could not be removed: document_remove failed/)
})
