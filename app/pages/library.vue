<script setup lang="ts">
interface Source { id: string; name: string; kind: string; language: string | null; license: string; attribution: string }
const { data: sources, error } = await useAsyncData('sources', () => query<Source>('sources'))
const KIND: Record<string, string> = {
  translation: 'Bible translation', 'original-text': 'Original-language text', morphology: 'Morphology', lexicon: 'Lexicon',
  dictionary: 'Bible dictionary', commentary: 'Commentary', 'cross-references': 'Cross-references',
}
useHead({ title: 'Library · Pellikan' })
</script>

<template>
  <div class="h-full overflow-y-auto p-2 md:p-4">
    <div class="mx-auto max-w-3xl rounded-xl border border-line bg-surface px-4 py-5 md:px-6 md:py-6">
      <h1 class="font-reading text-3xl font-semibold">Library</h1>
      <p class="mt-2 text-muted">What is installed, and the books you have imported. Dictionaries open in the <NuxtLink to="/dictionary" class="text-accent hover:underline">Dictionary</NuxtLink>; lexicons appear in Word Study, commentary beside the text.</p>
      <p v-if="error" class="mt-6 text-red-500">Could not load the library: {{ error.statusMessage || error.message }}</p>
      <ul v-else class="mt-6 grid gap-3 sm:grid-cols-2">
        <li v-for="s in sources" :key="s.id" class="rounded-lg border border-line bg-bg p-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-accent">{{ KIND[s.kind] ?? s.kind }}</p>
          <h2 class="mt-1 font-reading text-lg font-semibold">{{ s.name }}</h2>
          <p class="mt-1 text-sm text-muted">{{ s.license }}</p>
        </li>
      </ul>
      <TranslationManager />
      <ImportedBooks />
      <NuxtLink to="/credits" class="mt-8 inline-block text-sm text-accent hover:underline">Full credits and licenses</NuxtLink>
    </div>
  </div>
</template>
