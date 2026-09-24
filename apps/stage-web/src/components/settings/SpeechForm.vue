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
    <label class="field" style="--i: 0">
      <span class="label">Provider</span>
      <select v-model="draft.providerType">
        <option value="none">None (text only)</option>
        <option value="browser">Browser / System Voice</option>
        <option value="alibaba">Alibaba (DashScope TTS)</option>
      </select>
    </label>

    <template v-if="isBrowser">
      <label class="field" style="--i: 1">
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
      <label class="field" style="--i: 1">
        <span class="label">Transport</span>
        <select v-model="draft.transport" @change="switchTransport">
          <option value="websocket">Realtime WebSocket</option>
          <option value="http">HTTP</option>
        </select>
      </label>

      <label class="field long-label" style="--i: 2">
        <span class="label">{{ endpointLabel }}</span>
        <input v-model="draft.endpoint" type="text" :placeholder="endpointPlaceholder" />
        <span v-if="draft.transport === 'websocket'" class="hint">Example: <code>wss://‹workspace›.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference</code></span>
        <span v-else class="hint">Example: <code>https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1</code></span>
        <span v-if="endpointError" class="error">{{ endpointError }}</span>
      </label>

      <label class="field" style="--i: 3">
        <span class="label">API Key</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">Kept in this browser only. Never committed to git.</span>
      </label>

      <label class="field" style="--i: 4">
        <span class="label">Model</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_ALIBABA_TTS_MODEL" />
      </label>

      <label class="field" style="--i: 5">
        <span class="label">Voice</span>
        <input v-model="draft.voice" type="text" :placeholder="DEFAULT_ALIBABA_TTS_VOICE" />
      </label>
    </template>

    <div class="actions">
      <button
        type="button"
        class="btn"
        :disabled="voiceState === 'connecting'"
        @click="test"
      >
        {{ voiceState === 'connecting' ? 'Synthesizing…' : 'Test Voice' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="voiceMessage" class="status" :class="voiceState">{{ voiceMessage }}</p>
    <p v-if="saved" class="status saved-state">Saved.</p>
  </form>
</template>

<style scoped>
.hint, .error, .status { overflow-wrap: anywhere }
.error { font-size: .85rem }
code { font-family: var(--mono) }
/* A wrapped label spans the hint row too, so the hint stays tucked under its input. */
.long-label > .label { grid-row: span 2; align-self: start; padding-top: calc(.4rem + 1px) }
</style>
