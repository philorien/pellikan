<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { BOOK_BY_ID } from '~~/shared/books'
import { toFtsQuery } from '~~/shared/text'
import type { DocumentHit } from '~/composables/useDocuments'

const route = useRoute()
const translation = useTranslation()
await translation.load()
const input = ref(String(route.query.q ?? ''))
const PAGE = 25

interface Hit { book_id: number; chapter: number; verse: number; snippet: string }

const term = computed(() => String(route.query.q ?? ''))
const page = computed(() => Math.max(1, Number(route.query.p) || 1))
/** Which results are showing: the Bible, or the books the user imported. */
const scope = computed<'bible' | 'books'>(() => (route.query.in === 'books' ? 'books' : 'bible'))

const { data, pending, error } = await useAsyncData(
  'search',
  async () => {
    const q = toFtsQuery(term.value, { prefix: false })
    if (!q) return null
    const base = { q, translation: translation.id.value }
    const [hits, total] = await Promise.all([
      query<Hit>('search_verses', { ...base, limit: PAGE, offset: (page.value - 1) * PAGE }),
      query<{ total: number }>('search_verses_count', base),
    ])
    return { hits, total: total[0]?.total ?? 0 }
  },
  { watch: [term, page, translation.id] },
)

// Passages in the user's imported books. Fetched whichever side is showing, so both tabs can say how many they found.
// A failure here (user.db unavailable) is shown on that tab only and never touches the Bible results.
const books = await useAsyncData(
  'search-books',
  async () => {
    const q = toFtsQuery(term.value, { prefix: false })
    if (!q) return null
    return await searchDocuments(q, PAGE, scope.value === 'books' ? (page.value - 1) * PAGE : 0)
  },
  { watch: [term, page, scope] },
)

watch(term, (t) => { input.value = t })

const linkTo = (p = 1, to = scope.value) => ({ path: '/search', query: { q: term.value || undefined, in: to === 'books' ? 'books' : undefined, p: p > 1 ? p : undefined } })
function submit() {
  navigateTo({ path: '/search', query: { q: input.value.trim() || undefined, in: scope.value === 'books' ? 'books' : undefined } })
}

// "Show the passage" on a book result: which ones are open.
const openChunks = ref<Set<number>>(new Set())
watch([term, page, scope], () => { openChunks.value = new Set() })
function toggleChunk(id: number) {
  const next = new Set(openChunks.value)
  if (!next.delete(id)) next.add(id)
  openChunks.value = next
}
const where = (h: DocumentHit) => [h.heading, h.loc].filter(Boolean).join(', ')

// snippet() wraps hits in control characters 0x02/0x03. Split on them and render <mark> ourselves: no v-html.
function segments(snippet: string): Array<{ text: string; hit: boolean }> {
  return snippet.split(/(\u0002[^\u0003]*\u0003)/).filter(Boolean).map((s) =>
    s.startsWith('\u0002') ? { text: s.slice(1, -1), hit: true } : { text: s, hit: false })
}

const total = computed(() => (scope.value === 'books' ? books.data.value?.total : data.value?.total) ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)))
useHead({ title: 'Search · Pellikan' })
</script>

<template>
  <div class="h-full overflow-y-auto p-2 md:p-4">
    <div class="mx-auto max-w-3xl rounded-xl border border-line bg-surface px-4 py-5 md:px-6 md:py-6">
      <h1 class="font-reading text-3xl font-semibold">{{ scope === 'books' ? 'Search your books' : `Search the ${translation.info.value?.name ?? 'Bible'}` }}</h1>
      <form class="mt-4 flex gap-2" @submit.prevent="submit">
        <div class="flex flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 focus-within:border-accent">
          <Search class="size-4 text-muted" aria-hidden="true" />
          <input v-model="input" type="search" placeholder='love, "good shepherd", faith hope' aria-label="Search terms" class="h-10 flex-1 bg-transparent outline-none placeholder:text-faint" />
        </div>
        <button class="rounded-lg bg-accent px-4 font-medium text-accent-fg hover:opacity-90">Search</button>
      </form>
      <p class="mt-2 text-xs text-faint">Words are stemmed (loved finds love). Put a phrase in quotes. Every word must appear in the {{ scope === 'books' ? 'passage' : 'verse' }}.</p>

      <nav v-if="term" class="mt-5 flex gap-5 border-b border-line text-sm" aria-label="Search in">
        <NuxtLink
          v-for="t in [{ id: 'bible', label: 'Bible', count: data?.total }, { id: 'books', label: 'Your books', count: books.data.value?.total }]" :key="t.id"
          :to="linkTo(1, t.id as 'bible' | 'books')"
          class="-mb-px border-b-2 pb-2"
          :class="scope === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
          :aria-current="scope === t.id ? 'page' : undefined"
        >{{ t.label }}<span v-if="t.count !== undefined" class="ml-1.5 text-xs text-faint">{{ t.count.toLocaleString() }}</span></NuxtLink>
      </nav>

      <template v-if="scope === 'bible'">
        <p v-if="error" class="mt-6 text-red-500">Search failed: {{ error.statusMessage || error.message }}</p>
        <p v-else-if="pending" class="mt-6 text-muted">Searching…</p>
        <p v-else-if="term && !data" class="mt-6 text-muted">No searchable words found in query.</p>
        <template v-else-if="data">
          <p class="mt-6 text-sm text-muted">{{ data.total.toLocaleString() }} verse{{ data.total === 1 ? '' : 's' }}</p>
          <ul class="mt-2 divide-y divide-line">
            <li v-for="h in data.hits" :key="`${h.book_id}-${h.chapter}-${h.verse}`" class="py-3">
              <NuxtLink :to="{ path: `/read/${BOOK_BY_ID[h.book_id]?.osis}/${h.chapter}`, query: { v: h.verse } }" class="font-medium text-accent hover:underline">
                {{ BOOK_BY_ID[h.book_id]?.name }} {{ h.chapter }}:{{ h.verse }}
              </NuxtLink>
              <p class="font-reading">
                <template v-for="(s, i) in segments(h.snippet)" :key="i"><mark v-if="s.hit" class="hit">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>
              </p>
            </li>
          </ul>
          <p v-if="data.total === 0" class="mt-4">No verses matched.</p>
        </template>
      </template>

      <template v-else>
        <p v-if="books.error.value" class="mt-6 text-red-500">Could not search your books: {{ books.error.value.statusMessage || books.error.value.message }}</p>
        <p v-else-if="books.pending.value" class="mt-6 text-muted">Searching…</p>
        <p v-else-if="term && !books.data.value" class="mt-6 text-muted">No searchable words found in query.</p>
        <template v-else-if="books.data.value">
          <p class="mt-6 text-sm text-muted">{{ books.data.value.total.toLocaleString() }} passage{{ books.data.value.total === 1 ? '' : 's' }} in your books</p>
          <ul class="mt-2 divide-y divide-line">
            <li v-for="h in books.data.value.hits" :key="h.chunk_id" class="py-3">
              <p class="font-medium">{{ h.title }}<span v-if="h.author" class="font-normal text-muted"> · {{ h.author }}</span></p>
              <p v-if="where(h)" class="text-xs text-faint">{{ where(h) }}</p>
              <p v-if="!openChunks.has(h.chunk_id)" class="font-reading">
                <template v-for="(s, i) in segments(h.snippet)" :key="i"><mark v-if="s.hit" class="hit">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>
              </p>
              <p v-else class="whitespace-pre-line font-reading">{{ h.text }}</p>
              <button type="button" class="mt-1 text-xs text-accent hover:underline" :aria-expanded="openChunks.has(h.chunk_id)" @click="toggleChunk(h.chunk_id)">
                {{ openChunks.has(h.chunk_id) ? 'Show the match only' : 'Show the whole passage' }}
              </button>
            </li>
          </ul>
          <p v-if="books.data.value.total === 0" class="mt-4">
            No passages matched. <NuxtLink to="/library" class="text-accent hover:underline">Import a book</NuxtLink> to search it here.
          </p>
        </template>
        <p v-else class="mt-6 text-muted">Search the text of the books you have imported. Plain text and Markdown files can be imported from the <NuxtLink to="/library" class="text-accent hover:underline">Library</NuxtLink>.</p>
      </template>

      <nav v-if="term && pages > 1" class="mt-6 flex items-center gap-4 text-sm" aria-label="Pages">
        <NuxtLink v-if="page > 1" :to="linkTo(page - 1)" class="text-accent hover:underline">&larr; Previous</NuxtLink>
        <span class="text-muted">Page {{ page }} of {{ pages }}</span>
        <NuxtLink v-if="page < pages" :to="linkTo(page + 1)" class="text-accent hover:underline">Next &rarr;</NuxtLink>
      </nav>
    </div>
  </div>
</template>
