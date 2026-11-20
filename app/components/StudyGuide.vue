<script setup lang="ts">
import { GraduationCap, ExternalLink } from 'lucide-vue-next'
import { parseReference } from '~~/shared/reference'
import type { Word } from '~/utils/types'

interface Heading { before_verse: number; kind: string; text: string }
interface Note { verse: number; seq: number; kind: string; text: string }

const props = defineProps<{
  bookId: number
  verse: number | null
  bookName: string
  chapter: number
  verseCount: number
  headings: Heading[]
  notes: Note[]
  footnote: { kind: string; text: string } | null
  word: Word | null
}>()
const tab = defineModel<'overview' | 'xref' | 'word' | 'library'>('tab', { default: 'overview' })
const emit = defineEmits<{ goto: [verse: number] }>()

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'xref', label: 'Cross-refs' },
  { id: 'word', label: 'Word Study' },
  { id: 'library', label: 'Books' },
] as const

const sections = computed(() => props.headings.filter((h) => h.kind === 'ms'))
const xrefs = computed(() =>
  props.notes.filter((n) => n.kind === 'xref').map((n) => {
    const ref_ = parseReference(n.text)
    return {
      verse: n.verse,
      text: n.text,
      to: ref_ ? { path: `/read/${ref_.book.osis}/${ref_.chapter ?? 1}`, query: ref_.verse ? { v: ref_.verse } : {} } : null,
    }
  }),
)
const footnotes = computed(() => props.notes.filter((n) => n.kind !== 'xref').length)
</script>

<template>
  <Panel title="Study Guide" :icon="GraduationCap" collapsible>
    <div class="-mt-1 mb-3 flex gap-4 overflow-x-auto border-b border-line text-sm" role="tablist">
      <button
        v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id"
        class="-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2"
        :class="tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
        @click="tab = t.id"
      >{{ t.label }}</button>
    </div>

    <div v-if="tab === 'overview'" class="space-y-4 text-sm">
      <section v-if="footnote" class="rounded-lg border border-line bg-surface-2 p-3">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-brand">{{ footnote.kind === 'xref' ? 'Cross-reference' : 'Footnote' }}</h3>
        <p class="mt-1">{{ footnote.text }}</p>
      </section>
      <p class="text-muted">
        {{ bookName }} {{ chapter }} has {{ verseCount }} verses, {{ xrefs.length }} cross-reference{{ xrefs.length === 1 ? '' : 's' }}
        and {{ footnotes }} translation note{{ footnotes === 1 ? '' : 's' }}.
      </p>
      <section v-if="sections.length">
        <h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">Sections</h3>
        <ul class="space-y-1">
          <li v-for="(h, i) in sections" :key="i">
            <button type="button" class="text-left text-accent hover:underline" @click="emit('goto', h.before_verse)">
              <span class="text-faint">{{ h.before_verse }}</span> {{ h.text }}
            </button>
          </li>
        </ul>
      </section>
      <p v-else class="text-faint">This translation has no section headings for this chapter.</p>
    </div>

    <div v-else-if="tab === 'xref'" class="text-sm">
      <CrossRefs :book-id="bookId" :chapter="chapter" :verse="verse" />
      <h3 v-if="xrefs.length" class="mb-1 mt-5 text-xs font-semibold uppercase tracking-wider text-faint">In this translation</h3>
      <ul v-if="xrefs.length" class="space-y-1.5">
        <li v-for="(x, i) in xrefs" :key="i" class="flex items-baseline gap-2">
          <button type="button" class="w-6 shrink-0 text-right text-xs text-faint hover:text-fg" :aria-label="`Go to verse ${x.verse}`" @click="emit('goto', x.verse)">{{ x.verse }}</button>
          <NuxtLink v-if="x.to" :to="x.to" class="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">{{ x.text }}<ExternalLink class="size-3" aria-hidden="true" /></NuxtLink>
          <span v-else class="text-muted">{{ x.text }}</span>
        </li>
      </ul>
    </div>

    <CitingPassages v-else-if="tab === 'library'" :book-id="bookId" :chapter="chapter" :verse="verse" :book-name="bookName" />

    <WordStudy v-else :word="word" />
  </Panel>
</template>
