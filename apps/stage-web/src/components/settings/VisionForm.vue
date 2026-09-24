<script setup lang="ts">
import { DEFAULT_OPENAI_BASE_URL, DEFAULT_VISION_MODEL, type VisionConfig } from '@aisling/core'
import { storeToRefs } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import { readImageFile, validateImageFile } from '../../image/file'
import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { visionMessage, visionState } = storeToRefs(settings)
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<VisionConfig>({ ...settings.config.vision })
watch(() => settings.config.vision, (next) => {
  Object.assign(draft, next)
})

const isOpenAI = computed(() => draft.providerType === 'openai-compatible')
const observation = ref('')
const fileInput = ref<HTMLInputElement>()

async function test(): Promise<void> {
  const file = fileInput.value?.files?.[0]
  if (!file) {
    observation.value = 'Choose a test image first.'
    return
  }
  const invalid = validateImageFile(file)
  if (invalid) {
    observation.value = invalid
    return
  }
  const image = await readImageFile(file)
  const result = await settings.testVision({ ...draft }, { data: image.data, mimeType: image.mimeType })
  observation.value = result.observation ?? ''
}

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
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="test" />
      <button
        type="button"
        class="btn"
        :disabled="visionState === 'connecting'"
        @click="fileInput?.click()"
      >
        {{ visionState === 'connecting' ? 'Analyzing…' : 'Test Vision' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="visionMessage" class="status" :class="visionState">{{ visionMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
    <p v-if="observation" class="observation">“{{ observation }}”</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
.observation { margin-top: .5rem; padding: .75rem 1rem .75rem 1.25rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; line-height: 1.6; overflow-wrap: anywhere; animation: rise .3s var(--ease) both }
</style>
