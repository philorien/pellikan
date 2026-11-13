// Loading and binding for named queries, shared by the two dev-server runners: db.ts (bible.db, read-only) and
// userDb.ts (user.db, read/write). The rules match src-tauri/src/db.rs: the name must be a known file, parameters
// are bound by the :names the SQL declares, and a missing parameter is an error rather than a silent NULL.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Carries an HTTP status. h3 reads statusCode and statusMessage off a thrown error. */
export class QueryError extends Error {
  statusCode: number
  statusMessage: string
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = message
  }
}

export type Bound = Record<string, string | number | null>

/** The SQL for `name` in `dir` (relative to the project root). The name is checked before it goes near a path. */
export function namedSql(dir: string, name: unknown): string {
  if (typeof name !== 'string' || !/^[a-z_]+$/.test(name)) throw new QueryError(400, 'Bad query name')
  const file = resolve(process.cwd(), dir, name + '.sql')
  if (!existsSync(file)) throw new QueryError(404, `Unknown query "${name}"`)
  return readFileSync(file, 'utf8')
}

/** Binds exactly the :names the SQL uses; fails loudly if one is missing instead of binding NULL. */
export function bindParams(sql: string, params: unknown): Bound {
  const given = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  const wanted = [...new Set([...sql.replace(/--.*$/gm, '').matchAll(/:([a-z_]+)/g)].map((m) => m[1]!))]
  const bound: Bound = {}
  for (const k of wanted) {
    const v = given[k]
    if (v === undefined) throw new QueryError(400, `Missing parameter "${k}"`)
    if (typeof v !== 'string' && typeof v !== 'number' && v !== null) {
      throw new QueryError(400, `Parameter "${k}" must be a string, number or null`)
    }
    bound[k] = v
  }
  return bound
}
