<script setup lang="ts">
// Renders one verse from its token list: [text, strongs|null, flags, noteSeq?]
// flags: 1 = words of Jesus, 2 = footnote marker, 4 = words the translators supplied (italic). No v-html anywhere: text is always bound as text.
//
// Strong's numbers on the English words are deliberately NOT clickable. In the WEB source they are not reliably
// aligned to the right word in the Old Testament (e.g. "God" is tagged H3068 far more often than H430), so
// word study goes through the verse's Hebrew/Greek words, which come from OSHB and MorphGNT. See DATA_SOURCES.md.
type Token = [string, string | null, number, number?]

const props = defineProps<{ tokens: Token[]; redLetters?: boolean }>()
const emit = defineEmits<{ note: [seq: number] }>()

const lines = computed(() => {
  // Split on "\n" so poetry lines can be laid out as blocks.
  const out: Token[][] = [[]]
  const last = () => out[out.length - 1]!
  for (const t of props.tokens) {
    if (t[2] & 2) { last().push(t); continue }
    t[0].split('\n').forEach((p, i) => {
      if (i > 0) out.push([])
      if (p) last().push([p, null, t[2]])
    })
  }
  return out
})
</script>

<template>
  <span v-for="(line, li) in lines" :key="li" :class="li > 0 ? 'block pl-6' : 'inline'">
    <template v-for="(t, i) in line" :key="i">
      <sup
        v-if="t[2] & 2"
        class="mx-0.5 cursor-pointer select-none text-[0.65em] text-brand hover:underline"
        role="button"
        tabindex="0"
        aria-label="Show note"
        @click.stop="emit('note', t[3]!)"
        @keydown.enter.stop="emit('note', t[3]!)"
        @keydown.space.prevent.stop="emit('note', t[3]!)"
      >&#9642;</sup>
      <span v-else :class="[redLetters !== false && t[2] & 1 ? 'text-jesus' : '', t[2] & 4 ? 'italic' : '']">{{ t[0] }}</span>
    </template>
  </span>
</template>
