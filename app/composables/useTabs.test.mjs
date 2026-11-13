import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabTitle, useTabs, DEFAULT_PATH } from './useTabs.ts'
import { verseKey, HIGHLIGHT_COLORS, useUserData, TABS_SETTING } from './useUserData.ts'

test('restore keeps the saved active path when launched at the default route', async () => {
  const saved = { tabs: [{ id: 'a', path: DEFAULT_PATH }, { id: 'b', path: '/read/Rom/8' }], activeId: 'b' }
  const navigated = []
  // Nuxt globals do not exist under node:test, so stub the ones restore() touches. The saved tabs are a row in
  // user.db's settings table, which useUserData() has already loaded into the 'user-settings' state.
  const states = new Map()
  globalThis.useState = (key, init) => {
    if (!states.has(key)) states.set(key, { value: init() })
    return states.get(key)
  }
  globalThis.useUserData = useUserData // Nuxt auto-imports it inside useTabs.ts
  globalThis.navigateTo = (path, opts) => { navigated.push({ path, replace: opts?.replace }); return Promise.resolve() }
  try {
    useUserData() // creates the settings state
    states.get('user-data-loaded').value = true
    states.get('user-settings').value = { [TABS_SETTING]: JSON.stringify(saved) }
    const { tabs, restore } = useTabs()
    await restore(DEFAULT_PATH)
    assert.equal(tabs.value.find((t) => t.id === 'b').path, '/read/Rom/8', 'restore must keep the saved active path')
    assert.deepEqual(navigated, [{ path: '/read/Rom/8', replace: true }], 'launch must replace the history entry, not add one')
  } finally {
    delete globalThis.useState
    delete globalThis.useUserData
    delete globalThis.navigateTo
  }
})

test('tabTitle parses reader routes', () => {
  assert.deepEqual(tabTitle('/read/Rom/8'), { title: 'Romans 8', kind: 'read' })
  assert.deepEqual(tabTitle('/read/1Cor/13'), { title: '1 Corinthians 13', kind: 'read' })
  assert.deepEqual(tabTitle('/read/John/1'), { title: 'John 1', kind: 'read' })
  assert.deepEqual(tabTitle('/read/Ps/23'), { title: 'Psalms 23', kind: 'read' })
  // Unknown book fallback uses the raw segment
  assert.deepEqual(tabTitle('/read/UnknownBook/5'), { title: 'UnknownBook 5', kind: 'read' })
})

test('tabTitle parses search routes with and without query', () => {
  assert.deepEqual(tabTitle('/search'), { title: 'Search', kind: 'search' })
  assert.deepEqual(tabTitle('/search?q=grace'), { title: 'Search: grace', kind: 'search' })
  assert.deepEqual(tabTitle('/search?q='), { title: 'Search', kind: 'search' })
})

test('tabTitle parses known static pages and fallbacks', () => {
  assert.deepEqual(tabTitle('/library'), { title: 'Library', kind: 'page' })
  assert.deepEqual(tabTitle('/dictionary'), { title: 'Dictionary', kind: 'page' })
  assert.deepEqual(tabTitle('/notes'), { title: 'Notes', kind: 'page' })
  assert.deepEqual(tabTitle('/highlights'), { title: 'Highlights', kind: 'page' })
  assert.deepEqual(tabTitle('/credits'), { title: 'Credits', kind: 'page' })
  assert.deepEqual(tabTitle('/custom-route'), { title: 'Pellikan', kind: 'page' })
})

test('DEFAULT_PATH points to John 1', () => {
  assert.equal(DEFAULT_PATH, '/read/John/1')
})

test('verseKey creates expected canonical key string', () => {
  assert.equal(verseKey('Rom', 8, 28), 'Rom.8.28')
  assert.equal(verseKey('Gen', 1, 1), 'Gen.1.1')
})

test('HIGHLIGHT_COLORS defines standard palette', () => {
  assert.deepEqual(HIGHLIGHT_COLORS, ['yellow', 'green', 'blue', 'rose'])
})


test('tabs restored after a failed load are never written over the saved ones', async () => {
  const states = new Map()
  const writes = []
  globalThis.useState = (key, init) => {
    if (!states.has(key)) states.set(key, { value: init() })
    return states.get(key)
  }
  globalThis.useUserData = useUserData
  globalThis.navigateTo = () => Promise.resolve()
  globalThis.userQuery = async (name, params) => { writes.push({ name, params }); return [] }
  try {
    useUserData() // user.db failed to load: loaded stays false and settings stay empty
    const { restore, sync, open } = useTabs()
    await restore('/read/Rom/8')
    sync('/read/Ps/23')
    await open('/read/Gen/1')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(writes, [], 'nothing may be saved over the real tabs row')

    // A load that finishes late does not switch saving on for this session's tab list.
    states.get('user-data-loaded').value = true
    sync('/read/Ps/24')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(writes, [])
  } finally {
    delete globalThis.useState
    delete globalThis.useUserData
    delete globalThis.navigateTo
    delete globalThis.userQuery
  }
})
