<script setup lang="ts">
import {
  DEFAULT_ALIBABA_TTS_BASE_URL,
  DEFAULT_ALIBABA_TTS_MODEL,
  DEFAULT_ALIBABA_TTS_VOICE,
  DEFAULT_ALIBABA_TTS_WEBSOCKET_URL,
  validateAlibabaTtsEndpoint,
  type SpeechConfig,
} from '@aisling/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import { playSpeechResult } from '../../audio/playback'
import { useSaveFlash } from '../../composables/use-save-flash'
import { listBrowserVoices, pickPreferredVoice } from '../../providers/browser-speech-provider'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { voiceMessage, voiceState } = storeToRefs(settings)
const { saved, flashSaved } = useSaveFlash()

const draft = reactive<SpeechConfig>({ ...settings.config.speech })
watch(() => settings.config.speech, (next) => {
  Object.assign(draft, next)
})

const isBrowser = computed(() => draft.providerType === 'browser')
const isAlibaba = computed(() => draft.providerType === 'alibaba')
const endpointError = computed(() => (isAlibaba.value ? validateAlibabaTtsEndpoint(draft.endpoint, draft.transport) : undefined))
const endpointLabel = computed(() => draft.transport === 'websocket' ? 'Realtime WebSocket Endpoint' : 'HTTP API Base URL')
const endpointPlaceholder = computed(() => draft.transport === 'websocket' ? DEFAULT_ALIBABA_TTS_WEBSOCKET_URL : DEFAULT_ALIBABA_TTS_BASE_URL)

const voices = ref<SpeechSynthesisVoice[]>(listBrowserVoices())

function refreshVoices(): void {
  voices.value = listBrowserVoices()
  if (isBrowser.value && !draft.voice)
    draft.voice = pickPreferredVoice(voices.value)?.name ?? ''
}

onMounted(() => {
  refreshVoices()
  window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices)
})
onUnmounted(() => {
  window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices)
})

async function test(): Promise<void> {
  if (endpointError.value)
    return
  const result = await settings.testVoice({ ...draft })
  if (result.ok && result.audio) {
    try {
      await playSpeechResult(result.audio)
      settings.completeVoicePlayback()
    }
    catch (error) {
      settings.failVoicePlayback(error)
    }
  }
}

function switchTransport(): void {
  if (draft.transport === 'websocket' && !draft.endpoint.trim().startsWith('wss://'))
    draft.endpoint = DEFAULT_ALIBABA_TTS_WEBSOCKET_URL
  else if (draft.transport === 'http' && !draft.endpoint.trim().startsWith('http'))
    draft.endpoint = DEFAULT_ALIBABA_TTS_BASE_URL
}

async function save(): Promise<void> {
  if (endpointError.value)
    return
  await settings.saveSpeech({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None (text only)</option>
        <option value="browser">Browser / System Voice</option>
        <option value="alibaba">Alibaba (DashScope TTS)</option>
      </select>
    </label>

    <template v-if="isBrowser">
      <label class="field">
        <span class="label">Voice</span>
        <select v-model="draft.voice">
          <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.name">
            {{ voice.name }} ({{ voice.lang }})
          </option>
        </select>
        <span class="hint">Uses this browser's built-in speech synthesis.</span>
      </label>
    </template>

    <template v-if="isAlibaba">
      <label class="field">
        <span class="label">Transport</span>
        <select v-model="draft.transport" @change="switchTransport">
          <option value="websocket">Realtime WebSocket</option>
          <option value="http">HTTP</option>
        </select>
      </label>

      <label class="field">
        <span class="label">{{ endpointLabel }}</span>
        <input v-model="draft.endpoint" type="text" :placeholder="endpointPlaceholder" />
        <span v-if="draft.transport === 'websocket'" class="hint">Example: wss://‹workspace›.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference</span>
        <span v-else class="hint">Example: https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1</span>
        <span v-if="endpointError" class="error">{{ endpointError }}</span>
      </label>

      <label class="field">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_ALIBABA_TTS_MODEL" />
      </label>

      <label class="field">
        <span class="label">Voice</span>
        <input v-model="draft.voice" type="text" :placeholder="DEFAULT_ALIBABA_TTS_VOICE" />
      </label>
    </template>

    <div class="actions">
      <button
        type="button"
        class="secondary"
        :disabled="voiceState === 'connecting'"
        @click="test"
      >
        {{ voiceState === 'connecting' ? 'Synthesizing…' : 'Test Voice' }}
      </button>
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="voiceMessage" class="status" :class="voiceState">{{ voiceMessage }}</p>
    <p v-if="saved" class="status saved-state">Saved.</p>
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

.status.connected {
  color: #a7e6b4;
}

.status.failed {
  color: #f6c2c2;
}

.status.connecting {
  color: #f0cf8a;
}

.status.saved-state {
  color: #a7e6b4;
}
</style>
