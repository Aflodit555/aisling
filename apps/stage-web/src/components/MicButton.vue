<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useHearingStore } from '../stores/hearing'

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
      class="mic"
      :class="{ 'is-recording': recording, 'is-recognizing': recognizing }"
      :title="error || (recording ? 'Stop and send' : 'Speak to Aisling')"
      @click="toggle"
    >
      {{ recognizing ? '…' : recording ? '■' : '🎤' }}
    </button>
    <p v-if="shortError" class="error">{{ shortError }}</p>
  </div>
</template>

<style scoped>
.mic-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.mic {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c1930;
  color: #e6e0f4;
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.mic.is-recording {
  border-color: rgba(244, 113, 113, 0.5);
  color: #f6c2c2;
}

.mic.is-recognizing {
  border-color: rgba(167, 139, 250, 0.5);
  color: #c9b8f2;
}

.error {
  margin: 0;
  max-width: 96px;
  font-size: 10px;
  color: #f6c2c2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
