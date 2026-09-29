import {
  createDefaultPlatformConfig,
  type ChatProvider,
  type ConsciousnessConfig,
  type DesktopAwarenessConfig,
  type PlatformConfig,
  type SpeechConfig,
  type SpeechProvider,
  type Tool,
  type VisionConfig,
  type VisionProvider,
  type WebSearchConfig,
  validateAlibabaTtsEndpoint,
} from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { createLocalStorageConfigStore } from '../config/local-storage-config-store'
import { resolvePersistentStorage } from '../storage/desktop-storage'
import {
  buildChatProvider,
  buildSpeechProvider,
  buildVisionProvider,
  buildWebSearchTool,
} from '../runtime/provider-factory'

export const useSettingsStore = defineStore('settings', () => {
  const configStore = createLocalStorageConfigStore(resolvePersistentStorage())

  const config = ref<PlatformConfig>(createDefaultPlatformConfig())
  const loaded = ref(false)

  const activeChatProvider = shallowRef<ChatProvider | undefined>(undefined)
  const activeSpeechProvider = shallowRef<SpeechProvider | undefined>(undefined)
  const activeVisionProvider = shallowRef<VisionProvider | undefined>(undefined)
  const activeWebSearchTool = shallowRef<Tool | undefined>(undefined)

  const activeTools = computed(() => (activeWebSearchTool.value ? [activeWebSearchTool.value] : []))

  const speechReady = computed(() => (config.value.speech.providerType === 'browser' && typeof window !== 'undefined' && Boolean(window.speechSynthesis))
    || (config.value.speech.providerType === 'alibaba' && Boolean(config.value.speech.apiKey.trim() && config.value.speech.model.trim() && config.value.speech.voice.trim()) && !validateAlibabaTtsEndpoint(config.value.speech.endpoint, config.value.speech.transport)))
  const visionReady = computed(() => config.value.vision.providerType === 'openai-compatible'
    && Boolean(config.value.vision.baseUrl.trim() && config.value.vision.apiKey.trim() && config.value.vision.model.trim()))
  const webSearchReady = computed(() => config.value.webSearch.providerType === 'duckduckgo')


  function applyConfig(next: PlatformConfig): void {
    config.value = next
    activeChatProvider.value = buildChatProvider(next.consciousness)
    activeSpeechProvider.value = buildSpeechProvider(next.speech)
    activeVisionProvider.value = buildVisionProvider(next.vision)
    activeWebSearchTool.value = buildWebSearchTool(next.webSearch)
  }

  async function load(): Promise<void> {
    applyConfig(await configStore.get())
    if ((config.value.speech.enabled && !speechReady.value)
      || (config.value.vision.enabled && !visionReady.value)
      || (config.value.webSearch.enabled && !webSearchReady.value)) {
      config.value.speech.enabled &&= speechReady.value
      config.value.vision.enabled &&= visionReady.value
      config.value.webSearch.enabled &&= webSearchReady.value
      await persist()
      applyConfig(config.value)
    }
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

  async function saveSpeech(next: Omit<SpeechConfig, 'enabled'>): Promise<void> {
    config.value = { ...config.value, speech: { ...next, enabled: config.value.speech.enabled } }
    if (!speechReady.value) config.value.speech.enabled = false
    await persist()
    applyConfig(config.value)
  }

  async function saveVision(next: Omit<VisionConfig, 'enabled'>): Promise<void> {
    config.value = { ...config.value, vision: { ...next, enabled: config.value.vision.enabled } }
    if (!visionReady.value) config.value.vision.enabled = false
    await persist()
    applyConfig(config.value)
  }

  async function saveWebSearch(next: Omit<WebSearchConfig, 'enabled'>): Promise<void> {
    config.value = { ...config.value, webSearch: { ...next, enabled: config.value.webSearch.enabled } }
    if (!webSearchReady.value) config.value.webSearch.enabled = false
    await persist()
    applyConfig(config.value)
  }

  async function setModuleEnabled(module: 'speech' | 'vision' | 'webSearch', enabled: boolean): Promise<void> {
    if (enabled && !(module === 'speech' ? speechReady.value : module === 'vision' ? visionReady.value : webSearchReady.value)) return
    config.value = { ...config.value, [module]: { ...config.value[module], enabled } }
    await persist()
    applyConfig(config.value)
  }

  return {
    activeChatProvider,
    activeSpeechProvider,
    activeTools,
    activeVisionProvider,
    activeWebSearchTool,
    config,
    load,
    loaded,
    saveConsciousness,
    saveDesktopAwareness,
    saveSpeech,
    saveVision,
    saveWebSearch,
    setModuleEnabled,
    speechReady,
    visionReady,
    webSearchReady,
  }
})
