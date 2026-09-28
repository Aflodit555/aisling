<script setup lang="ts">
import { DEFAULT_OPENAI_BASE_URL, DEFAULT_VISION_MODEL, type VisionConfig } from '@aisling/core'
import { computed, reactive, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<VisionConfig>({ ...settings.config.vision })
watch(() => settings.config.vision, (next) => {
  Object.assign(draft, next)
})

const isOpenAI = computed(() => draft.providerType === 'openai-compatible')
async function save(): Promise<void> {
  await settings.saveVision({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field" style="--i: 0">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None</option>
        <option value="openai-compatible">OpenAI-compatible multimodal</option>
      </select>
    </label>

    <template v-if="isOpenAI">
      <label class="field" style="--i: 1">
        <span class="label">Base URL</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
      </label>

      <label class="field" style="--i: 2">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field" style="--i: 3">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_VISION_MODEL" />
      </label>
    </template>

    <div class="actions">
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
</style>
