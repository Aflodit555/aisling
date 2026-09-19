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
    <label class="field">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None</option>
        <option value="openai-compatible">OpenAI-compatible multimodal</option>
      </select>
    </label>

    <template v-if="isOpenAI">
      <label class="field">
        <span class="label">Base URL</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
      </label>

      <label class="field">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_VISION_MODEL" />
      </label>
    </template>

    <div class="test">
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="test" />
      <button
        type="button"
        class="secondary"
        :disabled="visionState === 'connecting'"
        @click="fileInput?.click()"
      >
        {{ visionState === 'connecting' ? 'Analyzing…' : 'Test Vision' }}
      </button>
      <p v-if="observation" class="observation">“{{ observation }}”</p>
    </div>

    <div class="actions">
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="visionMessage" class="status" :class="visionState">{{ visionMessage }}</p>
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

.test {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.observation {
  margin: 0;
  font-size: 14px;
  color: #c9b8f2;
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
