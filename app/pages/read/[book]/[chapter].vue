<script setup lang="ts">
import { Bookmark, ChevronLeft, ChevronRight, Printer, Maximize2, Minimize2, PanelBottomOpen, X } from 'lucide-vue-next'
import { BOOKS, BOOK_BY_OSIS } from '~~/shared/books'
import type { Word } from '~/utils/types'

const route = useRoute()
const book = computed(() => BOOK_BY_OSIS[route.params.book as string])
const chapter = computed(() => Number(route.params.chapter))
const targetVerse = computed(() => Number(route.query.v) || null)

const { prefs, highlights, bookmarks, setPrefs, setBookmark, removeBookmark } = useUserData()
const lastRead = useState<string>('last-read', () => DEFAULT_PATH)
const translation = useTranslation()
const bibleError = useBibleError()
await translation.load()

function onTranslationChange(e: Event) {
  const el = e.target as HTMLSelectElement
  if (el.value === '__more') { el.value = translation.id.value; navigateTo('/library#translations'); return }
  translation.set(el.value)
}

const chapterCounts = useState<Record<number, number>>('chapters', () => ({}))
// Skipped when the translation list already failed: bible.db is unavailable and the books query would fail the same way.
if (!bibleError.value && !Object.keys(chapterCounts.value).length) {
  try {
    const rows = await query<{ id: number; chapters: number }>('books')
    chapterCounts.value = Object.fromEntries(rows.map((r) => [r.id, r.chapters]))
  } catch (err) {
    bibleError.value = errorMessage(err)
  }
}
const chapterCount = computed(() => (book.value ? chapterCounts.value[book.value.id] ?? 0 : 0))
const valid = computed(() => !!book.value && Number.isInteger(chapter.value) && chapter.value >= 1 && chapter.value <= chapterCount.value)

interface Verse { verse: number; text: string; tokens: string; para: number; poetry: number }
interface Heading { before_verse: number; kind: string; text: string }
interface Note { verse: number; seq: number; kind: string; text: string }

const { data, pending, error } = await useAsyncData(
  () => `chapter-${translation.id.value}-${route.params.book}-${route.params.chapter}`,
  async () => {
    if (!valid.value) return null
    const p = { translation: translation.id.value, book: book.value!.id, chapter: chapter.value }
    const [verses, headings, notes, words] = await Promise.all([
      query<Verse>('chapter_verses', p),
      query<Heading>('chapter_headings', p),
      query<Note>('chapter_notes', p),
      query<Word>('chapter_words', { book: p.book, chapter: p.chapter }),
    ])
    return { verses: verses.map((v) => ({ ...v, parsed: JSON.parse(v.tokens) })), headings, notes, words }
  },
  { watch: [() => route.params.book, () => route.params.chapter, translation.id] },
)

const selectedVerse = ref<number | null>(null)
const selectedNote = ref<{ kind: string; text: string } | null>(null)
const pickedWord = ref<Word | null>(null)
const guideTab = ref<'overview' | 'xref' | 'word' | 'library'>('overview')

watch(() => [route.params.book, route.params.chapter], () => {
  selectedVerse.value = targetVerse.value; selectedNote.value = null; pickedWord.value = null
})

function pickVerse(n: number) { selectedVerse.value = n; selectedNote.value = null; pickedWord.value = null }
function pickNote(verse: number, seq: number) {
  selectedVerse.value = verse
  selectedNote.value = data.value?.notes.find((n) => n.verse === verse && n.seq === seq) ?? null
  guideTab.value = 'overview'
}
function pickWord(w: Word) { pickedWord.value = w; guideTab.value = 'word' }

// Phones: the study panels live in a bottom sheet instead of beside the text.
const sheet = ref(false)
watch(() => route.fullPath, () => { sheet.value = false })

function printChapter() { window.print() }
function scrollToVerse(v: number) { document.getElementById(`v${v}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }

// Scroll to ?v= once the verses are on screen, and treat it as the selected verse.
watch([data, targetVerse], async () => {
  if (!targetVerse.value) return
  selectedVerse.value = targetVerse.value
  await nextTick()
  document.getElementById(`v${targetVerse.value}`)?.scrollIntoView({ block: 'center' })
}, { flush: 'post', immediate: true })

watch(() => route.fullPath, (p) => { if (valid.value && p.startsWith('/read/')) lastRead.value = p }, { immediate: true })

const prev = computed(() => {
  if (!book.value) return null
  if (chapter.value > 1) return { osis: book.value.osis, ch: chapter.value - 1 }
  const b = BOOKS[book.value.id - 2]
  return b ? { osis: b.osis, ch: chapterCounts.value[b.id] } : null
})
const next = computed(() => {
  if (!book.value) return null
  if (chapter.value < chapterCount.value) return { osis: book.value.osis, ch: chapter.value + 1 }
  const b = BOOKS[book.value.id]
  return b ? { osis: b.osis, ch: 1 } : null
})

const originalVerse = computed(() => selectedVerse.value ?? data.value?.verses[0]?.verse ?? 1)
const hlColor = (v: number) => highlights.value[verseKey(route.params.book as string, chapter.value, v)]

// The bookmark button marks the selected verse, or the start of the chapter (verse 1) when none is selected.
const bookmarkVerse = computed(() => selectedVerse.value ?? 1)
const bookmarked = computed(() => bookmarks.value.find((b) => b.osis === route.params.book && b.chapter === chapter.value && b.verse === bookmarkVerse.value) ?? null)
const bookmarkRef = computed(() => `${book.value?.name ?? ''} ${chapter.value}:${bookmarkVerse.value}`)
function toggleBookmark() {
  if (bookmarked.value) void removeBookmark(bookmarked.value.id)
  else void setBookmark(route.params.book as string, chapter.value, bookmarkVerse.value)
}

useHead(() => ({ title: valid.value ? `${book.value!.name} ${chapter.value} · Pellikan` : `${bibleError.value ? 'Bible data not available' : 'Passage not found'} · Pellikan` }))
</script>

<template>
  <div class="h-full p-2 md:p-4">
    <div
      class="grid h-full min-h-0 grid-cols-1 gap-4"
      :class="prefs.focus ? 'md:grid-rows-1' : 'md:grid-cols-[minmax(0,1fr)_21rem] md:grid-rows-[minmax(0,1fr)_13rem]'"
    >
      <!-- Reader -->
      <section class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface" aria-label="Reader">
        <div class="flex items-center gap-1 border-b border-line px-2 py-2 md:gap-2 md:px-3" data-chrome>
          <select
            v-if="translation.list.value.length > 1"
            :value="translation.id.value"
            class="rounded-md bg-surface-2 px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Translation"
            @change="onTranslationChange($event)"
          >
            <option v-for="t in translation.list.value" :key="t.id" :value="t.id">{{ t.id }}</option>
            <option value="__more">More translations…</option>
          </select>
          <NuxtLink v-else to="/library#translations" class="rounded-md bg-surface-2 px-2.5 py-1 text-sm font-medium hover:text-accent" title="Get more translations">{{ translation.id.value }}</NuxtLink>
          <PassagePicker :book="book" :chapter="chapter" />
          <div class="ml-auto flex items-center gap-0.5 text-muted">
            <button v-if="!prefs.focus && valid && data" type="button" class="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm hover:bg-surface-2 hover:text-fg md:hidden" aria-label="Open study panels" :aria-expanded="sheet" @click="sheet = true">
              <PanelBottomOpen class="size-5" aria-hidden="true" />Study
            </button>
            <button
              v-if="valid && data" type="button"
              class="grid size-10 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg md:size-9"
              :class="bookmarked ? 'text-accent' : ''"
              :aria-label="bookmarked ? `Remove the bookmark on ${bookmarkRef}` : `Bookmark ${bookmarkRef}`"
              :aria-pressed="!!bookmarked"
              @click="toggleBookmark"
            ><Bookmark class="size-5" :class="bookmarked ? 'fill-current' : ''" aria-hidden="true" /></button>
            <NuxtLink v-if="prev" :to="`/read/${prev.osis}/${prev.ch}`" class="grid size-10 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg md:size-9" aria-label="Previous chapter"><ChevronLeft class="size-5" /></NuxtLink>
            <NuxtLink v-if="next" :to="`/read/${next.osis}/${next.ch}`" class="grid size-10 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg md:size-9" aria-label="Next chapter"><ChevronRight class="size-5" /></NuxtLink>
            <span class="mx-1 hidden h-5 w-px bg-line md:block" aria-hidden="true" />
            <button type="button" class="hidden size-9 place-items-center rounded-lg text-sm hover:bg-surface-2 hover:text-fg disabled:opacity-30 md:grid" :disabled="prefs.fontSize <= 16" aria-label="Smaller text" @click="setPrefs({ fontSize: prefs.fontSize - 1 })">A&minus;</button>
            <button type="button" class="hidden size-9 place-items-center rounded-lg text-base hover:bg-surface-2 hover:text-fg disabled:opacity-30 md:grid" :disabled="prefs.fontSize >= 30" aria-label="Larger text" @click="setPrefs({ fontSize: prefs.fontSize + 1 })">A+</button>
            <button type="button" class="hidden size-9 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg md:grid" aria-label="Print this chapter" @click="printChapter"><Printer class="size-5" /></button>
            <button type="button" class="hidden size-9 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg md:grid" :aria-label="prefs.focus ? 'Show side panels' : 'Focus on the text'" :aria-pressed="prefs.focus" @click="setPrefs({ focus: !prefs.focus })">
              <Minimize2 v-if="prefs.focus" class="size-5" /><Maximize2 v-else class="size-5" />
            </button>
          </div>
        </div>

        <article class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
          <div v-if="bibleError" class="mx-auto max-w-prose">
            <h1 class="font-reading text-2xl">Bible data not available</h1>
            <p class="mt-2 text-muted">The reader needs <code>bible.db</code>. See the message above. In a source checkout, run <code>npm run data</code> and reload.</p>
          </div>
          <div v-else-if="!valid" class="mx-auto max-w-prose">
            <h1 class="font-reading text-2xl">Passage not found</h1>
            <p class="mt-2 text-muted">
              <template v-if="book">{{ book.name }} has {{ chapterCount }} chapters.</template>
              <template v-else>There is no book called "{{ route.params.book }}".</template>
            </p>
          </div>
          <div v-else class="mx-auto max-w-[44rem]">
            <h1 class="sr-only">{{ book!.name }} {{ chapter }}</h1>
            <p v-if="error" class="text-red-500">Could not load this chapter: {{ error.statusMessage || error.message }}</p>
            <p v-else-if="pending && !data" class="text-muted">Loading…</p>

            <div v-else-if="data" class="font-reading" :style="{ fontSize: `${prefs.fontSize}px`, lineHeight: 1.75 }">
              <template v-for="v in data.verses" :key="v.verse">
                <template v-for="(h, hi) in data.headings.filter((x) => x.before_verse === v.verse)" :key="`h${hi}`">
                  <h2 v-if="h.kind === 'ms'" class="mb-2 mt-8 font-sans text-[0.8rem] font-semibold uppercase tracking-wider text-accent">{{ h.text }}</h2>
                  <p v-else-if="h.kind === 'd' && data.words.some((w) => w.verse === 0)" class="mb-1 mt-4 text-center text-[0.9em] italic text-muted">
                    <button type="button" class="italic underline decoration-dotted underline-offset-4 hover:text-accent" title="Show the Hebrew title" @click="pickVerse(0)">{{ h.text }}</button>
                  </p>
                  <p v-else class="mb-1 mt-4 text-center text-[0.9em] italic text-muted">{{ h.text }}</p>
                </template>
                <span
                  :id="`v${v.verse}`"
                  class="cursor-pointer rounded-sm box-decoration-clone"
                  :class="[v.para ? 'mt-4 block' : '', v.poetry ? 'block pl-4' : 'inline', selectedVerse === v.verse ? 'bg-sel' : '']"
                  :style="selectedVerse !== v.verse && hlColor(v.verse) ? { background: `var(--hl-${hlColor(v.verse)})` } : undefined"
                  @click="pickVerse(v.verse)"
                >
                  <button
                    type="button"
                    class="mr-1 align-super font-sans text-[0.6em] font-semibold text-faint hover:text-accent"
                    :class="selectedVerse === v.verse ? 'text-accent' : ''"
                    :aria-label="`Verse ${v.verse}`"
                    :aria-pressed="selectedVerse === v.verse"
                    @click.stop="pickVerse(v.verse)"
                  >{{ v.verse }}</button>
                  <VerseText :tokens="v.parsed" :red-letters="prefs.redLetters" @note="(seq) => pickNote(v.verse, seq)" />{{ ' ' }}
                </span>
              </template>
              <p class="mt-10 font-sans text-xs text-faint">{{ translation.info.value?.attribution }} See Credits for the original-language data sources.</p>
            </div>
          </div>
        </article>
      </section>

      <!-- Study panels: grid items on desktop (display: contents), a bottom sheet on phones -->
      <div
        v-if="!prefs.focus && valid && data"
        data-chrome
        :class="sheet
          ? 'fixed inset-x-0 top-[env(safe-area-inset-top)] bottom-[var(--nav-h)] z-30 flex flex-col bg-bg md:contents'
          : 'hidden md:contents'"
        :role="sheet ? 'dialog' : undefined" :aria-label="sheet ? 'Study panels' : undefined" :aria-modal="sheet ? 'true' : undefined"
      >
        <div class="flex items-center justify-between border-b border-line px-4 py-2 md:hidden">
          <h2 class="text-sm font-semibold">Study</h2>
          <button type="button" class="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close study panels" @click="sheet = false"><X class="size-5" /></button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:contents">
          <div class="flex flex-col gap-4 max-md:[&>section]:max-h-[28rem] max-md:[&>section]:flex-none md:col-start-2 md:row-start-1 md:min-h-0">
            <StudyGuide
              v-model:tab="guideTab"
              :book-id="book!.id" :verse="selectedVerse" :book-name="book!.name" :chapter="chapter" :verse-count="data.verses.length"
              :headings="data.headings" :notes="data.notes" :footnote="selectedNote" :word="pickedWord"
              @goto="(v: number) => { sheet = false; scrollToVerse(v) }"
            />
            <NotesPanel :osis="book!.osis" :book-name="book!.name" :chapter="chapter" :verse="selectedVerse" />
          </div>
          <div class="flex flex-col gap-4 max-md:[&>section]:max-h-[28rem] max-md:[&>section]:flex-none md:col-span-2 md:row-start-2 md:grid md:grid-cols-3">
            <OriginalPanel :words="data.words" :verse="originalVerse" :label="`${book!.name} ${chapter}:${originalVerse}`" :testament="book!.testament" :picked="pickedWord" @pick="pickWord" />
            <CommentaryPanel :book-id="book!.id" :book-name="book!.name" :chapter="chapter" :verse="selectedVerse" />
            <LibraryPanel />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
