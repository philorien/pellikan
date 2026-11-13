<script setup lang="ts">
import { NotebookPen, Trash2 } from 'lucide-vue-next'

const props = defineProps<{ osis: string; bookName: string; chapter: number; verse: number | null }>()

const { notes, highlights, addNote, removeNote, setHighlight } = useUserData()
const draft = ref('')

const chapterNotes = computed(() => notes.value.filter((n) => n.osis === props.osis && n.chapter === props.chapter).sort((a, b) => a.verse - b.verse || b.at - a.at))
const currentColor = computed(() => (props.verse ? highlights.value[verseKey(props.osis, props.chapter, props.verse)] : undefined))

const saving = ref(false)

async function submit() {
  if (!props.verse || !draft.value.trim() || saving.value) return
  saving.value = true
  const saved = await addNote(props.osis, props.chapter, props.verse, draft.value)
  saving.value = false
  if (saved) draft.value = '' // a note that failed to save stays in the box
}
</script>

<template>
  <Panel title="Notes" :icon="NotebookPen" collapsible>
    <div v-if="verse" class="mb-3">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ bookName }} {{ chapter }}:{{ verse }}</span>
        <div class="flex items-center gap-1.5" role="group" aria-label="Highlight colour">
          <button
            v-for="c in HIGHLIGHT_COLORS" :key="c" type="button"
            class="size-6 rounded-full border-2"
            :style="{ background: `var(--hl-${c})` }"
            :class="currentColor === c ? 'border-fg' : 'border-line'"
            :aria-label="`Highlight ${c}`" :aria-pressed="currentColor === c"
            @click="setHighlight(osis, chapter, verse!, currentColor === c ? null : c)"
          />
        </div>
      </div>
      <form class="mt-2" @submit.prevent="submit">
        <textarea
          v-model="draft" rows="2" placeholder="Write a note on this verse…" aria-label="Note text"
          class="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-base outline-none placeholder:text-faint md:text-sm focus:border-accent"
          @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit"
        />
        <button type="submit" :disabled="!draft.trim() || saving" class="mt-1.5 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg disabled:opacity-40">Add note</button>
      </form>
    </div>
    <p v-else class="mb-3 text-sm text-muted">Select a verse to highlight it or add a note.</p>

    <ul class="space-y-2">
      <li v-for="n in chapterNotes" :key="n.id" class="group rounded-r-lg border-l-[3px] border-brand bg-surface-2 py-2 pl-3 pr-2 text-sm">
        <div class="flex items-center justify-between">
          <span class="font-medium text-brand">{{ bookName }} {{ n.chapter }}:{{ n.verse }}</span>
          <button type="button" class="rounded p-1 text-faint hover:text-fg" :aria-label="`Delete note on verse ${n.verse}`" @click="removeNote(n.id)"><Trash2 class="size-3.5" /></button>
        </div>
        <p class="mt-0.5 whitespace-pre-wrap">{{ n.body }}</p>
      </li>
    </ul>
    <p v-if="!chapterNotes.length" class="text-sm text-faint">No notes on this chapter yet.</p>
  </Panel>
</template>
