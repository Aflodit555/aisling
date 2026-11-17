import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'
import * as providers from '../runtime/provider-factory'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  const data = new Map<string, string>()
  let fail = false
  vi.stubGlobal('window', { speechSynthesis: {}, localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error('synthetic storage failure'); data.set(key, value) },
  } })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  return { settings, data, failWrites: (value: boolean) => { fail = value } }
}
const vision = { providerType: 'openai-compatible' as const, baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic', model: 'model' }

it('keeps a missing module off, remembers the enable request, and saves/enables/reloads in one action', async () => {
  const { settings } = await fixture()
  expect(await settings.setModuleEnabled('vision', true)).toBe(false)
  expect(settings.moduleError.vision).toBe('Choose a provider.')
  expect(settings.config.vision.enabled).toBe(false)
  expect(settings.saveAndEnable.vision).toBe(true)
  expect(await settings.saveVision(vision, settings.saveAndEnable.vision)).toBe(true)
  expect(settings.config.vision.enabled).toBe(true)
  expect(settings.activeVisionProvider).toBeDefined()
  expect(settings.activationRequested.vision).toBe(false)
  setActivePinia(createPinia()); const restored = useSettingsStore(); await restored.load()
  expect(restored.config.vision.enabled).toBe(true)
  expect(await restored.setModuleEnabled('vision', false)).toBe(true)
  expect(restored.activeVisionProvider).toBeUndefined()
  expect(await restored.setModuleEnabled('vision', true)).toBe(true)
})

it('does not publish or enable unsaved config when persistence fails, and permits retry', async () => {
  const { settings, failWrites } = await fixture()
  const before = settings.config
  failWrites(true)
  expect(await settings.saveVision(vision, true)).toBe(false)
  expect(settings.config).toBe(before)
  expect(settings.activeVisionProvider).toBeUndefined()
  expect(settings.moduleError.vision).toBe('Could not save settings.')
  failWrites(false)
  expect(await settings.saveVision(vision, true)).toBe(true)
})

it('distinguishes local provider construction failure from missing config and storage failure', async () => {
  const { settings, data } = await fixture()
  vi.spyOn(providers, 'buildVisionProvider').mockImplementationOnce(() => { throw new Error('synthetic startup failure') })
  expect(await settings.saveVision(vision, true)).toBe(false)
  expect(settings.moduleError.vision).toBe('Could not start module.')
  expect(settings.config.vision.enabled).toBe(false)
  expect(settings.activeVisionProvider).toBeUndefined()
  expect(data.has('aisling.config.v1')).toBe(false)
})

it('preserves running modules and their provider identities on a rejected edit or another module save', async () => {
  const { settings } = await fixture()
  await settings.saveConsciousness({ ...settings.config.consciousness, ...vision })
  await settings.saveVision(vision, true)
  const chat = settings.activeChatProvider, activeVision = settings.activeVisionProvider
  expect(await settings.saveVision({ ...vision, apiKey: '' })).toBe(false)
  expect(settings.activeVisionProvider).toBe(activeVision)
  expect(settings.config.vision.apiKey).toBe('synthetic')
  await settings.saveSpeech({ ...settings.config.speech, providerType: 'browser' }, true)
  expect(settings.activeChatProvider).toBe(chat)
  expect(settings.activeVisionProvider).toBe(activeVision)
})

it('uses the same speech endpoint and credential checks for readiness and activation', async () => {
  const { settings } = await fixture()
  const speech = { ...settings.config.speech, providerType: 'alibaba' as const, apiKey: 'synthetic', model: 'model', voice: 'voice', endpoint: 'https://example.invalid' }
  expect(await settings.saveSpeech(speech, true)).toBe(false)
  expect(settings.moduleError.speech).toBe('Check the endpoint.')
  expect(settings.config.speech.enabled).toBe(false)
  expect(await settings.saveSpeech({ ...speech, endpoint: settings.config.speech.endpoint }, true)).toBe(true)
  expect(settings.speechReady).toBe(true)
})

it('keeps the active module on when its OFF choice could not be persisted', async () => {
  const { settings, failWrites } = await fixture()
  await settings.saveVision(vision, true)
  const active = settings.activeVisionProvider
  failWrites(true)
  expect(await settings.setModuleEnabled('vision', false)).toBe(false)
  expect(settings.config.vision.enabled).toBe(true)
  expect(settings.activeVisionProvider).toBe(active)
  expect(settings.moduleError.vision).toBe('Could not save settings.')
})

it('uses the same first-configuration flow for Web Search without disturbing a running Vision provider', async () => {
  const { settings } = await fixture()
  await settings.saveVision(vision, true)
  const active = settings.activeVisionProvider
  await settings.saveWebSearch({ providerType: 'none' }, false)
  expect(await settings.setModuleEnabled('webSearch', true)).toBe(false)
  expect(settings.moduleError.webSearch).toBe('Choose a provider.')
  expect(await settings.saveWebSearch({ providerType: 'duckduckgo' }, settings.saveAndEnable.webSearch)).toBe(true)
  expect(settings.config.webSearch.enabled).toBe(true)
  expect(settings.activeWebSearchTool).toBeDefined()
  expect(settings.activeVisionProvider).toBe(active)
})
