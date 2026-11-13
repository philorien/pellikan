import { BOOK_BY_OSIS } from '../../shared/books.ts'
import { TABS_SETTING } from './useUserData.ts'

// Browser-style tabs. A tab is just a route; the route drives the active tab (navigating inside a tab
// replaces that tab's path), and clicking a tab navigates back to its path.
//
// The open tabs are saved as one row in user.db's settings table, through useUserData.ts.

export interface Tab { id: string; path: string }
export interface SavedTabs { tabs: Tab[]; activeId: string }

/** The saved tabs, or null if the stored value is missing or not the expected shape. */
export function parseSavedTabs(raw: string | null): SavedTabs | null {
  try {
    const saved = JSON.parse(raw ?? 'null')
    const ok = saved && Array.isArray(saved.tabs) && saved.tabs.every((t: Tab) => t && typeof t.id === 'string' && typeof t.path === 'string')
    return ok ? { tabs: saved.tabs.map((t: Tab) => ({ id: t.id, path: t.path })), activeId: typeof saved.activeId === 'string' ? saved.activeId : '' } : null
  } catch { return null }
}

export const DEFAULT_PATH = '/read/John/1'

let seq = 0
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`

/** Human title for a path, e.g. /read/Rom/8 -> "Romans 8". */
export function tabTitle(path: string): { title: string; kind: 'read' | 'search' | 'page' } {
  const url = new URL(path, 'http://x')
  const m = url.pathname.match(/^\/read\/([^/]+)\/(\d+)/)
  if (m) return { title: `${BOOK_BY_OSIS[m[1]!]?.name ?? m[1]} ${m[2]}`, kind: 'read' }
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q')
    return { title: q ? `Search: ${q}` : 'Search', kind: 'search' }
  }
  const names: Record<string, string> = { '/credits': 'Credits', '/library': 'Library', '/dictionary': 'Dictionary', '/notes': 'Notes', '/highlights': 'Highlights' }
  return { title: names[url.pathname] ?? 'Pellikan', kind: 'page' }
}

export function useTabs() {
  const tabs = useState<Tab[]>('tabs', () => [])
  const activeId = useState<string>('tabs-active', () => '')
  /** False until restore() has run. Until then the tabs are not tracked, so an early route change is ignored. */
  const restored = useState('tabs-restored', () => false)
  /**
   * Whether the tabs may be written back. Only if the saved tabs were actually read: when user.db failed or was too
   * slow to load, restore() starts from a default tab list, and saving that would overwrite the real one. The tabs
   * still work for the session; they are just not saved. Decided once, in restore(), so a load that finishes late
   * does not switch saving on for a tab list that never came from it.
   */
  const saving = useState('tabs-saving', () => false)
  const { getSetting, setSetting, loaded } = useUserData()

  function persist() {
    if (restored.value && saving.value) void setSetting(TABS_SETTING, JSON.stringify({ tabs: tabs.value, activeId: activeId.value }))
  }

  /** Call once, after useUserData().init() has resolved: the saved tabs come from the settings it loaded. */
  function restore(currentPath: string) {
    const saved = parseSavedTabs(getSetting(TABS_SETTING))
    if (saved) {
      tabs.value = saved.tabs
      activeId.value = saved.activeId
    }
    restored.value = true
    saving.value = loaded.value
    // Launching at the default route means the app had no path of its own, so go back to where the saved active tab was.
    // Replace, like the default redirect in pages/index.vue, so launching does not add a history entry.
    const active = tabs.value.find((t) => t.id === activeId.value)
    if (saved && active && (currentPath === '/' || currentPath === DEFAULT_PATH)) return navigateTo(active.path, { replace: true })
    sync(currentPath)
  }

  /** Called whenever the route changes. */
  function sync(path: string) {
    if (!restored.value) return
    const active = tabs.value.find((t) => t.id === activeId.value)
    if (active) active.path = path
    else {
      const id = newId()
      tabs.value = [...tabs.value, { id, path }]
      activeId.value = id
    }
    persist()
  }

  function open(path = DEFAULT_PATH) {
    const id = newId()
    tabs.value = [...tabs.value, { id, path }]
    activeId.value = id
    persist()
    return navigateTo(path)
  }

  function activate(id: string) {
    const t = tabs.value.find((x) => x.id === id)
    if (!t) return
    activeId.value = id
    persist()
    return navigateTo(t.path)
  }

  function close(id: string) {
    const i = tabs.value.findIndex((t) => t.id === id)
    if (i < 0) return
    const wasActive = id === activeId.value
    tabs.value = tabs.value.filter((t) => t.id !== id)
    if (!tabs.value.length) {
      // Never leave the window with no tab: closing the last one resets it to the default passage.
      const nid = newId()
      tabs.value = [{ id: nid, path: DEFAULT_PATH }]
      activeId.value = nid
      persist()
      return navigateTo(DEFAULT_PATH)
    }
    if (wasActive) {
      const next = tabs.value[Math.min(i, tabs.value.length - 1)]!
      activeId.value = next.id
      persist()
      return navigateTo(next.path)
    }
    persist()
  }

  return { tabs, activeId, restore, sync, open, activate, close }
}
