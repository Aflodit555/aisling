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
    <label class="field" style="--i: 0">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None (text input only)</option>
        <option value="openai-compatible">OpenAI-compatible transcription</option>
        <option value="alibaba">Alibaba (DashScope ASR)</option>
      </select>
    </label>

    <template v-if="isConfigured">
      <label class="field" :class="{ 'long-label': isAlibaba }" style="--i: 1">
        <span class="label">{{ isAlibaba ? 'Workspace API Base URL' : 'Base URL' }}</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="isAlibaba ? 'https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1' : DEFAULT_OPENAI_BASE_URL" />
        <span v-if="isAlibaba" class="hint">Example: <code>https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1</code></span>
        <span v-if="endpointError" class="error">{{ endpointError }}</span>
      </label>

      <label class="field" style="--i: 2">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field" style="--i: 3">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="isAlibaba ? DEFAULT_ALIBABA_ASR_MODEL : DEFAULT_TRANSCRIPTION_MODEL" />
      </label>
    </template>

    <div class="actions">
      <button type="button" class="btn" :disabled="testState === 'recording' || testState === 'recognizing'" @click="test">
        {{ testState === 'recording' ? 'Recording…' : testState === 'recognizing' ? 'Recognizing…' : 'Test Hearing' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="testState === 'success'" class="status success">Heard: “{{ transcript }}”</p>
    <p v-else-if="testState === 'failed'" class="status failed">{{ error || 'Recognition failed.' }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
.hint, .error, .status { overflow-wrap: anywhere }
.error { font-size: .85rem }
code { font-family: var(--mono) }
/* A wrapped label spans the hint row too, so the hint stays tucked under its input. */
.long-label > .label { grid-row: span 2; align-self: start; padding-top: calc(.4rem + 1px) }
</style>
