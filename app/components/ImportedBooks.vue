<script setup lang="ts">
import { FileUp, Trash2 } from 'lucide-vue-next'

const { documents, loaded, importing, error, notice, load, importFile, remove } = useDocuments()
const confirming = ref<number | null>(null)
const picker = ref<HTMLInputElement | null>(null)

// The buttons that change on a click disappear with it, and focus would fall back to the page. Put it somewhere sensible:
// asking moves it to "Keep" (the safe answer), keeping returns it to the trash button, removing returns it to the
// import button, which sits just above the message that says what happened.
async function ask(id: number) {
  confirming.value = id
  await nextTick()
  document.getElementById(`keep-${id}`)?.focus()
}
async function keep(id: number) {
  confirming.value = null
  await nextTick()
  document.getElementById(`remove-${id}`)?.focus()
}
async function confirmRemove(id: number) {
  confirming.value = null
  await remove(id)
  picker.value?.focus()
}

onMounted(load)

async function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = '' // so choosing the same file again fires another change event
  for (const file of files) await importFile(file)
}

const STATUS: Record<string, string> = { pending: 'Waiting', processing: 'Importing', failed: 'Failed' }
const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
</script>

<template>
  <section class="mt-10" aria-labelledby="your-books">
    <h2 id="your-books" class="font-reading text-2xl font-semibold">Your books</h2>
    <p class="mt-2 text-muted">
      Import your own notes and books as plain text or Markdown. Pellikan finds the Scripture references in them, so
      they can show up beside the verses they cite. Files stay on this computer.
    </p>

    <div class="mt-4">
      <input ref="picker" id="import-books" type="file" class="peer sr-only" multiple accept=".txt,.text,.md,.markdown,text/plain,text/markdown" :disabled="!!importing" @change="picked">
      <label
        for="import-books"
        class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        <FileUp class="size-4" aria-hidden="true" /> Import a book
      </label>
      <span class="ml-3 text-sm text-faint">.txt or .md, up to 25 MB</span>
    </div>

    <div aria-live="polite" class="mt-3 min-h-[1.5rem] text-sm">
      <p v-if="importing" class="text-muted">
        {{ importing.step }}: {{ importing.name }}
        <progress class="ml-2 inline-block h-2 w-32 align-middle" max="1" :value="importing.progress" :aria-label="`Importing ${importing.name}`" />
      </p>
      <p v-else-if="notice" class="text-accent">{{ notice }}</p>
    </div>
    <p v-if="error" role="alert" class="mt-1 rounded-r-lg border-l-[3px] border-brand bg-surface-2 py-2 pl-3 pr-2 text-sm">{{ error }}</p>

    <p v-if="loaded && !documents.length && !importing" class="mt-4 text-sm text-faint">Nothing imported yet.</p>
    <ul v-if="documents.length" class="mt-4 space-y-3">
      <li v-for="d in documents" :key="d.id" class="rounded-lg border border-line bg-bg p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-reading text-lg font-semibold">{{ d.title }}</h3>
            <p class="text-sm text-muted">
              <span v-if="d.author">{{ d.author }} · </span><span class="uppercase">{{ d.format }}</span> · {{ d.original_name }} · {{ date(d.at) }}
            </p>
            <p v-if="d.status === 'ready'" class="mt-1 text-sm text-muted">{{ d.chunks }} passages · {{ d.refs }} Scripture references</p>
            <p v-else class="mt-1 text-sm"><span class="font-medium text-brand">{{ STATUS[d.status] ?? d.status }}.</span> {{ d.error }}</p>
          </div>
          <div class="shrink-0">
            <template v-if="confirming === d.id">
              <span class="mr-2 text-sm">Remove it?</span>
              <button type="button" class="rounded px-2 py-1 text-sm font-medium text-accent hover:underline" :aria-label="`Remove ${d.title}`" @click="confirmRemove(d.id)">Remove</button>
              <button :id="`keep-${d.id}`" type="button" class="rounded px-2 py-1 text-sm text-muted hover:underline" :aria-label="`Keep ${d.title}`" @click="keep(d.id)">Keep</button>
            </template>
            <button v-else :id="`remove-${d.id}`" type="button" class="rounded p-1.5 text-faint hover:text-fg" :aria-label="`Remove ${d.title}`" @click="ask(d.id)"><Trash2 class="size-4" /></button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
