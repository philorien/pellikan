import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useUserData } from './useUserData.ts'

// Minimal stand-ins for Nuxt's useState and the browser's localStorage. Each key gets one shared holder,
// as useState does within an app instance.
const states = new Map()
globalThis.useState = (key, init) => {
  if (!states.has(key)) states.set(key, { value: init() })
  return states.get(key)
}

function stubLocalStorage(items) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (key) => items[key] ?? null, setItem() {} },
    configurable: true,
  })
}

beforeEach(() => {
  states.clear()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

test('saved translation is in prefs before init() runs', () => {
  stubLocalStorage({ 'pellikan.prefs': JSON.stringify({ translation: 'BSB' }) })

  const { prefs } = useUserData()

  assert.equal(prefs.value.translation, 'BSB')
})

test('without localStorage (SSR) prefs keep the default translation and nothing throws', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined')

  const { prefs } = useUserData()

  assert.equal(prefs.value.translation, 'WEB')
})
