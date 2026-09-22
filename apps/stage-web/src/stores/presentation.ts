import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  DEFAULT_CHARACTER_DISPLAY_TRANSFORM,
  normalizeCharacterDisplayTransform,
  type CharacterDisplayTransform,
} from '../live2d/presentation'
import { resolvePersistentStorage } from '../storage/desktop-storage'

export const CHARACTER_DISPLAY_STORAGE_KEY = 'aisling.presentation.character-display.v1'

export const usePresentationStore = defineStore('presentation', () => {
  const storage = resolvePersistentStorage()
  const transform = ref(read())

  function read(): CharacterDisplayTransform {
    try {
      const saved = storage.getItem(CHARACTER_DISPLAY_STORAGE_KEY)
      return normalizeCharacterDisplayTransform(saved ? JSON.parse(saved) : undefined)
    }
    catch {
      return { ...DEFAULT_CHARACTER_DISPLAY_TRANSFORM }
    }
  }

  function setTransform(next: CharacterDisplayTransform): void {
    transform.value = normalizeCharacterDisplayTransform(next)
    try {
      storage.setItem(CHARACTER_DISPLAY_STORAGE_KEY, JSON.stringify(transform.value))
    }
    catch {
      // Persistence is best-effort when browser storage is unavailable or full.
    }
  }

  function resetTransform(): void {
    setTransform({ ...DEFAULT_CHARACTER_DISPLAY_TRANSFORM })
  }

  return { transform, setTransform, resetTransform }
})
