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
  await settings.saveConsciousness({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field">
      <span class="label">Provider Type</span>
      <select v-model="draft.providerType">
        <option value="mock">Mock (test)</option>
        <option value="openai-compatible">OpenAI-compatible</option>
      </select>
    </label>

    <template v-if="isOpenAI">
      <label class="field">
        <span class="label">Base URL</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
        <span class="hint">Leave as-is for OpenAI; change it for a compatible service.</span>
      </label>

      <label class="field">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" placeholder="gpt-4o-mini" />
      </label>
    </template>

    <div class="actions">
      <button
        type="button"
        class="secondary"
        :disabled="connectionState === 'connecting'"
        @click="test"
      >
        {{ connectionState === 'connecting' ? 'Connecting…' : 'Test Connection' }}
      </button>
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="connectionMessage" class="status" :class="connectionState">{{ connectionMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 440px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  color: #9d94b8;
}

input,
select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #161329;
  color: #e6e0f4;
  font: inherit;
  font-size: 14px;
}

input:focus,
select:focus {
  outline: none;
  border-color: rgba(167, 139, 250, 0.6);
}

.hint {
  font-size: 12px;
  color: #6f6889;
}

.actions {
  display: flex;
  gap: 10px;
}

button {
  padding: 9px 18px;
  border: none;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary {
  background: #6d5ac4;
  color: #fff;
}

.secondary {
  background: rgba(255, 255, 255, 0.06);
  color: #e6e0f4;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.status {
  margin: 0;
  font-size: 13px;
}

.status.connected {
  color: #a7e6b4;
}

.status.failed {
  color: #f6c2c2;
}

.status.connecting {
  color: #f0cf8a;
}

.status.saved {
  color: #a7e6b4;
}
</style>
