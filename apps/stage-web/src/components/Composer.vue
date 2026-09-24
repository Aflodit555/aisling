<script setup lang="ts">
import { ref } from 'vue'

import Icon from './Icon.vue'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'send', text: string): void
}>()

const draft = ref('')

function submit(): void {
  const text = draft.value.trim()
  if (!text || props.disabled)
    return

  emit('send', text)
  draft.value = ''
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      v-model="draft"
      rows="1"
      placeholder="Say something to Aisling…"
      :disabled="disabled"
      @keydown.enter.exact.prevent="submit"
    />
    <button type="submit" class="icon-btn send" aria-label="Send" :disabled="disabled || !draft.trim()">
      <Icon name="send" />
    </button>
  </form>
</template>

<style scoped>
.composer { display: flex; flex: 1; align-items: flex-end; gap: .5rem; min-width: 0 }
/* Pill field: one line matches the 2.5rem round buttons; it grows with the draft up to five lines, then scrolls.
   The inset is a transparent border and the hairline is an inset outline, so scrolled text clips inside the pill instead of running into its rule. */
textarea { flex: 1; min-width: 0; field-sizing: content; min-height: 2.5rem; max-height: 7.5rem; resize: none; overflow-y: auto; padding: .125rem .5rem; border: .5rem solid transparent; border-radius: 1.25rem; outline: 1px solid var(--rule); outline-offset: -1px; font: inherit; line-height: 1.25rem; color: inherit; background: var(--field); transition: outline-color .15s }
textarea:hover, textarea:focus { outline-color: var(--muted) }
/* Narrow docks: the placeholder wraps and only its first line shows, so it clips at a word, never mid-glyph. */
textarea::placeholder { color: var(--muted); max-height: 1.25rem; overflow: hidden }
textarea:disabled { opacity: .6; cursor: not-allowed }
.send { color: var(--fg); background: var(--tonal); border-color: transparent }
.send:not(:disabled):hover { background: var(--tonal-strong) }
</style>
