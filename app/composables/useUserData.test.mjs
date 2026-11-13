import { test, beforeEach } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { legacyOps, noteFromRow, highlightsFromRows, prefsFromSettings, useUserData, DEFAULT_PREFS, TABS_SETTING, MIGRATED_SETTING } from './useUserData.ts'
import { parseSavedTabs } from './useTabs.ts'

const NOW = 1_800_000_000_000

test('legacyOps copies notes oldest first, with their dates and canonical book ids', () => {
  const ops = legacyOps({
    notes: [
      { id: 'b', osis: 'Rom', chapter: 8, verse: 28, body: 'newer', at: 2000 },
      { id: 'a', osis: 'John', chapter: 3, verse: 16, body: 'older', at: 1000 },
    ],
  }, NOW)
  assert.deepEqual(ops, [
    { name: 'note_add', params: { book: 43, chapter: 3, verse: 16, body: 'older', at: 1000 } },
    { name: 'note_add', params: { book: 45, chapter: 8, verse: 28, body: 'newer', at: 2000 } },
  ])
})

test('legacyOps skips malformed notes instead of failing the whole copy', () => {
  const ops = legacyOps({
    notes: [
      null,
      'text',
      { osis: 'Nope', chapter: 1, verse: 1, body: 'unknown book', at: 1 },
      { osis: 'Gen', chapter: '1', verse: 1, body: 'chapter is a string', at: 1 },
      { osis: 'Gen', chapter: 1, verse: 1, body: '   ', at: 1 },
      { osis: 'Gen', chapter: 0, verse: 1, body: 'chapter 0', at: 1 },
      { osis: 'Gen', chapter: 1, verse: 0, body: 'verse 0', at: 1 },
      { osis: 'Gen', chapter: 1, verse: 1, body: 'no date' },
    ],
  }, NOW)
  assert.deepEqual(ops, [{ name: 'note_add', params: { book: 1, chapter: 1, verse: 1, body: 'no date', at: NOW } }])
  assert.deepEqual(legacyOps({ notes: { not: 'a list' }, highlights: ['x'], prefs: 'big', tabs: 'open' }, NOW), [])
  assert.deepEqual(legacyOps({ notes: null, highlights: null, prefs: null, tabs: null }, NOW), [])
})

test('legacyOps copies highlights, preferences and tabs', () => {
  const tabs = { tabs: [{ id: 't1', path: '/read/Rom/8' }], activeId: 't1' }
  const ops = legacyOps({
    highlights: { 'Ps.23.1': 'yellow', '1Cor.13.4': 'rose', 'Ps.23.2': 'purple', 'Bogus.1.1': 'blue', 'Ps.x.1': 'blue', 'Ps..1': 'blue', 'Ps.23.': 'blue', 'Ps.0.1': 'blue' },
    prefs: { fontSize: 24, redLetters: false, translation: 'KJV', focus: 'yes', unknown: 1 },
    tabs,
  }, NOW)
  assert.deepEqual(ops, [
    { name: 'highlight_set', params: { book: 19, chapter: 23, verse: 1, color: 'yellow' } },
    { name: 'highlight_set', params: { book: 46, chapter: 13, verse: 4, color: 'rose' } },
    { name: 'setting_set', params: { key: 'prefs.fontSize', value: '24' } },
    { name: 'setting_set', params: { key: 'prefs.redLetters', value: 'false' } },
    { name: 'setting_set', params: { key: 'prefs.translation', value: '"KJV"' } },
    { name: 'setting_set', params: { key: TABS_SETTING, value: JSON.stringify(tabs) } },
  ])
})

test('rows from user.db become the shapes the UI uses', () => {
  assert.deepEqual(noteFromRow({ id: 7, book_id: 45, chapter: 8, verse: 28, body: 'x', at: 5000 }), { id: 7, osis: 'Rom', chapter: 8, verse: 28, body: 'x', at: 5000 })
  assert.equal(noteFromRow({ id: 8, book_id: 99, chapter: 1, verse: 1, body: 'x', at: 0 }), null)
  assert.deepEqual(
    highlightsFromRows([
      { book_id: 19, chapter: 23, verse: 1, color: 'green' },
      { book_id: 19, chapter: 23, verse: 2, color: 'url(evil)' },
      { book_id: 0, chapter: 1, verse: 1, color: 'green' },
    ]),
    { 'Ps.23.1': 'green' },
  )
})

test('prefsFromSettings keeps defaults for missing, unreadable or wrongly typed values', () => {
  assert.deepEqual(prefsFromSettings({}), DEFAULT_PREFS)
  assert.deepEqual(
    prefsFromSettings({ 'prefs.fontSize': '26', 'prefs.redLetters': 'false', 'prefs.focus': '"yes"', 'prefs.translation': '{bad', tabs: '[]' }),
    { fontSize: 26, redLetters: false, focus: false, translation: 'WEB' },
  )
})

test('parseSavedTabs accepts only the expected shape', () => {
  assert.deepEqual(parseSavedTabs('{"tabs":[{"id":"t1","path":"/read/Rom/8","extra":1}],"activeId":"t1"}'), { tabs: [{ id: 't1', path: '/read/Rom/8' }], activeId: 't1' })
  assert.deepEqual(parseSavedTabs('{"tabs":[]}'), { tabs: [], activeId: '' })
  for (const bad of [null, '', 'nope', '{}', '{"tabs":[{"id":1,"path":"/"}]}', '{"tabs":[null]}', '[]']) assert.equal(parseSavedTabs(bad), null)
})

// ---------------------------------------------------------------------------------------------
// init(): the saved preferences have to be in place before the first page sets up (plugins/user-data.client.ts
// awaits it), or the reader's first query runs in the default translation and then switches.
// ---------------------------------------------------------------------------------------------

const states = new Map()
globalThis.useState = (key, init) => {
  if (!states.has(key)) states.set(key, { value: init() })
  return states.get(key)
}
globalThis.errorMessage = (err) => (err instanceof Error ? err.message : String(err))

/** Stands in for user.db: answers the four read statements and records the batches. */
function stubUserDb({ settings = [], notes = [], highlights = [], fail = false } = {}) {
  const batches = []
  globalThis.userQuery = async (name) => {
    if (fail) throw new Error('user.db is locked')
    return { settings_all: settings, notes_all: notes, highlights_all: highlights }[name] ?? []
  }
  globalThis.userBatch = async (ops) => { batches.push(ops) }
  return batches
}

beforeEach(() => states.clear())

test('init() puts the saved translation in prefs, and migrates nothing once the marker is set', async () => {
  const batches = stubUserDb({ settings: [{ key: MIGRATED_SETTING, value: '1' }, { key: 'prefs.translation', value: '"BSB"' }] })
  const { prefs, init } = useUserData()
  assert.equal(prefs.value.translation, 'WEB') // the default until init() has run
  await init()
  assert.equal(prefs.value.translation, 'BSB')
  assert.deepEqual(batches, [])
})

test('init() runs the localStorage copy once, with its marker in the same batch', async () => {
  const batches = stubUserDb()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true })
  try {
    await useUserData().init()
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0].at(-1), { name: 'setting_set', params: { key: MIGRATED_SETTING, value: '1' } })
})

test('if user.db cannot be read, init() resolves, says so, and prefs keep the defaults', async () => {
  stubUserDb({ fail: true })
  const { prefs, error, init } = useUserData()
  await init()
  assert.equal(prefs.value.translation, 'WEB')
  assert.match(error.value, /could not be loaded: user\.db is locked/)
})

test('the client plugin waits for init() before the app mounts', () => {
  const plugin = readFileSync(new URL('../plugins/user-data.client.ts', import.meta.url), 'utf8')
  assert.match(plugin, /await\s+useUserData\(\)\.init\(\)/)
})

test('if user.db never answers, init() resolves after the timeout with an error, and a late answer still applies', async () => {
  let answer
  globalThis.userQuery = (name) => (name === 'settings_all' && !answer ? new Promise((resolve) => { answer = resolve }) : Promise.resolve([]))
  const { prefs, error, loaded, init } = useUserData()
  await init(20)
  assert.equal(loaded.value, false)
  assert.match(error.value, /taking too long/)

  answer([{ key: MIGRATED_SETTING, value: '1' }, { key: 'prefs.translation', value: '"KJV"' }])
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(loaded.value, true)
  assert.equal(prefs.value.translation, 'KJV')
  assert.equal(error.value, null)
})
