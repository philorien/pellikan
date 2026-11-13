import { BOOKS, BOOK_BY_OSIS } from '~~/shared/books'

/** The translation every build contains. Others (the ESV, when the epub was supplied) are optional. */
export const TRANSLATION = 'WEB'

type Params = Record<string, string | number | null>

let invokeFn: ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null = null

async function inTauri() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false
  if (!invokeFn) invokeFn = (await import('@tauri-apps/api/core')).invoke
  return true
}

/**
 * Runs a named query from data/queries/. Inside the desktop app it goes to Rust; in `nuxt dev` in a plain
 * browser it goes to the Nitro dev route. Same SQL either way.
 */
export async function query<T = Record<string, unknown>>(name: string, params: Params = {}): Promise<T[]> {
  if (await inTauri()) return (await invokeFn!('query', { name, params })) as T[]
  return await $fetch<T[]>(`/api/query/${name}`, { method: 'POST', body: params })
}

// Calls to user.db run one at a time, in the order they were made. Two quick saves of the same setting (the open
// tabs, say) must not land out of order and leave the older value on disk.
let userQueue: Promise<unknown> = Promise.resolve()
function inOrder<T>(run: () => Promise<T>): Promise<T> {
  const next = userQueue.then(run, run)
  userQueue = next.catch(() => {})
  return next
}

/**
 * Runs a named statement from data/queries/user/ against user.db, the only database the app writes to. Rust in the
 * desktop app, the Nitro dev route in a plain browser. Writes return no rows unless the SQL has a RETURNING clause.
 * Call this from useUserData.ts, not from components.
 */
export function userQuery<T = Record<string, unknown>>(name: string, params: Params = {}): Promise<T[]> {
  return inOrder(async () => {
    if (await inTauri()) return (await invokeFn!('user_query', { name, params })) as T[]
    return await $fetch<T[]>(`/api/user/query/${name}`, { method: 'POST', body: params })
  })
}

/** Runs several user.db statements in one transaction: all of them apply, or none do. */
export function userBatch(ops: Array<{ name: string; params: Params }>): Promise<void> {
  return inOrder(async () => {
    if (await inTauri()) await invokeFn!('user_batch', { ops })
    else await $fetch('/api/user/batch', { method: 'POST', body: { ops } })
  })
}

export function useBooks() {
  return { BOOKS, BOOK_BY_OSIS }
}

export interface TranslationInfo { id: string; name: string; kind: string; attribution: string; license?: string; license_url?: string | null; source_url?: string; pack?: boolean }
export interface CatalogEntry { id: string; name: string; bytes: number; sha256: string; url: string }

/** Plain error text from either a Tauri command (a string) or the dev server (an H3 error). */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  const e = err as { data?: { statusMessage?: string }; statusMessage?: string; message?: string }
  return e?.data?.statusMessage || e?.statusMessage || e?.message || String(err)
}

/** Translation-pack commands: Rust in the desktop app, the dev server's /api/translations in a plain browser. */
export async function translationCommand<T = unknown>(cmd: 'translation_catalog' | 'installed_translations' | 'install_translation' | 'remove_translation', args: { id?: string } = {}): Promise<T> {
  if (await inTauri()) return (await invokeFn!(cmd, args)) as T
  const route = { translation_catalog: ['GET', 'catalog'], installed_translations: ['GET', 'installed'], install_translation: ['POST', 'install'], remove_translation: ['POST', 'remove'] } as const
  const [method, path] = route[cmd]
  return await $fetch<T>(`/api/translations/${path}`, { method, body: method === 'POST' ? args : undefined })
}

/**
 * The reader's current translation. The list is the translations built into bible.db plus any the user has
 * downloaded (see packs.rs). Falls back to the WEB if the chosen one is not available (for example, was removed).
 */
export function useTranslation() {
  const { prefs, setPrefs } = useUserData()
  const list = useState<TranslationInfo[]>('translations', () => [])
  const loaded = useState('translations-loaded', () => false)
  const id = computed(() => (list.value.some((t) => t.id === prefs.value.translation) ? prefs.value.translation : TRANSLATION))
  const info = computed(() => list.value.find((t) => t.id === id.value) ?? null)
  /** Lookups that join the original-language words or cross-references need text from bible.db, so downloaded
   *  translations borrow the WEB's text there. */
  const lookupId = computed(() => (info.value?.pack ? TRANSLATION : id.value))
  async function refresh() {
    const built = (await query<TranslationInfo>('sources')).filter((r) => r.kind === 'translation')
    let packs: TranslationInfo[] = []
    try { packs = (await translationCommand<TranslationInfo[]>('installed_translations')).map((p) => ({ ...p, pack: true })) } catch { /* no packs available in this environment */ }
    list.value = [...built, ...packs]
    loaded.value = true
  }
  async function load() {
    if (!loaded.value) await refresh()
  }
  return { id, info, list, lookupId, load, refresh, set: (next: string) => setPrefs({ translation: next }) }
}
