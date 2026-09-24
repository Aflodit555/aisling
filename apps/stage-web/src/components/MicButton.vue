<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useHearingStore } from '../stores/hearing'
import Icon from './Icon.vue'

const hearing = useHearingStore()
const { recording, recognizing, error } = storeToRefs(hearing)

const emit = defineEmits<{
  (event: 'transcribed', text: string): void
}>()

// Keep the Stage label short; the full technical error lives in Devtools.
const shortError = computed(() => {
  const message = error.value
  if (!message)
    return ''
  if (/could not reach|failed to fetch/i.test(message))
    return 'Failed to reach provider'
  return 'Recognition failed'
})

async function toggle(): Promise<void> {
  if (recording.value) {
    const text = await hearing.stopAndTranscribe()
    if (text?.trim())
      emit('transcribed', text.trim())
  }
  else {
    try {
      await hearing.startRecording()
    }
    catch {
      // short message surfaced below
    }
  }
}
</script>

<template>
  <div class="mic-wrap">
    <button
      type="button"
      class="icon-btn mic"
      :class="{ 'is-recording': recording, on: recognizing }"
      :title="error || (recording ? 'Stop and send' : 'Speak to Aisling')"
      :aria-label="recording ? 'Stop and send' : 'Speak to Aisling'"
      @click="toggle"
    >
      <Icon :name="recognizing ? 'dots' : recording ? 'stop' : 'mic'" />
    </button>
    <p v-if="shortError" class="error">{{ shortError }}</p>
  </div>
</template>

<style scoped>
/* The error hangs below the button so the FAB row stays aligned; the image error sits above the row, so the two never meet. */
.mic-wrap { position: relative; flex: none }
.mic.is-recording { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent) }
.error { position: absolute; top: calc(100% + .25rem); left: 0; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; font-size: .75rem; color: var(--danger); white-space: nowrap; pointer-events: none }
</style>
