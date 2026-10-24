import { expect, it } from 'vitest'
import { createDefaultPlatformConfig } from '@aisling/core'
import { createLocalStorageConfigStore } from './local-storage-config-store'

it('defaults legacy Memory settings to off and only restores explicit boolean consent', async () => {
  for (const memory of [undefined, {}, { enabled: 'true' }, { enabled: false }, { enabled: true }]) {
    let raw = JSON.stringify({ ...createDefaultPlatformConfig(), memory })
    const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, text) => { raw = text } })
    const loaded = await store.get()
    expect(loaded.memory.enabled).toBe(memory?.enabled === true)
    await store.set(loaded)
    expect((await store.get()).memory.enabled).toBe(memory?.enabled === true)
  }
})

it('requires explicit P2 opt-in, retains it in the existing config and defaults old configs to off', async () => {
  for (const value of [undefined, false, 'true', true]) {
    let raw = JSON.stringify({ ...createDefaultPlatformConfig(), desktopAwareness: {
      ...createDefaultPlatformConfig().desktopAwareness, situationEnabled: value } })
    const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, text) => { raw = text } })
    const result = await store.get()
    expect(result.desktopAwareness.situationEnabled === true).toBe(value === true)
    await store.set(result)
    expect(JSON.parse(raw).desktopAwareness.situationEnabled === true).toBe(value === true)
  }
})

it('removes obsolete awareness settings from memory and persistence on load', async () => {
  const config = createDefaultPlatformConfig()
  let raw = JSON.stringify({ ...config, desktopAwareness: {
    enabled: true, cooldownSeconds: 15, maxBusyScore: 1.6, remarkable: 0.8, topicOpportunity: 0.65,
  } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  const loaded = await store.get()
  expect(loaded.desktopAwareness).toEqual({ enabled: true, cooldownSeconds: 15, jevApiKey: '', replyHistoryEnabled: false })
  expect(JSON.parse(raw)).toEqual(loaded)
  expect(loaded.consciousness).toEqual(config.consciousness)
})

it('discards saved Hearing credentials while preserving other settings', async () => {
  const defaults = createDefaultPlatformConfig()
  let raw = JSON.stringify({ ...defaults, hearing: { providerType: 'alibaba', apiKey: 'old-secret' } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  expect(await store.get()).toEqual(defaults)
  expect(JSON.parse(raw)).toEqual(defaults)
  expect(raw).not.toContain('old-secret')
})

it('requires an explicit boolean opt-in for target reply history and persists it', async () => {
  for (const value of [undefined, false, 'true', true]) {
    let raw = JSON.stringify({ ...createDefaultPlatformConfig(), desktopAwareness: { enabled: false, cooldownSeconds: 30,
      jevApiKey: 'saved-key', replyHistoryEnabled: value } })
    const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, next) => { raw = next } })
    const loaded = await store.get()
    expect(loaded.desktopAwareness.replyHistoryEnabled).toBe(value === true)
    await store.set(loaded)
    expect(JSON.parse(raw).desktopAwareness.replyHistoryEnabled).toBe(value === true)
  }
})

it('migrates old history consent once, removes the old key and preserves formal settings', async () => {
  for (const value of [true, false, 'true']) {
    const original = createDefaultPlatformConfig()
    let raw = JSON.stringify({ ...original, desktopAwareness: { enabled: true, cooldownSeconds: 45, jevApiKey: 'saved', eventHistoryEnabled: value } })
    const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, next) => { raw = next } })
    const result = await store.get()
    expect(result.desktopAwareness).toEqual({ enabled: true, cooldownSeconds: 45, jevApiKey: 'saved', replyHistoryEnabled: value === true })
    expect(raw).not.toContain('eventHistoryEnabled')
    expect(result.consciousness).toEqual(original.consciousness)
    expect(result.speech).toEqual(original.speech)
  }
})

it('migrates Tavily settings to keyless DuckDuckGo search', async () => {
  let raw = JSON.stringify({ ...createDefaultPlatformConfig(), webSearch: { providerType: 'tavily', apiKey: 'old-key' } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  expect((await store.get()).webSearch).toEqual({ providerType: 'duckduckgo', enabled: true })
  expect(JSON.parse(raw).webSearch).toEqual({ providerType: 'duckduckgo', enabled: true })
})

it('keeps an explicitly disabled search disabled without retaining its old key', async () => {
  let raw = JSON.stringify({ ...createDefaultPlatformConfig(), webSearch: { providerType: 'none', apiKey: 'old-key' } })
  const store = createLocalStorageConfigStore({ getItem: () => raw, setItem: (_key, value) => { raw = value } })
  expect((await store.get()).webSearch).toEqual({ providerType: 'none', enabled: false })
  expect(JSON.parse(raw).webSearch).toEqual({ providerType: 'none', enabled: false })
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
