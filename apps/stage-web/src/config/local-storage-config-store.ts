import {
  createDefaultPlatformConfig,
  type ConfigStore,
  type PlatformConfig,
} from '@aisling/core'

import type { PersistentStorage } from '../storage/desktop-storage'

const KEY = 'aisling.config.v1'
const LEGACY_CONSCIOUSNESS_KEY = 'aisling.consciousness.config.v1'

/**
 * localStorage-backed `ConfigStore` for the unified platform config. All module
 * settings (consciousness/speech/hearing) share one store; the API keys live
 * only in the browser and never in source control. Swap the storage
 * implementation behind the same `ConfigStore` interface to move to a file or
 * service later.
 */
export function createLocalStorageConfigStore(storage: PersistentStorage = window.localStorage): ConfigStore {
  return {
    async get() {
      const defaults = createDefaultPlatformConfig()
      try {
        const raw = storage.getItem(KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PlatformConfig>
          const storedSpeech = parsed.speech as Partial<PlatformConfig['speech']> | undefined
          // v0.1.6 had only HTTP TTS and no transport field. Preserve that
          // behavior for existing users while new configurations default to WS.
          const migratedTransport = storedSpeech?.transport
            ?? (storedSpeech?.endpoint?.startsWith('http://') || storedSpeech?.endpoint?.startsWith('https://') ? 'http' : defaults.speech.transport)
          return {
            consciousness: { ...defaults.consciousness, ...parsed.consciousness },
            speech: { ...defaults.speech, ...parsed.speech, transport: migratedTransport },
            hearing: { ...defaults.hearing, ...parsed.hearing },
            vision: { ...defaults.vision, ...parsed.vision },
            webSearch: { ...defaults.webSearch, ...parsed.webSearch },
          }
        }

        // v0.1.1 stored only the consciousness config under a different key.
        const legacy = storage.getItem(LEGACY_CONSCIOUSNESS_KEY)
        if (legacy) {
          const old = JSON.parse(legacy) as Record<string, unknown>
          return { ...defaults, consciousness: { ...defaults.consciousness, ...old } }
        }

        return defaults
      }
      catch {
        return defaults
      }
    },
    async set(config) {
      storage.setItem(KEY, JSON.stringify(config))
    },
  }
}
