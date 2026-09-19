import { defineStore } from 'pinia'
import { ref } from 'vue'

import { playSpeechResult, stopPlayback } from '../audio/playback'
import { useSettingsStore } from './settings'

/**
 * Owns the speech output pipeline: synthesize text through the active speech
 * provider and play the result. Kept separate from the provider (which only
 * generates audio) and from Settings (which only holds configuration).
 */
export const useSpeechStore = defineStore('speech', () => {
  const settings = useSettingsStore()
  const speaking = ref(false)

  async function speak(text: string): Promise<void> {
    const provider = settings.activeSpeechProvider
    if (!provider || !text.trim())
      return

    speaking.value = true
    try {
      const result = await provider.synthesize({ text })
      if (result.audio)
        await playSpeechResult(result.audio)
    }
    catch (error) {
      // Speech failure never fails the conversation turn — the text is already
      // on screen. Just log it.
      console.error('[speech]', error instanceof Error ? error.message : String(error))
    }
    finally {
      speaking.value = false
    }
  }

  function stop(): void {
    stopPlayback()
    speaking.value = false
  }

  return { speaking, speak, stop }
})
