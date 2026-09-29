<script setup lang="ts">
import { t } from '../../i18n'
import {
  DEFAULT_ALIBABA_TTS_BASE_URL,
  DEFAULT_ALIBABA_TTS_MODEL,
  DEFAULT_ALIBABA_TTS_VOICE,
  DEFAULT_ALIBABA_TTS_WEBSOCKET_URL,
  validateAlibabaTtsEndpoint,
  type SpeechConfig,
} from '@aisling/core'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import SettingsSelect from './SettingsSelect.vue'
import { listBrowserVoices, pickPreferredVoice } from '../../providers/browser-speech-provider'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { saved, flashSaved } = useSaveFlash()

const manual = (config: SpeechConfig): Omit<SpeechConfig, 'enabled'> => ({ providerType: config.providerType, apiKey: config.apiKey, model: config.model, voice: config.voice, transport: config.transport, endpoint: config.endpoint })
const draft = reactive(manual(settings.config.speech))
watch(() => manual(settings.config.speech), (next) => {
  Object.assign(draft, next)
})
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(manual(settings.config.speech)))

const isBrowser = computed(() => draft.providerType === 'browser')
const isAlibaba = computed(() => draft.providerType === 'alibaba')
const endpointError = computed(() => (isAlibaba.value ? validateAlibabaTtsEndpoint(draft.endpoint, draft.transport) : undefined))
const endpointLabel = computed(() => draft.transport === 'websocket' ? 'Realtime WebSocket Endpoint' : 'HTTP API Base URL')
const endpointPlaceholder = computed(() => draft.transport === 'websocket' ? DEFAULT_ALIBABA_TTS_WEBSOCKET_URL : DEFAULT_ALIBABA_TTS_BASE_URL)

const voices = ref<SpeechSynthesisVoice[]>(listBrowserVoices())

function refreshVoices(): void {
  voices.value = listBrowserVoices()
  if (isBrowser.value && voices.value.length && !voices.value.some(voice => voice.name === draft.voice))
    draft.voice = pickPreferredVoice(voices.value)?.name ?? ''
}

watch(() => draft.providerType, (provider) => {
  if (provider === 'browser') refreshVoices()
  else if (provider === 'alibaba' && (!draft.voice || voices.value.some(voice => voice.name === draft.voice)))
    draft.voice = DEFAULT_ALIBABA_TTS_VOICE
})

onMounted(() => {
  refreshVoices()
  window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices)
})
onUnmounted(() => {
  window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices)
})

function switchTransport(): void {
  if (draft.transport === 'websocket' && !draft.endpoint.trim().startsWith('wss://'))
    draft.endpoint = DEFAULT_ALIBABA_TTS_WEBSOCKET_URL
  else if (draft.transport === 'http' && !draft.endpoint.trim().startsWith('http'))
    draft.endpoint = DEFAULT_ALIBABA_TTS_BASE_URL
}

function selectTransport(value: string): void {
  draft.transport = value as SpeechConfig['transport']
  switchTransport()
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
    <div class="field" style="--i: 0">
      <span class="label">{{ t('Provider') }}</span>
      <SettingsSelect :model-value="draft.providerType" :options="[{ value: 'browser', label: t('Browser / System Voice') }, { value: 'alibaba', label: 'Alibaba (DashScope TTS)' }]" :label="t('Provider')" :placeholder="t('Select provider')" @update:model-value="draft.providerType = $event as SpeechConfig['providerType']" />
    </div>

    <template v-if="isBrowser">
      <div class="field" style="--i: 1">
        <span class="label">{{ t('Voice') }}</span>
        <SettingsSelect v-model="draft.voice" :options="voices.map(voice => ({ value: voice.name, label: `${voice.name} (${voice.lang})` }))" :label="t('Voice')" :placeholder="t('System default')" />
      </div>
    </template>

    <template v-if="isAlibaba">
      <label class="field" style="--i: 1">
        <span class="label">{{ t('Voice') }}</span>
        <input v-model="draft.voice" type="text" :placeholder="DEFAULT_ALIBABA_TTS_VOICE" />
      </label>
    </template>

    <details v-if="isAlibaba" class="advanced-settings">
      <summary>{{ t('Advanced settings') }}<span v-if="endpointError" class="error"> · {{ t('Check the endpoint.') }}</span></summary>
      <div class="advanced-fields">
      <div class="field" style="--i: 2">
        <span class="label">{{ t('Transport') }}</span>
        <SettingsSelect :model-value="draft.transport" :options="[{ value: 'websocket', label: t('Realtime WebSocket') }, { value: 'http', label: 'HTTP' }]" :label="t('Transport')" @update:model-value="selectTransport" />
      </div>

      <label class="field long-label" style="--i: 3">
        <span class="label">{{ t(endpointLabel) }}</span>
        <input v-model="draft.endpoint" type="text" :placeholder="endpointPlaceholder" />
        <span v-if="draft.transport === 'websocket'" class="hint">{{ t('Example') }} <code>wss://‹workspace›.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference</code></span>
        <span v-else class="hint">{{ t('Example') }} <code>https://‹workspace›.cn-beijing.maas.aliyuncs.com/api/v1</code></span>
        <span v-if="endpointError" class="error">{{ t(endpointError) }}</span>
      </label>

      <label class="field" style="--i: 4">
        <span class="label">{{ t('API Key') }}</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">{{ t('Stored locally. Never committed to git.') }}</span>
      </label>

      <label class="field" style="--i: 5">
        <span class="label">{{ t('Model') }}</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_ALIBABA_TTS_MODEL" />
      </label>
      </div>
    </details>

    <div class="actions">
      <button type="submit" class="btn primary" :disabled="!dirty || Boolean(endpointError)">{{ t('Save') }}</button>
    </div>

    <p v-if="saved" class="status saved-state">{{ t('Saved.') }}</p>
  </form>
</template>

<style scoped>
.hint, .error, .status { overflow-wrap: anywhere }
.error { font-size: .85rem }
code { font-family: var(--mono) }
/* A wrapped label spans the hint row too, so the hint stays tucked under its input. */
.long-label > .label { grid-row: span 2; align-self: start; padding-top: calc(.4rem + 1px) }
</style>
