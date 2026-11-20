<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { BOOK_BY_OSIS } from '~~/shared/books'
import type { UserBookmark } from '~/composables/useUserData'

const { bookmarks, setBookmark, removeBookmark } = useUserData()
const label = (b: UserBookmark) => `${BOOK_BY_OSIS[b.osis]?.name ?? b.osis} ${b.chapter}:${b.verse}`
const dated = (at: number) => new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

// The label is saved when the field loses focus or Enter is pressed, and only if it changed.
async function saveLabel(b: UserBookmark, event: Event) {
  const input = event.target as HTMLInputElement
  if (cleanLabel(input.value) === b.label) return
  const ok = await setBookmark(b.osis, b.chapter, b.verse, input.value)
  if (!ok) input.value = b.label ?? '' // the save failed (app.vue says so): do not show a label that was not kept
}

useHead({ title: 'Bookmarks · Pellikan' })
</script>

<template>
  <div class="h-full overflow-y-auto p-2 md:p-4">
    <div class="mx-auto max-w-3xl rounded-xl border border-line bg-surface px-4 py-5 md:px-6 md:py-6">
      <h1 class="font-reading text-3xl font-semibold">Bookmarks</h1>
      <p v-if="!bookmarks.length" class="mt-4 text-muted">No bookmarks yet. Press the bookmark button above the text while reading to keep your place. It marks the selected verse, or the start of the chapter.</p>
      <ul v-else class="mt-4 space-y-2">
        <li v-for="b in bookmarks" :key="b.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 hover:bg-surface-2">
          <NuxtLink :to="{ path: `/read/${b.osis}/${b.chapter}`, query: { v: b.verse } }" class="font-medium text-accent hover:underline">{{ label(b) }}</NuxtLink>
          <input
            :value="b.label ?? ''"
            type="text"
            :maxlength="BOOKMARK_LABEL_MAX"
            placeholder="Add a label"
            :aria-label="`Label for the bookmark on ${label(b)}`"
            class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none placeholder:text-faint hover:border-line focus:border-accent"
            @change="saveLabel(b, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span class="text-xs text-faint">{{ dated(b.at) }}</span>
          <button type="button" class="rounded p-1 text-faint hover:text-fg" :aria-label="`Remove the bookmark on ${label(b)}`" @click="removeBookmark(b.id)"><Trash2 class="size-4" /></button>
        </li>
      </ul>
    </div>
  </div>
</template>
