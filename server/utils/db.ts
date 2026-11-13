// Dev-only SQL runner for `nuxt dev` in a normal browser. In the desktop app the same named queries run in Rust
// (src-tauri/src/db.rs). Both read data/queries/*.sql, so there is one copy of every query.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PACK_QUERIES, packDb } from './packs'
import { bindParams, namedSql } from './named'

const ROOT = process.cwd()
let db: DatabaseSync | null = null

function open() {
  if (db) return db
  const path = process.env.PELLIKAN_DB ?? resolve(ROOT, 'data/build/bible.db')
  if (!existsSync(path)) {
    throw createError({ statusCode: 503, statusMessage: 'bible.db not found. Run `npm run data` first.' })
  }
  db = new DatabaseSync(path, { readOnly: true })
  return db
}

export function runNamedQuery(name: string, params: Record<string, unknown>) {
  const sql = namedSql('data/queries', name)
  const bound = bindParams(sql, params)
  // Reader and search queries for a downloaded translation run on that translation's own database.
  const pack = PACK_QUERIES.includes(name) && typeof bound.translation === 'string' ? packDb(bound.translation) : null
  return (pack ?? open()).prepare(sql).all(bound)
}
