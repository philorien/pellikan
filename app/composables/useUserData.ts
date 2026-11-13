// Notes, highlights, reading preferences and other small settings.
//
// These live in user.db (schema: data/schema/user.sql; statements: data/queries/user/*.sql), reached through
// userQuery and userBatch in useBible.ts. Everything that touches user data goes through this file, so components
// never see the storage. The state here is a copy of the database held in memory for rendering.
//
// Before user.db had write commands this data was in localStorage. The first run copies it across in one
// transaction (see legacyOps) and records that in the settings table. The old localStorage keys are left alone as a
// backup; nothing reads them after that.
//
// One thing stays in localStorage on purpose: the theme (useTheme.ts), which has to be known before first paint.

import { BOOK_BY_ID, BOOK_BY_OSIS } from '../../shared/books.ts'

export interface UserNote { id: number; osis: string; chapter: number; verse: number; body: string; at: number }
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'rose'
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'rose']

export interface Prefs { fontSize: number; redLetters: boolean; focus: boolean; translation: string }
export const DEFAULT_PREFS: Prefs = { fontSize: 20, redLetters: true, focus: false, translation: 'WEB' }

export interface UserOp { name: string; params: Record<string, string | number | null> }

/** Settings keys. Each preference is its own row (`prefs.fontSize`), holding a JSON value. */
const PREF = 'prefs.'
export const TABS_SETTING = 'tabs'
export const MIGRATED_SETTING = 'migrated.localStorage'
const LEGACY_KEYS = { notes: 'pellikan.notes', highlights: 'pellikan.highlights', prefs: 'pellikan.prefs', tabs: 'pellikan.tabs' }

export const verseKey = (osis: string, chapter: number, verse: number) => `${osis}.${chapter}.${verse}`

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0
/** Chapters and verses start at 1. A malformed key like "Ps..1" gives Number('') === 0, which this rejects. */
const isPositive = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1
const isColor = (c: unknown): c is HighlightColor => HIGHLIGHT_COLORS.includes(c as HighlightColor)

// ---------------------------------------------------------------------------------------------
// Pure conversions between database rows, the in-memory state, and the old localStorage shapes.
// ---------------------------------------------------------------------------------------------

export interface NoteRow { id: number; book_id: number; chapter: number; verse: number; body: string; at: number }
export interface HighlightRow { book_id: number; chapter: number; verse: number; color: string }

/** A row from notes_all as the UI's note, or null if its book id is not one of the 66. */
export function noteFromRow(row: NoteRow): UserNote | null {
  const book = BOOK_BY_ID[row.book_id]
  return book ? { id: row.id, osis: book.osis, chapter: row.chapter, verse: row.verse, body: row.body, at: row.at } : null
}

/** Rows from highlights_all as the verse-key map the reader uses. Unknown books and colours are skipped. */
export function highlightsFromRows(rows: HighlightRow[]): Record<string, HighlightColor> {
  const out: Record<string, HighlightColor> = {}
  for (const r of rows) {
    const book = BOOK_BY_ID[r.book_id]
    if (book && isColor(r.color)) out[verseKey(book.osis, r.chapter, r.verse)] = r.color
  }
  return out
}

/** Preferences read from the settings table over `base`. A missing, unreadable or wrongly typed value keeps the default. */
export function prefsFromSettings(settings: Record<string, string>, base: Prefs = DEFAULT_PREFS): Prefs {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    const raw = settings[PREF + key]
    if (raw === undefined) continue
    try {
      const value = JSON.parse(raw)
      if (typeof value === typeof out[key]) out[key] = value
    } catch { /* keep the default */ }
  }
  return out as unknown as Prefs
}

const prefOp = (key: string, value: unknown): UserOp => ({ name: 'setting_set', params: { key: PREF + key, value: JSON.stringify(value) } })

/**
 * The statements that copy what an older version kept in localStorage into user.db. Takes the parsed values (or
 * null) and trusts none of it: anything malformed is skipped, so one bad entry cannot block the rest.
 */
export function legacyOps(legacy: { notes?: unknown; highlights?: unknown; prefs?: unknown; tabs?: unknown }, now: number): UserOp[] {
  const ops: UserOp[] = []

  const notes: Array<{ at: number; op: UserOp }> = []
  for (const n of Array.isArray(legacy.notes) ? legacy.notes : []) {
    const book = BOOK_BY_OSIS[n?.osis]
    if (!book || !isPositive(n.chapter) || !isPositive(n.verse) || typeof n.body !== 'string' || !n.body.trim()) continue
    const at = isCount(n.at) ? n.at : now
    notes.push({ at, op: { name: 'note_add', params: { book: book.id, chapter: n.chapter, verse: n.verse, body: n.body, at } } })
  }
  // Oldest first, so that notes written in the same second still list newest first (notes_all breaks ties by id).
  ops.push(...notes.sort((a, b) => a.at - b.at).map((n) => n.op))

  const highlights = legacy.highlights && typeof legacy.highlights === 'object' && !Array.isArray(legacy.highlights) ? legacy.highlights : {}
  for (const [key, color] of Object.entries(highlights)) {
    const [osis, chapter, verse] = key.split('.')
    const book = BOOK_BY_OSIS[osis ?? '']
    if (!book || !isPositive(Number(chapter)) || !isPositive(Number(verse)) || !isColor(color)) continue
    ops.push({ name: 'highlight_set', params: { book: book.id, chapter: Number(chapter), verse: Number(verse), color } })
  }

  const prefs = legacy.prefs && typeof legacy.prefs === 'object' ? legacy.prefs as Record<string, unknown> : {}
  for (const [key, fallback] of Object.entries(DEFAULT_PREFS)) {
    if (typeof prefs[key] === typeof fallback) ops.push(prefOp(key, prefs[key]))
  }

  // The open tabs are stored whole; useTabs.ts checks the shape when it reads them back.
  if (legacy.tabs && typeof legacy.tabs === 'object') ops.push({ name: 'setting_set', params: { key: TABS_SETTING, value: JSON.stringify(legacy.tabs) } })

  return ops
}

function readLegacy() {
  const read = (key: string): unknown => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
  }
  return { notes: read(LEGACY_KEYS.notes), highlights: read(LEGACY_KEYS.highlights), prefs: read(LEGACY_KEYS.prefs), tabs: read(LEGACY_KEYS.tabs) }
}

// ---------------------------------------------------------------------------------------------

/** The load in progress, shared so that two callers of init() do not load (or migrate) twice. */
let starting: Promise<void> | null = null

/**
 * How long the app waits for user.db before mounting anyway. Loading normally takes milliseconds; this only matters if
 * a call never returns (a stalled IPC, a command the web view is not allowed to call), which would otherwise leave a
 * blank window with no message.
 */
export const LOAD_TIMEOUT_MS = 5000

export function useUserData() {
  const notes = useState<UserNote[]>('user-notes', () => [])
  const highlights = useState<Record<string, HighlightColor>>('user-highlights', () => ({}))
  const prefs = useState<Prefs>('user-prefs', () => ({ ...DEFAULT_PREFS }))
  const settings = useState<Record<string, string>>('user-settings', () => ({}))
  const loaded = useState('user-data-loaded', () => false)
  /** Set when user.db could not be read or written. Shown by app.vue; a save that failed is never shown as saved. */
  const error = useState<string | null>('user-data-error', () => null)

  async function start() {
    try {
      type Setting = { key: string; value: string }
      let rows = await userQuery<Setting>('settings_all')
      if (!rows.some((r) => r.key === MIGRATED_SETTING)) {
        // One transaction: either everything from localStorage arrives along with the marker, or nothing does
        // and the next start tries again. It can never half apply and then duplicate notes on a retry.
        await userBatch([...legacyOps(readLegacy(), Date.now()), { name: 'setting_set', params: { key: MIGRATED_SETTING, value: '1' } }])
        rows = await userQuery<Setting>('settings_all')
      }
      settings.value = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      prefs.value = prefsFromSettings(settings.value)
      notes.value = (await userQuery<NoteRow>('notes_all')).map(noteFromRow).filter((n) => n !== null)
      highlights.value = highlightsFromRows(await userQuery<HighlightRow>('highlights_all'))
      loaded.value = true
      error.value = null
    } catch (err) {
      error.value = `Your notes, highlights and settings could not be loaded: ${errorMessage(err)}`
    }
  }

  /**
   * Loads everything from user.db. Call once on the client. Always resolves: on failure, or if loading takes longer
   * than `timeoutMs`, with `error` set and `loaded` still false. A load that finishes after the timeout still applies
   * its data and clears the error.
   */
  function init(timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    if (loaded.value) return Promise.resolve()
    const load = (starting ??= start().finally(() => { starting = null }))
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!loaded.value && !error.value) error.value = 'Your notes, highlights and settings are taking too long to load. Changes you make now may not be saved.'
        resolve()
      }, timeoutMs)
    })
    return Promise.race([load, timeout]).finally(() => clearTimeout(timer))
  }

  const failed = (err: unknown) => { error.value = `That change could not be saved: ${errorMessage(err)}` }

  // Notes and highlights are written first and shown second: if the write fails, the screen does not claim it.

  /** Resolves true once the note is saved, false if it was empty or the save failed. */
  async function addNote(osis: string, chapter: number, verse: number, body: string): Promise<boolean> {
    const text = body.trim()
    const book = BOOK_BY_OSIS[osis]
    if (!text || !book) return false
    const at = Date.now()
    try {
      const [row] = await userQuery<{ id: number }>('note_add', { book: book.id, chapter, verse, body: text, at })
      notes.value = [{ id: row!.id, osis, chapter, verse, body: text, at }, ...notes.value]
      return true
    } catch (err) {
      failed(err)
      return false
    }
  }
  async function removeNote(id: number) {
    try {
      await userQuery('note_remove', { id })
      notes.value = notes.value.filter((n) => n.id !== id)
    } catch (err) { failed(err) }
  }
  async function setHighlight(osis: string, chapter: number, verse: number, color: HighlightColor | null) {
    const book = BOOK_BY_OSIS[osis]
    if (!book) return
    const at = { book: book.id, chapter, verse }
    try {
      if (color) await userQuery('highlight_set', { ...at, color })
      else await userQuery('highlight_remove', at)
      const next = { ...highlights.value }
      const k = verseKey(osis, chapter, verse)
      if (color) next[k] = color
      else delete next[k]
      highlights.value = next
    } catch (err) { failed(err) }
  }

  // Settings are shown first and written behind: text size should follow the click, and a lost setting is cheap.

  const getSetting = (key: string): string | null => settings.value[key] ?? null
  async function setSetting(key: string, value: string) {
    settings.value = { ...settings.value, [key]: value }
    try { await userQuery('setting_set', { key, value }) } catch (err) { failed(err) }
  }
  function setPrefs(patch: Partial<Prefs>) {
    prefs.value = { ...prefs.value, ...patch }
    for (const [key, value] of Object.entries(patch)) void setSetting(PREF + key, JSON.stringify(value))
  }

  return { notes, highlights, prefs, error, loaded, init, addNote, removeNote, setHighlight, setPrefs, getSetting, setSetting }
}
