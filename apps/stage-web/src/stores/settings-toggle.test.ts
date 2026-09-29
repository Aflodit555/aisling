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
