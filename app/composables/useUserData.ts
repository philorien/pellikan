// Notes, highlights and reading preferences.
//
// Stored in localStorage for now. The real home for notes and highlights is user.db (the schema exists in
// data/schema/user.sql) but the Rust side has no write commands yet. Everything goes through this file, so
// moving to user.db later means changing the load/save functions here and nothing in the components.

export interface UserNote { id: string; osis: string; chapter: number; verse: number; body: string; at: number }
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'rose'
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'rose']

export interface Prefs { fontSize: number; redLetters: boolean; focus: boolean; translation: string }

const KEYS = { notes: 'pellikan.notes', highlights: 'pellikan.highlights', prefs: 'pellikan.prefs' }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...(Array.isArray(fallback) ? {} : fallback as object), ...JSON.parse(raw) } as T : fallback
  } catch { return fallback }
}
function loadList<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked: keep working in memory */ }
}

export const verseKey = (osis: string, chapter: number, verse: number) => `${osis}.${chapter}.${verse}`

export function useUserData() {
  const notes = useState<UserNote[]>('user-notes', () => [])
  const highlights = useState<Record<string, HighlightColor>>('user-highlights', () => ({}))
  const prefs = useState<Prefs>('user-prefs', () => ({ fontSize: 20, redLetters: true, focus: false, translation: 'WEB' }))
  const loaded = useState('user-data-loaded', () => false)

  // Preferences are needed during page setup (before app.vue's mounted hook). Read them eagerly
  // in the browser so the reader's first query uses the saved translation. Keep SSR deterministic.
  if (!loaded.value && typeof localStorage !== 'undefined') {
    prefs.value = load<Prefs>(KEYS.prefs, prefs.value)
  }

  function init() {
    if (loaded.value) return
    notes.value = loadList<UserNote>(KEYS.notes)
    highlights.value = load<Record<string, HighlightColor>>(KEYS.highlights, {})
    prefs.value = load<Prefs>(KEYS.prefs, prefs.value)
    loaded.value = true
  }

  function addNote(osis: string, chapter: number, verse: number, body: string) {
    const text = body.trim()
    if (!text) return
    notes.value = [{ id: crypto.randomUUID(), osis, chapter, verse, body: text, at: Date.now() }, ...notes.value]
    save(KEYS.notes, notes.value)
  }
  function removeNote(id: string) {
    notes.value = notes.value.filter((n) => n.id !== id)
    save(KEYS.notes, notes.value)
  }
  function setHighlight(osis: string, chapter: number, verse: number, color: HighlightColor | null) {
    const next = { ...highlights.value }
    const k = verseKey(osis, chapter, verse)
    if (color) next[k] = color
    else delete next[k]
    highlights.value = next
    save(KEYS.highlights, next)
  }
  function setPrefs(patch: Partial<Prefs>) {
    prefs.value = { ...prefs.value, ...patch }
    save(KEYS.prefs, prefs.value)
  }

  return { notes, highlights, prefs, init, addNote, removeNote, setHighlight, setPrefs }
}
