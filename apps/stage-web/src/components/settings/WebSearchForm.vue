<script setup lang="ts">
import type { WebSearchConfig } from '@aisling/core'
import { storeToRefs } from 'pinia'
import { reactive, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { searchMessage, searchResults, searchState } = storeToRefs(settings)
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<WebSearchConfig>({ ...settings.config.webSearch })
watch(() => settings.config.webSearch, (next) => {
  Object.assign(draft, next)
})

function test(): void {
  void settings.testSearch({ ...draft })
}

async function save(): Promise<void> {
  await settings.saveWebSearch({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None</option>
        <option value="tavily">Tavily</option>
      </select>
    </label>

    <label class="field">
      <span class="label">API Key</span>
      <input v-model="draft.apiKey" type="password" placeholder="tvly-…" autocomplete="off" />
      <span class="hint">Kept in this browser only. Never committed to git.</span>
    </label>

    <div class="actions">
      <button type="button" class="secondary" :disabled="searchState === 'connecting'" @click="test">
        {{ searchState === 'connecting' ? 'Searching…' : 'Test Search' }}
      </button>
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="searchMessage" class="status" :class="searchState">{{ searchMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>

    <ul v-if="searchResults.length > 0" class="results">
      <li v-for="(result, index) in searchResults" :key="index">
        <a :href="result.url" target="_blank" rel="noreferrer">{{ result.title }}</a>
        <span class="snippet">{{ result.snippet }}</span>
      </li>
    </ul>
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

.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.results a {
  color: #c9b8f2;
  font-size: 14px;
  text-decoration: none;
}

.results .snippet {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #9d94b8;
}
</style>
