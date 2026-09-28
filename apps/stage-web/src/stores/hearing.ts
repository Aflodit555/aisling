import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createMicrophoneRecorder } from '../audio/microphone'
import { useSettingsStore } from './settings'

/**
 * Owns the hearing input pipeline: capture microphone audio, recognize it
 * through the active hearing provider, and expose the transcript and errors.
 */
export const useHearingStore = defineStore('hearing', () => {
  const settings = useSettingsStore()
  const recorder = createMicrophoneRecorder()

  const recording = ref(false)
  const recognizing = ref(false)
  const transcript = ref('')
  const error = ref('')

  async function startRecording(): Promise<void> {
    error.value = ''
    try {
      await recorder.start()
      recording.value = true
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      recording.value = false
      throw cause
    }
  }

  async function stopAndTranscribe(): Promise<string | undefined> {
    if (!recording.value)
      return undefined

    recording.value = false
    recognizing.value = true
    try {
      const blob = await recorder.stop()
      if (blob.size === 0)
        throw new Error('The recording is empty — nothing was captured.')

      const data = await blob.arrayBuffer()
      const text = await settings.transcribe({ data, mimeType: blob.type || 'audio/webm' })
      transcript.value = text
      return text
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return undefined
    }
    finally {
      recognizing.value = false
    }
  }

  function cancel(): void {
    recorder.cancel()
    recording.value = false
    recognizing.value = false
  }

  return {
    cancel,
    error,
    recognizing,
    recording,
    startRecording,
    stopAndTranscribe,
    transcript,
  }
})
