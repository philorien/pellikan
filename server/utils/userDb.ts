// Dev-server twin of the user_query and user_batch commands in src-tauri/src/lib.rs, so notes, highlights, settings and
// imported books work in `npm run dev` in a plain browser. Same named statements (data/queries/user/*.sql), same schema
// (data/schema/user.sql). The database is data/build/user.db (override with PELLIKAN_USER_DB); the desktop app keeps
// its own user.db in the OS app data directory, so the two never share data.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { QueryError, bindParams, namedSql } from './named.ts'

const QUERY_DIR = 'data/queries/user'
const path = () => process.env.PELLIKAN_USER_DB ?? resolve(process.cwd(), 'data/build/user.db')

let db: DatabaseSync | null = null
let openPath = ''

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

/**
 * Schema 1 -> 2 (data/schema/migrations/user-2.sql): the imported-library tables are dropped so user.sql can create them
 * in their new shape. Refuses if a document is there, because it would be lost. Mirrors migrate_user in db.rs.
 */
export function migrateUser(conn: DatabaseSync) {
  const has = (name: string) => (conn.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get(name) as { n: number }).n > 0
  if (!has('schema_info')) return // a new file: user.sql creates everything at the current version
  const row = conn.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (row?.value !== '1') return
  if (has('documents')) {
    const { n } = conn.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }
    if (n > 0) throw new Error(`user.db holds ${n} imported document(s) in schema 1, which cannot be upgraded automatically`)
  }
  conn.exec('BEGIN')
  try {
    conn.exec(read('data/schema/migrations/user-2.sql'))
    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }
}

/** Applies the pragmas, the migration and the schema to an open database. Idempotent: safe on every start. */
export function initUserDb(conn: DatabaseSync) {
  conn.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  migrateUser(conn)
  conn.exec(read('data/schema/user.sql'))
}

function open() {
  const p = path()
  if (db && openPath === p) return db
  closeUserDb()
  mkdirSync(dirname(p), { recursive: true })
  const next = new DatabaseSync(p)
  initUserDb(next)
  db = next
  openPath = p
  return next
}

export function closeUserDb() {
  db?.close()
  db = null
  openPath = ''
}

function run(conn: DatabaseSync, name: unknown, params: unknown) {
  const sql = namedSql(QUERY_DIR, name)
  return conn.prepare(sql).all(bindParams(sql, params))
}

/** One named statement. Writes return no rows unless the SQL has a RETURNING clause. */
export function runUserQuery(name: unknown, params: unknown) {
  return run(open(), name, params)
}

/** Several named statements in one transaction: all of them apply, or none do. */
export function runUserBatch(ops: unknown) {
  if (!Array.isArray(ops)) throw new QueryError(400, 'ops must be a list')
  const conn = open()
  conn.exec('BEGIN')
  try {
    for (const op of ops) run(conn, op?.name, op?.params)
    conn.exec('COMMIT')
  } catch (err) {
    conn.exec('ROLLBACK')
    throw err
  }
}
