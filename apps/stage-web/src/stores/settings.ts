import {
  createDefaultPlatformConfig,
  describeCapabilityModules,
  type ChatProvider,
  type ConsciousnessConfig,
  type DesktopAwarenessConfig,
  type HearingConfig,
  type HearingProvider,
  type PlatformConfig,
  type RecognitionAudio,
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
  buildWebSearchTool,
} from '../runtime/provider-factory'

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

  /** Recognizes audio with the current hearing config. */
  async function transcribe(audio: RecognitionAudio): Promise<string> {
    const provider = activeHearingProvider.value
    if (!provider)
      throw new Error('Hearing is not configured')

    const result = await provider.recognize({ audio })
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
    load,
    loaded,
    modules,
    saveConsciousness,
    saveDesktopAwareness,
    saveHearing,
    saveSpeech,
    saveVision,
    saveWebSearch,
    transcribe,
  }
})
