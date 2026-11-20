<script setup lang="ts">
import { BookOpen, Search, FileText } from 'lucide-vue-next'
import { BOOKS } from '~~/shared/books'
import { parseReference } from '~~/shared/reference'

const open = useState('palette-open', () => false)
const q = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null

interface Item { key: string; label: string; hint: string; icon: typeof Search; go: () => void }

const pages: Array<[string, string]> = [['Library', '/library'], ['Search', '/search'], ['Notes', '/notes'], ['Bookmarks', '/bookmarks'], ['Highlights', '/highlights'], ['Credits and licenses', '/credits']]

const items = computed<Item[]>(() => {
  const term = q.value.trim()
  if (!term) return pages.map(([label, to]) => ({ key: to, label, hint: 'Page', icon: FileText, go: () => navigateTo(to) }))
  const out: Item[] = []
  const ref_ = parseReference(term)
  if (ref_) {
    const ch = ref_.chapter ?? 1
    const label = `${ref_.book.name} ${ch}${ref_.verse ? `:${ref_.verse}${ref_.verseEnd ? `-${ref_.verseEnd}` : ''}` : ''}`
    out.push({
      key: 'ref', label, hint: 'Go to passage', icon: BookOpen,
      go: () => navigateTo({ path: `/read/${ref_.book.osis}/${ch}`, query: ref_.verse ? { v: ref_.verse } : {} }),
    })
  } else {
    const lower = term.toLowerCase()
    for (const b of BOOKS.filter((b) => b.name.toLowerCase().startsWith(lower)).slice(0, 4)) {
      out.push({ key: b.osis, label: b.name, hint: 'Open book', icon: BookOpen, go: () => navigateTo(`/read/${b.osis}/1`) })
    }
  }
  out.push({ key: 'search', label: `Search Scripture for “${term}”`, hint: 'Full text', icon: Search, go: () => navigateTo({ path: '/search', query: { q: term } }) })
  return out
})

watch(items, () => { active.value = 0 })
watch(open, async (v) => {
  if (v) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    q.value = ''
    await nextTick()
    input.value?.focus()
  } else {
    await nextTick()
    // Return focus to whatever opened the palette. A navigation may have removed it; then focus falls back to the body.
    if (opener?.isConnected) opener.focus()
    opener = null
  }
})

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function trapTab(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !dialog.value) return
  const els = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (!els.length) { e.preventDefault(); return }
  const first = els[0]!
  const last = els[els.length - 1]!
  const cur = document.activeElement
  if (e.shiftKey && (cur === first || !dialog.value.contains(cur))) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && (cur === last || !dialog.value.contains(cur))) { e.preventDefault(); first.focus() }
}

function run(i: Item | undefined) {
  if (!i) return
  open.value = false
  i.go()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = (active.value + 1) % items.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = (active.value - 1 + items.value.length) % items.value.length }
  else if (e.key === 'Enter') { e.preventDefault(); run(items.value[active.value]) }
  else if (e.key === 'Escape') { open.value = false }
}

function onGlobal(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open.value = !open.value }
}
onMounted(() => window.addEventListener('keydown', onGlobal))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobal))
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh]" @mousedown.self="open = false">
    <div ref="dialog" class="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" role="dialog" aria-label="Command palette" aria-modal="true" @keydown="trapTab">
      <div class="flex items-center gap-3 border-b border-line px-4">
        <Search class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <input
          ref="input" v-model="q" type="text" autocomplete="off" spellcheck="false"
          placeholder="Rom 8:28, Psalms 23, or words to search for"
          class="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          role="combobox" aria-expanded="true" aria-controls="palette-list" :aria-activedescendant="`pal-${active}`"
          @keydown="onKey"
        />
      </div>
      <ul id="palette-list" role="listbox" class="max-h-80 overflow-y-auto p-2">
        <li
          v-for="(it, i) in items" :id="`pal-${i}`" :key="it.key" role="option" :aria-selected="i === active"
          class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5"
          :class="i === active ? 'bg-accent-soft' : ''"
          @mousemove="active = i" @click="run(it)"
        >
          <component :is="it.icon" class="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span class="flex-1 truncate">{{ it.label }}</span>
          <span class="text-xs text-faint">{{ it.hint }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
