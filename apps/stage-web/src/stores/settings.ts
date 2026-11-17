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
} from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

import { createLocalStorageConfigStore } from '../config/local-storage-config-store'
import { resolvePersistentStorage } from '../storage/desktop-storage'
import {
  buildChatProvider,
  buildSpeechProvider,
  buildVisionProvider,
  buildWebSearchTool,
  speechConfigurationIssue,
  visionConfigurationIssue,
} from '../runtime/provider-factory'

export const useSettingsStore = defineStore('settings', () => {
  const configStore = createLocalStorageConfigStore(resolvePersistentStorage(), !window.aislingDesktop?.memoryOrganization)

  const config = ref<PlatformConfig>(createDefaultPlatformConfig())
  const loaded = ref(false)

  const activeChatProvider = shallowRef<ChatProvider | undefined>(undefined)
  const activeSpeechProvider = shallowRef<SpeechProvider | undefined>(undefined)
  const activeVisionProvider = shallowRef<VisionProvider | undefined>(undefined)
  const activeWebSearchTool = shallowRef<Tool | undefined>(undefined)

  const activeTools = computed(() => (activeWebSearchTool.value ? [activeWebSearchTool.value] : []))

  const speechReady = computed(() => !speechConfigurationIssue(config.value.speech))
  const visionReady = computed(() => !visionConfigurationIssue(config.value.vision))
  const webSearchReady = computed(() => config.value.webSearch.providerType === 'duckduckgo')
  type Module = 'speech' | 'vision' | 'webSearch'
  const activationRequested = reactive({ speech: false, vision: false, webSearch: false, desktopAwareness: false })
  const moduleError = reactive({ speech: '', vision: '', webSearch: '', desktopAwareness: '' })
  const moduleBusy = reactive({ speech: false, vision: false, webSearch: false, desktopAwareness: false })
  const saveAndEnable = computed(() => ({
    speech: activationRequested.speech || (!config.value.speech.enabled && !speechReady.value),
    vision: activationRequested.vision || (!config.value.vision.enabled && !visionReady.value),
    webSearch: activationRequested.webSearch || (!config.value.webSearch.enabled && !webSearchReady.value),
  }))


  async function applyConfig(next: PlatformConfig, save = false): Promise<void> {
    let chat, speech, vision, search
    try {
      chat = loaded.value && next.consciousness === config.value.consciousness ? activeChatProvider.value : buildChatProvider(next.consciousness)
      speech = loaded.value && next.speech === config.value.speech ? activeSpeechProvider.value : buildSpeechProvider(next.speech)
      vision = loaded.value && next.vision === config.value.vision ? activeVisionProvider.value : buildVisionProvider(next.vision)
      search = loaded.value && next.webSearch === config.value.webSearch ? activeWebSearchTool.value : buildWebSearchTool(next.webSearch)
    } catch { throw new Error('Could not start module.') }
    if (save) await configStore.set(next)
    config.value = next
    activeChatProvider.value = chat
    activeSpeechProvider.value = speech
    activeVisionProvider.value = vision
    activeWebSearchTool.value = search
  }

  async function load(): Promise<void> {
    await applyConfig(await configStore.get())
    if ((config.value.speech.enabled && !speechReady.value)
      || (config.value.vision.enabled && !visionReady.value)
      || (config.value.webSearch.enabled && !webSearchReady.value)) {
      config.value.speech.enabled &&= speechReady.value
      config.value.vision.enabled &&= visionReady.value
      config.value.webSearch.enabled &&= webSearchReady.value
      await persist()
      await applyConfig(config.value)
    }
    loaded.value = true
  }

  async function persist(): Promise<void> {
    await configStore.set(config.value)
  }

  async function saveConsciousness(next: ConsciousnessConfig): Promise<void> {
    await applyConfig({ ...config.value, consciousness: next }, true)
  }

  async function saveDesktopAwareness(next: DesktopAwarenessConfig): Promise<void> {
    const current = config.value.desktopAwareness
    const updated = { ...config.value, desktopAwareness: {
      enabled: Boolean(next.enabled),
      cooldownSeconds: Number.isFinite(next.cooldownSeconds)
        ? Math.max(10, Math.min(300, Math.round(next.cooldownSeconds / 5) * 5))
        : current.cooldownSeconds,
      jevApiKey: typeof next.jevApiKey === 'string' ? next.jevApiKey : current.jevApiKey,
      replyHistoryEnabled: next.replyHistoryEnabled === true,
      ...(next.situationEnabled === true ? { situationEnabled: true } : {}),
    } }
    try { await configStore.set(updated) }
    catch { throw new Error('Could not save settings.') }
    config.value = updated
  }

  function configurationIssue(module: Module, next = config.value): string {
    return module === 'speech' ? speechConfigurationIssue(next.speech) : module === 'vision'
      ? visionConfigurationIssue(next.vision) : next.webSearch.providerType === 'duckduckgo' ? '' : 'Choose a provider.'
  }

  async function saveModule(module: Module, next: PlatformConfig): Promise<boolean> {
    if (moduleBusy[module]) return false
    const issue = configurationIssue(module, next)
    if (next[module].enabled && issue) { moduleError[module] = issue; return false }
    moduleBusy[module] = true
    moduleError[module] = ''
    try {
      await applyConfig(next, true)
      activationRequested[module] = false
      return true
    } catch (error) {
      moduleError[module] = error instanceof Error && error.message === 'Could not start module.' ? error.message : 'Could not save settings.'
      return false
    } finally { moduleBusy[module] = false }
  }

  function saveSpeech(next: Omit<SpeechConfig, 'enabled'>, enabled = config.value.speech.enabled): Promise<boolean> {
    return saveModule('speech', { ...config.value, speech: { ...next, enabled } })
  }

  function saveVision(next: Omit<VisionConfig, 'enabled'>, enabled = config.value.vision.enabled): Promise<boolean> {
    return saveModule('vision', { ...config.value, vision: { ...next, enabled } })
  }

  function saveWebSearch(next: Omit<WebSearchConfig, 'enabled'>, enabled = config.value.webSearch.enabled): Promise<boolean> {
    return saveModule('webSearch', { ...config.value, webSearch: { ...next, enabled } })
  }

  async function setModuleEnabled(module: Module, enabled: boolean): Promise<boolean> {
    activationRequested[module] = enabled
    return saveModule(module, { ...config.value, [module]: { ...config.value[module], enabled } })
  }

  async function setMemoryEnabled(enabled: boolean): Promise<void> {
    config.value = { ...config.value, memory: { ...config.value.memory, enabled: enabled === true,
      formationEnabled: enabled === true && config.value.memory.enabled && config.value.memory.formationEnabled === true,
      ...(window.aislingDesktop?.memoryOrganization && {
        organizationEnabled: enabled === true && config.value.memory.enabled && config.value.memory.organizationEnabled === true,
      }) } }
    if (!enabled) delete config.value.memory.noteRecallEnabled
    await persist()
  }

  /** Formation requires Memory and does not replace the provider. */
  async function setMemoryFormationEnabled(enabled: boolean): Promise<void> {
    config.value = { ...config.value, memory: { ...config.value.memory, formationEnabled: config.value.memory.enabled && enabled === true } }
    await persist()
  }
  async function setMemoryOrganizationEnabled(enabled: boolean): Promise<void> {
    if (!window.aislingDesktop?.memoryOrganization || (enabled && !activeChatProvider.value)) return
    config.value = { ...config.value, memory: { ...config.value.memory, organizationEnabled:config.value.memory.enabled && enabled===true } }
    await persist()
  }
  async function setNoteRecallEnabled(enabled: boolean): Promise<void> {
    const memory = { ...config.value.memory }
    if (enabled && memory.enabled && (window.aislingDesktop?.noteRecall || window.aislingDesktop?.memoryOrganization?.recallHeads)) memory.noteRecallEnabled = true
    else delete memory.noteRecallEnabled
    config.value = { ...config.value, memory }
    await persist()
  }

  async function saveEmbedding(embedding: NonNullable<PlatformConfig['memory']['embedding']>): Promise<void> {
    const next = {...config.value,memory:{...config.value.memory,embedding}}
    await configStore.set(next)
    config.value = next
  }

  async function saveObsidianMirror(value: NonNullable<PlatformConfig['memory']['obsidianMirror']>) {
    const next = { ...config.value, memory: { ...config.value.memory, obsidianMirror: { enabled: value.enabled, vault: value.vault.trim() } } }
    await configStore.set(next)
    config.value = next
    return window.aislingDesktop?.obsidianMirror?.configure()
  }

  return {
    activationRequested, moduleError, moduleBusy, saveAndEnable,
    saveEmbedding,
    saveObsidianMirror,
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
    setMemoryEnabled,
    setMemoryFormationEnabled,
    setNoteRecallEnabled,
    setMemoryOrganizationEnabled,
    speechReady,
    visionReady,
    webSearchReady,
  }
})
