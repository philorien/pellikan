<script setup lang="ts">
import type { CitingPassage } from '~/composables/useDocuments'

// Passages from the user's own imported books that cite the selected verse (found when the book was imported, see
// shared/reference-scan.ts). Imported text is shown as text, never as HTML.
const props = defineProps<{ bookId: number; chapter: number; verse: number | null; bookName: string }>()

const passages = ref<CitingPassage[]>([])
const loading = ref(false)
const failed = ref('')
const open = ref<Set<number>>(new Set())

watch(() => [props.bookId, props.chapter, props.verse] as const, async ([book, chapter, verse]) => {
  passages.value = []; failed.value = ''; open.value = new Set()
  if (!verse) return
  loading.value = true
  try {
    const rows = await citingPassages(book, chapter, verse)
    if (props.verse === verse && props.chapter === chapter && props.bookId === book) passages.value = rows
  } catch (err) {
    failed.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}, { immediate: true })

const strong = computed(() => passages.value.filter((p) => p.confidence === 'high'))
const weak = computed(() => passages.value.filter((p) => p.confidence === 'medium'))
const at = computed(() => `${props.bookName} ${props.chapter}:${props.verse}`)

function toggle(id: number) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
const where = (p: CitingPassage) => [p.heading, p.loc].filter(Boolean).join(', ')
</script>

<template>
  <div class="text-sm">
    <p v-if="!verse" class="text-muted">Select a verse to see where your own books cite it.</p>
    <p v-else-if="failed" class="text-red-500">Could not search your books: {{ failed }}</p>
    <p v-else-if="loading" class="text-muted">Looking through your books…</p>
    <p v-else-if="!passages.length" class="text-muted">
      None of your imported books cite {{ at }}. <NuxtLink to="/library" class="text-accent hover:underline">Import a book</NuxtLink> to see its references here.
    </p>
    <template v-else>
      <template v-for="group in [
        { id: 'strong', title: `Cite ${at}`, hint: '', list: strong },
        { id: 'weak', title: 'Possibly related', hint: 'These cite the whole chapter, or a verse the scanner resolved from context.', list: weak },
      ]" :key="group.id">
        <section v-if="group.list.length" :class="group.id === 'weak' && strong.length ? 'mt-5' : ''">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-faint">{{ group.title }}</h3>
          <p v-if="group.hint" class="mt-0.5 text-xs text-faint">{{ group.hint }}</p>
          <ul class="mt-2 space-y-3">
            <li v-for="p in group.list" :key="p.chunk_id" class="rounded-lg border border-line bg-surface-2 p-3">
              <p class="font-medium">{{ p.title }}<span v-if="p.author" class="font-normal text-muted"> · {{ p.author }}</span></p>
              <p v-if="where(p)" class="text-xs text-faint">{{ where(p) }}</p>
              <p class="mt-1.5 whitespace-pre-line text-muted" :class="open.has(p.chunk_id) ? '' : 'line-clamp-4'">{{ p.text }}</p>
              <button
                v-if="p.text.length > 280"
                type="button"
                class="mt-1 text-xs text-accent hover:underline"
                :aria-expanded="open.has(p.chunk_id)"
                @click="toggle(p.chunk_id)"
              >{{ open.has(p.chunk_id) ? 'Show less' : 'Show the whole passage' }}</button>
            </li>
          </ul>
        </section>
      </template>
      <p v-if="passages.length >= CITING_LIMIT" class="mt-3 text-xs text-faint">Showing the first {{ CITING_LIMIT }} passages.</p>
    </template>
  </div>
</template>
