import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import {
  DEFAULT_CHARACTER_DISPLAY_TRANSFORM,
  normalizeCharacterDisplayTransform,
  fitStageCharacter,
  CHARACTER_DISPLAY_LIMITS,
  type CharacterDisplayTransform,
  type StageCharacterLayout,
} from '../live2d/presentation'
import { resolvePersistentStorage } from '../storage/desktop-storage'

export const CHARACTER_DISPLAY_STORAGE_KEY = 'aisling.presentation.character-display.v1'

export const usePresentationStore = defineStore('presentation', () => {
  const storage = resolvePersistentStorage()
  const transform = ref(read())
  const limits = ref({ scale: { min: CHARACTER_DISPLAY_LIMITS.scale.min, max: CHARACTER_DISPLAY_LIMITS.scale.max }, offset: { min: 0, max: 0 } })
  const stageLayout = shallowRef<StageCharacterLayout>()
  let persisted = false

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
    const normalized = normalizeCharacterDisplayTransform(next)
    const fitted = stageLayout.value && fitStageCharacter(stageLayout.value, normalized)
    if (fitted) limits.value = fitted.limits
    const legal = fitted ? fitted.transform : normalized
    if (persisted && legal.scale === transform.value.scale && legal.offsetX === transform.value.offsetX && legal.offsetY === transform.value.offsetY) return
    transform.value = legal
    try {
      storage.setItem(CHARACTER_DISPLAY_STORAGE_KEY, JSON.stringify(transform.value))
      persisted = true
    }
    catch {
      // Persistence is best-effort when browser storage is unavailable or full.
    }
  }

  function setStageLayout(next: StageCharacterLayout): void {
    stageLayout.value = next
    setTransform(transform.value)
  }

  function resetTransform(): void {
    setTransform({ ...DEFAULT_CHARACTER_DISPLAY_TRANSFORM })
  }

  return { transform, limits, stageLayout, setTransform, setStageLayout, resetTransform }
})
