import { expect, it } from 'vitest'
import { createDefaultPlatformConfig } from '@aisling/core'
import { createLocalStorageConfigStore } from './local-storage-config-store'

it('removes obsolete awareness settings from memory and persistence on load', async () => {
  const config = createDefaultPlatformConfig()
  let raw = JSON.stringify({ ...config, desktopAwareness: {
    enabled: true, cooldownSeconds: 15, maxBusyScore: 1.6, remarkable: 0.8, topicOpportunity: 0.65,
  } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  const loaded = await store.get()
  expect(loaded.desktopAwareness).toEqual({ enabled: true, cooldownSeconds: 15, jevApiKey: '' })
  expect(JSON.parse(raw)).toEqual(loaded)
  expect(loaded.consciousness).toEqual(config.consciousness)
})

it('migrates Tavily settings to keyless DuckDuckGo search', async () => {
  let raw = JSON.stringify({ ...createDefaultPlatformConfig(), webSearch: { providerType: 'tavily', apiKey: 'old-key' } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  expect((await store.get()).webSearch).toEqual({ providerType: 'duckduckgo' })
  expect(JSON.parse(raw).webSearch).toEqual({ providerType: 'duckduckgo' })
})

it('keeps an explicitly disabled search disabled without retaining its old key', async () => {
  let raw = JSON.stringify({ ...createDefaultPlatformConfig(), webSearch: { providerType: 'none', apiKey: 'old-key' } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  expect((await store.get()).webSearch).toEqual({ providerType: 'none' })
  expect(JSON.parse(raw).webSearch).toEqual({ providerType: 'none' })
})

it('migrates an old mock chat setting without losing its real provider fields', async () => {
  let raw = JSON.stringify({ ...createDefaultPlatformConfig(), consciousness: {
    providerType: 'mock', baseUrl: 'https://example.com/v1', apiKey: 'saved-key', model: 'saved-model', temperature: 0.7,
  } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  const loaded = await store.get()
  expect(loaded.consciousness).toEqual({
    providerType: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'saved-key', model: 'saved-model', temperature: 0.7,
  })
  expect(JSON.parse(raw).consciousness).toEqual(loaded.consciousness)
})
