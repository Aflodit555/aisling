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
