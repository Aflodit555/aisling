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
    <label class="field" style="--i: 0">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None</option>
        <option value="duckduckgo">DuckDuckGo Lite</option>
      </select>
    </label>

    <p class="hint">The chat model decides when to search. DuckDuckGo Lite needs no search API key.</p>

    <div class="actions">
      <button type="button" class="btn" :disabled="searchState === 'connecting' || draft.providerType === 'none'" @click="test">
        {{ searchState === 'connecting' ? 'Searching…' : 'Test Search' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="searchMessage" class="status" :class="searchState">{{ searchMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>

    <ul v-if="searchResults.length > 0" class="results">
      <li v-for="(result, index) in searchResults" :key="index" :style="{ '--i': index }">
        <strong>{{ result.title }}</strong>
        <span class="snippet">{{ result.snippet }}</span>
      </li>
    </ul>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
.results { list-style: none; padding: 0; margin-top: .5rem; display: flex; flex-direction: column; gap: 4px }
.results li { display: flex; flex-direction: column; gap: .15rem; padding: .6rem 1rem .6rem 1.25rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; overflow-wrap: anywhere; animation: rise .3s var(--ease) both; animation-delay: calc(var(--i, 0) * 25ms) }
.results strong { font-weight: 500 }
.snippet { color: var(--muted); font-size: .85rem }
</style>
