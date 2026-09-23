import {
  createDefaultPlatformConfig,
  describeCapabilityModules,
  testOpenAICompatibleConnection,
  type ChatProvider,
  type ConsciousnessConfig,
  type DesktopAwarenessConfig,
  type HearingConfig,
  type HearingProvider,
  type ImageInput,
  type PlatformConfig,
  type RecognitionAudio,
  type SearchResult,
  type SpeechAudio,
  type SpeechConfig,
  type SpeechProvider,
  type Tool,
  type VisionConfig,
  type VisionProvider,
  type WebSearchConfig,
} from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { createLocalStorageConfigStore } from '../config/local-storage-config-store'
import { resolvePersistentStorage } from '../storage/desktop-storage'
import {
  buildChatProvider,
  buildHearingProvider,
  buildSpeechProvider,
  buildVisionProvider,
  buildWebSearchProvider,
  buildWebSearchTool,
} from '../runtime/provider-factory'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed'

export interface TestVoiceResult {
  ok: boolean
  message: string
  audio?: SpeechAudio
}

export interface TestVisionResult {
  ok: boolean
  message: string
  observation?: string
}

export interface TestSearchResult {
  ok: boolean
  message: string
  results?: SearchResult[]
}

export const useSettingsStore = defineStore('settings', () => {
  const configStore = createLocalStorageConfigStore(resolvePersistentStorage())

  const config = ref<PlatformConfig>(createDefaultPlatformConfig())
  const loaded = ref(false)

  const activeChatProvider = shallowRef<ChatProvider | undefined>(undefined)
  const activeSpeechProvider = shallowRef<SpeechProvider | undefined>(undefined)
  const activeHearingProvider = shallowRef<HearingProvider | undefined>(undefined)
  const activeVisionProvider = shallowRef<VisionProvider | undefined>(undefined)
  const activeWebSearchTool = shallowRef<Tool | undefined>(undefined)

  const activeTools = computed(() => (activeWebSearchTool.value ? [activeWebSearchTool.value] : []))

  const connectionState = ref<ConnectionState>('idle')
  const connectionMessage = ref('')
  const voiceState = ref<ConnectionState>('idle')
  const voiceMessage = ref('')
  const visionState = ref<ConnectionState>('idle')
  const visionMessage = ref('')
  const searchState = ref<ConnectionState>('idle')
  const searchMessage = ref('')
  const searchResults = ref<SearchResult[]>([])
  const lastTranscript = ref('')

  const modules = computed(() => describeCapabilityModules(config.value))

  function applyConfig(next: PlatformConfig): void {
    config.value = next
    activeChatProvider.value = buildChatProvider(next.consciousness)
    activeSpeechProvider.value = buildSpeechProvider(next.speech)
    activeHearingProvider.value = buildHearingProvider(next.hearing)
    activeVisionProvider.value = buildVisionProvider(next.vision)
    activeWebSearchTool.value = buildWebSearchTool(next.webSearch)
  }

  async function load(): Promise<void> {
    applyConfig(await configStore.get())
    loaded.value = true
  }

  async function persist(): Promise<void> {
    await configStore.set(config.value)
  }

  async function saveConsciousness(next: ConsciousnessConfig): Promise<void> {
    config.value = { ...config.value, consciousness: next }
    await persist()
    applyConfig(config.value)
  }

  async function saveDesktopAwareness(next: DesktopAwarenessConfig): Promise<void> {
    const current = config.value.desktopAwareness
    config.value = { ...config.value, desktopAwareness: {
      enabled: Boolean(next.enabled),
      cooldownSeconds: Number.isFinite(next.cooldownSeconds)
        ? Math.max(10, Math.min(300, Math.round(next.cooldownSeconds / 5) * 5))
        : current.cooldownSeconds,
      jevApiKey: typeof next.jevApiKey === 'string' ? next.jevApiKey : current.jevApiKey,
    } }
    await persist()
  }

  async function saveSpeech(next: SpeechConfig): Promise<void> {
    config.value = { ...config.value, speech: next }
    await persist()
    applyConfig(config.value)
  }

  async function saveHearing(next: HearingConfig): Promise<void> {
    config.value = { ...config.value, hearing: next }
    await persist()
    applyConfig(config.value)
  }

  async function saveVision(next: VisionConfig): Promise<void> {
    config.value = { ...config.value, vision: next }
    await persist()
    applyConfig(config.value)
  }

  async function saveWebSearch(next: WebSearchConfig): Promise<void> {
    config.value = { ...config.value, webSearch: next }
    await persist()
    applyConfig(config.value)
  }

  async function testConnection(next: ConsciousnessConfig): Promise<void> {
    if (next.providerType === 'mock') {
      connectionState.value = 'connected'
      connectionMessage.value = 'Mock provider is always available.'
      return
    }
    if (!next.baseUrl.trim() || !next.apiKey.trim() || !next.model.trim()) {
      connectionState.value = 'failed'
      connectionMessage.value = 'Fill in Base URL, API Key, and Model first.'
      return
    }
    connectionState.value = 'connecting'
    connectionMessage.value = ''
    const result = await testOpenAICompatibleConnection({
      baseUrl: next.baseUrl,
      apiKey: next.apiKey,
      model: next.model,
      temperature: next.temperature,
    })
    connectionState.value = result.ok ? 'connected' : 'failed'
    connectionMessage.value = result.ok ? 'Connected.' : (result.error ?? 'Connection failed.')
  }

  async function testVoice(next: SpeechConfig): Promise<TestVoiceResult> {
    if (next.providerType === 'none') {
      voiceState.value = 'failed'
      voiceMessage.value = 'Speech is disabled. Choose a provider first.'
      return { ok: false, message: voiceMessage.value }
    }

    voiceState.value = 'connecting'
    voiceMessage.value = ''
    const provider = buildSpeechProvider(next)
    if (!provider) {
      voiceState.value = 'failed'
      voiceMessage.value = 'Fill in the required fields first.'
      return { ok: false, message: voiceMessage.value }
    }

    try {
      // Browser speech speaks directly; other providers return audio to play.
      const result = await provider.synthesize({ text: '你好，我是 Aisling。' })
      if (result.audio) {
        voiceMessage.value = 'Audio received. Playing…'
        return { ok: true, message: voiceMessage.value, audio: result.audio }
      }
      voiceState.value = 'connected'
      voiceMessage.value = 'Ready.'
      return { ok: true, message: voiceMessage.value }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      voiceState.value = 'failed'
      voiceMessage.value = message
      return { ok: false, message }
    }
  }

  function completeVoicePlayback(): void {
    voiceState.value = 'connected'
    voiceMessage.value = 'Ready. Audio playback completed.'
  }

  function failVoicePlayback(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    voiceState.value = 'failed'
    voiceMessage.value = `Audio playback failure: ${detail}`
  }

  async function testVision(next: VisionConfig, image: ImageInput): Promise<TestVisionResult> {
    if (next.providerType !== 'openai-compatible') {
      visionState.value = 'failed'
      visionMessage.value = 'Vision is disabled. Choose the OpenAI-compatible provider first.'
      return { ok: false, message: visionMessage.value }
    }
    if (!next.baseUrl.trim() || !next.apiKey.trim() || !next.model.trim()) {
      visionState.value = 'failed'
      visionMessage.value = 'Fill in Base URL, API Key, and Model first.'
      return { ok: false, message: visionMessage.value }
    }
    visionState.value = 'connecting'
    visionMessage.value = ''
    const provider = buildVisionProvider(next)
    if (!provider) {
      visionState.value = 'failed'
      visionMessage.value = 'Could not build the vision provider.'
      return { ok: false, message: visionMessage.value }
    }
    try {
      const observation = await provider.analyze({ image })
      visionState.value = 'connected'
      visionMessage.value = 'Ready.'
      return { ok: true, message: 'Ready.', observation: observation.text }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      visionState.value = 'failed'
      visionMessage.value = message
      return { ok: false, message }
    }
  }

  async function testSearch(next: WebSearchConfig): Promise<TestSearchResult> {
    if (next.providerType !== 'tavily') {
      searchState.value = 'failed'
      searchMessage.value = 'Web Search is disabled. Choose the Tavily provider first.'
      return { ok: false, message: searchMessage.value }
    }
    if (!next.apiKey.trim()) {
      searchState.value = 'failed'
      searchMessage.value = 'Fill in the API Key first.'
      return { ok: false, message: searchMessage.value }
    }
    searchState.value = 'connecting'
    searchMessage.value = ''
    const provider = buildWebSearchProvider(next)
    if (!provider) {
      searchState.value = 'failed'
      searchMessage.value = 'Could not build the search provider.'
      return { ok: false, message: searchMessage.value }
    }
    try {
      const results = await provider.search('OpenAI')
      searchResults.value = results
      searchState.value = 'connected'
      searchMessage.value = 'Ready.'
      return { ok: true, message: 'Ready.', results }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      searchState.value = 'failed'
      searchMessage.value = message
      return { ok: false, message }
    }
  }

  /** Recognizes audio with the current or a draft hearing config. */
  async function transcribe(audio: RecognitionAudio, draft?: HearingConfig): Promise<string> {
    const provider = draft ? buildHearingProvider(draft) : activeHearingProvider.value
    if (!provider)
      throw new Error('Hearing is not configured')

    const result = await provider.recognize({ audio })
    lastTranscript.value = result.text
    return result.text
  }

  return {
    activeChatProvider,
    activeHearingProvider,
    activeSpeechProvider,
    activeTools,
    activeVisionProvider,
    activeWebSearchTool,
    config,
    connectionMessage,
    connectionState,
    completeVoicePlayback,
    lastTranscript,
    load,
    loaded,
    failVoicePlayback,
    modules,
    saveConsciousness,
    saveDesktopAwareness,
    saveHearing,
    saveSpeech,
    saveVision,
    saveWebSearch,
    searchMessage,
    searchResults,
    searchState,
    testConnection,
    testSearch,
    testVision,
    testVoice,
    transcribe,
    visionMessage,
    visionState,
    voiceMessage,
    voiceState,
  }
})
