// Dev-server twin of the user_query and user_batch commands in src-tauri/src/lib.rs, so notes, highlights and
// settings work in `npm run dev` in a plain browser. Same named statements (data/queries/user/*.sql), same schema
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

function open() {
  const p = path()
  if (db && openPath === p) return db
  closeUserDb()
  mkdirSync(dirname(p), { recursive: true })
  const next = new DatabaseSync(p)
  next.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  // Idempotent: safe to run on every start.
  next.exec(readFileSync(resolve(process.cwd(), 'data/schema/user.sql'), 'utf8'))
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
