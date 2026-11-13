import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runUserQuery, runUserBatch, closeUserDb, initUserDb } from './userDb.ts'
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
  // A digit belongs to the name: the SQL's :sha256 is not :sha. SQLite and rusqlite agree.
  assert.deepEqual(bindParams('SELECT :sha256, :a1b', { sha256: 'x', a1b: 2 }), { sha256: 'x', a1b: 2 })
  assert.throws(() => bindParams('SELECT :sha256', { sha: 'x' }), /Missing parameter "sha256"/)
})

// ---------------------------------------------------------------------------------------------
// The imported library. These mirror the Rust tests in src-tauri/src/db.rs.
// ---------------------------------------------------------------------------------------------

/** The library tables as schema 1 had them. */
const SCHEMA_1_LIBRARY = `
  DROP TABLE doc_refs; DROP TABLE doc_chunks_fts; DROP TABLE doc_chunks; DROP TABLE documents;
  CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT, format TEXT NOT NULL,
    original_name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, stored_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    error TEXT, extracted_chars INTEGER, imported_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE doc_chunks (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, heading TEXT, loc TEXT, text TEXT NOT NULL, UNIQUE (document_id, seq));
  CREATE VIRTUAL TABLE doc_chunks_fts USING fts5 (text, heading, content = 'doc_chunks', content_rowid = 'id');
  CREATE TABLE doc_refs (chunk_id INTEGER NOT NULL REFERENCES doc_chunks (id) ON DELETE CASCADE, book_id INTEGER NOT NULL,
    chapter INTEGER NOT NULL, verse_start INTEGER NOT NULL, verse_end INTEGER NOT NULL,
    PRIMARY KEY (chunk_id, book_id, chapter, verse_start, verse_end)) WITHOUT ROWID;
  UPDATE schema_info SET value = '1' WHERE key = 'schema_version';`

const columns = (db, table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name)
const version = (db) => db.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get().value

test('a schema 1 file is brought forward and keeps its notes and settings', () => {
  const db = new DatabaseSync(':memory:')
  initUserDb(db)
  db.exec("INSERT INTO notes (book_id, chapter, verse_start, verse_end, body) VALUES (45, 8, 28, 28, 'kept'); INSERT INTO settings VALUES ('a', 'b')")
  db.exec(SCHEMA_1_LIBRARY)
  assert.equal(version(db), '1')
  assert.ok(!columns(db, 'doc_refs').includes('confidence'))

  initUserDb(db)

  assert.equal(version(db), '2')
  assert.ok(columns(db, 'doc_refs').includes('confidence'))
  assert.equal(db.prepare('SELECT body FROM notes').get().body, 'kept')
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'a'").get().value, 'b')
  db.exec("INSERT INTO documents (title, format, original_name, sha256) VALUES ('t', 'txt', 't.txt', 'h')") // stored_path may be NULL
  initUserDb(db) // and a file at schema 2 is left alone
  assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n, 1)
})

test('a schema 1 file with documents in it is not touched', () => {
  const db = new DatabaseSync(':memory:')
  initUserDb(db)
  db.exec(SCHEMA_1_LIBRARY)
  db.exec("INSERT INTO documents (title, format, original_name, sha256, stored_path) VALUES ('x', 'txt', 'x.txt', 'h', '/p')")
  assert.throws(() => initUserDb(db), /1 imported document/)
  assert.equal(version(db), '1')
  assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n, 1)
})

test('a document is imported, searched, listed and removed', () => {
  const [{ id }] = runUserQuery('document_add', { title: 'Notes on Romans', author: 'A. Writer', format: 'md', original_name: 'romans.md', sha256: 'abc' })
  const chunks = JSON.stringify([
    { seq: 0, heading: 'Romans 8', loc: null, text: 'All things work together for good.', refs: [
      { book: 45, chapter: 8, from: 28, to: 28, confidence: 'high' },
      { book: 45, chapter: 8, from: 28, to: 28, confidence: 'medium' },
      { book: 45, chapter: 8, from: 1, to: 39, confidence: 'medium' }] },
    { seq: 1, heading: null, loc: 'p. 2', text: 'No refs here.', refs: [] },
  ])
  runUserBatch([{ name: 'doc_chunks_add', params: { document: id, chunks } }, { name: 'doc_refs_add', params: { document: id, chunks } }])
  runUserQuery('document_finish', { id, chars: 47 })

  // Only a repeated reference is skipped. A value that breaks a constraint is an error, not a silent gap.
  const withRef = (ref) => JSON.stringify([{ seq: 0, heading: null, loc: null, text: 'x', refs: [ref] }])
  assert.throws(() => runUserBatch([{ name: 'doc_refs_add', params: { document: id, chunks: withRef({ book: 45, chapter: 8, from: 2, to: 2, confidence: 'certain' }) } }]), /CHECK constraint failed/)
  assert.throws(() => runUserBatch([{ name: 'doc_refs_add', params: { document: id, chunks: withRef({ book: 45, chapter: 8, from: 2, to: 2 }) } }]), /NOT NULL constraint failed/)

  const [doc] = runUserQuery('documents_all', {})
  assert.deepEqual({ status: doc.status, chunks: doc.chunks, refs: doc.refs, author: doc.author }, { status: 'ready', chunks: 2, refs: 2, author: 'A. Writer' })
  assert.equal(runUserQuery('document_by_hash', { sha256: 'abc' })[0].id, id)
  assert.deepEqual(runUserQuery('document_by_hash', { sha256: 'nope' }), [])

  runUserQuery('document_remove', { id })
  assert.deepEqual(runUserQuery('documents_all', {}), [])
})

test('an interrupted import is marked failed and a finished one is not', () => {
  const add = (hash) => runUserQuery('document_add', { title: hash, author: null, format: 'txt', original_name: 'a.txt', sha256: hash })[0].id
  const [stuck, done] = [add('x1'), add('x2')]
  runUserQuery('document_finish', { id: done, chars: 1 })
  runUserQuery('documents_fail_stale', {})
  const status = (id) => runUserQuery('documents_all', {}).find((d) => d.id === id).status
  assert.deepEqual([status(stuck), status(done)], ['failed', 'ready'])
  runUserQuery('document_remove', { id: stuck })
  runUserQuery('document_remove', { id: done })
})
