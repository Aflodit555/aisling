import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'

afterEach(() => vi.unstubAllGlobals())

it('persists module switches and removes disabled providers from new calls', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { speechSynthesis: {}, localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } })
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  await settings.load()

  expect(settings.activeTools).toHaveLength(1)
  await settings.setModuleEnabled('webSearch', false)
  expect(settings.activeTools).toHaveLength(0)
  await settings.setModuleEnabled('webSearch', true)
  expect(settings.activeTools).toHaveLength(1)

  await settings.setModuleEnabled('vision', true)
  expect(settings.config.vision.enabled).toBe(false)
  await settings.saveVision({ providerType: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'model' })
  await settings.setModuleEnabled('vision', true)
  expect(settings.activeVisionProvider).toBeDefined()
  await settings.setModuleEnabled('vision', false)
  expect(settings.activeVisionProvider).toBeUndefined()

  await settings.saveSpeech({ ...settings.config.speech, providerType: 'browser' })
  await settings.setModuleEnabled('speech', true)
  expect(settings.activeSpeechProvider).toBeDefined()
  await settings.setModuleEnabled('speech', false)
  expect(settings.activeSpeechProvider).toBeUndefined()
  expect(JSON.parse(data.get('aisling.config.v1')!).speech.enabled).toBe(false)
})

it('defaults Memory on and persists opt-out across restarts without replacing the chat provider', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) } } })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  expect(settings.config.memory).toEqual({ enabled: true, formationEnabled: false })
  const provider = { id: 'unchanged', complete: vi.fn(async () => ({ text: '' })) }
  settings.activeChatProvider = provider
  await settings.setMemoryEnabled(true)
  expect(settings.activeChatProvider).toBe(provider)
  setActivePinia(createPinia())
  const restarted = useSettingsStore(); await restarted.load()
  expect(restarted.config.memory.enabled).toBe(true)
  await restarted.setMemoryEnabled(false)
  setActivePinia(createPinia())
  const disabled = useSettingsStore(); await disabled.load()
  expect(disabled.config.memory.enabled).toBe(false)
  expect(provider.complete).not.toHaveBeenCalled()
})

it('persists both switches and requires a new Formation opt-in after Memory is turned off', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) } } })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  expect(settings.config.memory.formationEnabled).not.toBe(true)
  await settings.setMemoryFormationEnabled(true)
  setActivePinia(createPinia())
  const enabled = useSettingsStore(); await enabled.load()
  expect(enabled.config.memory).toEqual({ enabled: true, formationEnabled: true })
  const provider = { id: 'unchanged', complete: vi.fn(async () => ({ text: '' })) }
  enabled.activeChatProvider = provider
  await enabled.setMemoryEnabled(false)
  expect(enabled.activeChatProvider).toBe(provider)
  expect(enabled.config.memory).toEqual({ enabled: false, formationEnabled: false })
  expect(JSON.parse(data.get('aisling.config.v1')!).memory).toEqual({ enabled: false, formationEnabled: false })
  await enabled.setMemoryFormationEnabled(true)
  expect(enabled.config.memory.formationEnabled).toBe(false)
  setActivePinia(createPinia())
  const restarted = useSettingsStore(); await restarted.load()
  expect(restarted.config.memory).toEqual({ enabled: false, formationEnabled: false })
  await restarted.setMemoryEnabled(true)
  expect(restarted.config.memory).toEqual({ enabled: true, formationEnabled: false })
  expect(provider.complete).not.toHaveBeenCalled()
})
