<script setup lang="ts">
import { DEFAULT_ALIBABA_ASR_MODEL, DEFAULT_OPENAI_BASE_URL, DEFAULT_TRANSCRIPTION_MODEL, validateAlibabaWorkspaceBaseUrl, type HearingConfig } from '@aisling/core'
import { storeToRefs } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useHearingStore } from '../../stores/hearing'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const hearing = useHearingStore()
const { error, transcript } = storeToRefs(hearing)
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<HearingConfig>({ ...settings.config.hearing })
watch(() => settings.config.hearing, (next) => {
  Object.assign(draft, next)
})

const isConfigured = computed(() => draft.providerType !== 'none')
const isAlibaba = computed(() => draft.providerType === 'alibaba')
const endpointError = computed(() => (isAlibaba.value ? validateAlibabaWorkspaceBaseUrl(draft.baseUrl) : undefined))
const testState = ref<'idle' | 'recording' | 'recognizing' | 'success' | 'failed'>('idle')

watch(() => draft.providerType, (next) => {
  if (next === 'alibaba' && (!draft.model || draft.model === DEFAULT_TRANSCRIPTION_MODEL))
    draft.model = DEFAULT_ALIBABA_ASR_MODEL
  if (next === 'openai-compatible' && draft.model === DEFAULT_ALIBABA_ASR_MODEL)
    draft.model = DEFAULT_TRANSCRIPTION_MODEL
})

async function test(): Promise<void> {
  if (endpointError.value)
    return
  testState.value = 'recording'
  try {
    await hearing.startRecording()
  }
  catch {
    testState.value = 'failed'
    return
  }

  setTimeout(async () => {
    testState.value = 'recognizing'
    const text = await hearing.stopAndTranscribe({ ...draft })
    testState.value = text ? 'success' : 'failed'
  }, 3000)
}

async function save(): Promise<void> {
  if (endpointError.value)
    return
  await settings.saveHearing({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None (text input only)</option>
        <option value="openai-compatible">OpenAI-compatible transcription</option>
        <option value="alibaba">Alibaba (DashScope ASR)</option>
      </select>
    </label>

    <template v-if="isConfigured">
      <label class="field">
        <span class="label">{{ isAlibaba ? 'Workspace API Base URL' : 'Base URL' }}</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="isAlibaba ? 'https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1' : DEFAULT_OPENAI_BASE_URL" />
        <span v-if="isAlibaba" class="hint">Example: https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1</span>
        <span v-if="endpointError" class="error">{{ endpointError }}</span>
      </label>

      <label class="field">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="isAlibaba ? DEFAULT_ALIBABA_ASR_MODEL : DEFAULT_TRANSCRIPTION_MODEL" />
      </label>
    </template>

    <div class="actions">
      <button type="button" class="secondary" :disabled="testState === 'recording' || testState === 'recognizing'" @click="test">
        {{ testState === 'recording' ? 'Recording…' : testState === 'recognizing' ? 'Recognizing…' : 'Test Hearing' }}
      </button>
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="testState === 'success'" class="status success">Heard: “{{ transcript }}”</p>
    <p v-else-if="testState === 'failed'" class="status failed">{{ error || 'Recognition failed.' }}</p>
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

.error {
  font-size: 12px;
  color: #f6c2c2;
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

.status.success {
  color: #a7e6b4;
}

.status.failed {
  color: #f6c2c2;
}

.status.saved {
  color: #a7e6b4;
}
</style>
