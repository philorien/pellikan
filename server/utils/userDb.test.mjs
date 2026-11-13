import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runUserQuery, runUserBatch, closeUserDb } from './userDb.ts'
import { bindParams, namedSql } from './named.ts'

// These mirror the user.db tests in src-tauri/src/db.rs: the two runners have to behave the same.
let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'pellikan-user-'))
  process.env.PELLIKAN_USER_DB = join(dir, 'nested', 'user.db') // the folder is created on first use
})
after(() => {
  closeUserDb()
  delete process.env.PELLIKAN_USER_DB
  rmSync(dir, { recursive: true, force: true })
})

test('notes round trip, newest first, dated to the second', () => {
  const at = 1_700_000_000_123
  const [{ id }] = runUserQuery('note_add', { book: 45, chapter: 8, verse: 28, body: 'All things', at })
  runUserQuery('note_add', { book: 43, chapter: 3, verse: 16, body: 'Later', at: at + 5000 })

  const notes = runUserQuery('notes_all', {})
  assert.equal(notes.length, 2)
  assert.equal(notes[0].body, 'Later')
  assert.deepEqual({ ...notes[1] }, { id, book_id: 45, chapter: 8, verse: 28, body: 'All things', at: 1_700_000_000_000 })

  assert.deepEqual(runUserQuery('note_remove', { id }), [])
  assert.equal(runUserQuery('notes_all', {}).length, 1)
})

test('a verse has one highlight, and settings overwrite', () => {
  const verse = { book: 19, chapter: 23, verse: 1 }
  runUserQuery('highlight_set', { ...verse, color: 'yellow' })
  runUserQuery('highlight_set', { ...verse, color: 'blue' })
  assert.deepEqual(runUserQuery('highlights_all', {}).map((r) => ({ ...r })), [{ book_id: 19, chapter: 23, verse: 1, color: 'blue' }])
  runUserQuery('highlight_remove', verse)
  assert.deepEqual(runUserQuery('highlights_all', {}), [])

  runUserQuery('setting_set', { key: 'prefs.fontSize', value: '20' })
  runUserQuery('setting_set', { key: 'prefs.fontSize', value: '24' })
  assert.deepEqual(runUserQuery('settings_all', {}).filter((r) => r.key === 'prefs.fontSize').map((r) => r.value), ['24'])
})

test('a failed batch changes nothing; a good one applies whole', () => {
  const before = runUserQuery('notes_all', {}).length
  const good = { name: 'note_add', params: { book: 1, chapter: 1, verse: 1, body: 'In the beginning', at: 0 } }
  assert.throws(() => runUserBatch([good, { name: 'note_add', params: { book: 1 } }]), /Missing parameter/)
  assert.equal(runUserQuery('notes_all', {}).length, before)

  runUserBatch([good, { name: 'setting_set', params: { key: 'migrated.localStorage', value: '1' } }])
  assert.equal(runUserQuery('notes_all', {}).length, before + 1)
  assert.throws(() => runUserBatch('nope'), /ops must be a list/)
})

test('only named user statements run, and names never reach the filesystem unchecked', () => {
  assert.throws(() => runUserQuery('chapter_verses', {}), /Unknown query/) // a bible.db query, not a user one
  assert.throws(() => runUserQuery('../books', {}), /Bad query name/)
  assert.throws(() => runUserQuery('user/notes_all', {}), /Bad query name/)
  assert.throws(() => runUserQuery(undefined, {}), /Bad query name/)
  assert.throws(() => namedSql('data/queries', 'notes_all'), /Unknown query/) // and the reverse
})

test('bindParams binds only what the SQL names and rejects the rest', () => {
  const sql = 'SELECT :a, :b -- :ignored\n'
  assert.deepEqual(bindParams(sql, { a: 1, b: null, extra: 'x' }), { a: 1, b: null })
  assert.throws(() => bindParams(sql, { a: 1 }), /Missing parameter "b"/)
  assert.throws(() => bindParams(sql, { a: [1], b: 2 }), /must be a string, number or null/)
  assert.throws(() => bindParams(sql, null), /Missing parameter "a"/)
})
