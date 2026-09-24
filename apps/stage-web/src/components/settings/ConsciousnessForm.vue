<script setup lang="ts">
import { DEFAULT_OPENAI_BASE_URL, type ConsciousnessConfig } from '@aisling/core'
import { storeToRefs } from 'pinia'
import { computed, reactive, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { connectionMessage, connectionState } = storeToRefs(settings)
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<ConsciousnessConfig>({ ...settings.config.consciousness })

watch(() => settings.config.consciousness, (next) => {
  Object.assign(draft, next)
})

const isOpenAI = computed(() => draft.providerType === 'openai-compatible')

function test(): void {
  void settings.testConnection({ ...draft })
}

async function save(): Promise<void> {
  draft.temperature = Math.max(0, Math.min(2, Number(draft.temperature)))
  await settings.saveConsciousness({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field" style="--i: 0">
      <span class="label">Provider Type</span>
      <select v-model="draft.providerType">
        <option value="mock">Mock (test)</option>
        <option value="openai-compatible">OpenAI-compatible</option>
      </select>
    </label>

    <template v-if="isOpenAI">
      <label class="field" style="--i: 1">
        <span class="label">Base URL</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
        <span class="hint">Leave as-is for OpenAI; change it for a compatible service.</span>
      </label>

      <label class="field" style="--i: 2">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field" style="--i: 3">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" placeholder="gpt-4o-mini" />
      </label>

      <label class="field" style="--i: 4">
        <span class="label">Temperature: {{ draft.temperature.toFixed(1) }}</span>
        <input v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
        <span class="hint">Higher values are more varied; 1.0 preserves the previous default behavior.</span>
      </label>
    </template>

    <div class="actions">
      <button
        type="button"
        class="btn"
        :disabled="connectionState === 'connecting'"
        @click="test"
      >
        {{ connectionState === 'connecting' ? 'Connecting…' : 'Test Connection' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="connectionMessage" class="status" :class="connectionState">{{ connectionMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
input[type="range"] { width: 100%; margin: 0 }
.status { overflow-wrap: anywhere }
</style>
