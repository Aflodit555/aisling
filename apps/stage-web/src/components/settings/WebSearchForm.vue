<script setup lang="ts">
import type { WebSearchConfig } from '@aisling/core'
import { reactive, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<WebSearchConfig>({ ...settings.config.webSearch })
watch(() => settings.config.webSearch, (next) => {
  Object.assign(draft, next)
})

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
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="saved" class="status saved">Saved.</p>

  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
</style>
