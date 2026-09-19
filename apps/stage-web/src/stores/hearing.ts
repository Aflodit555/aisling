import type { HearingConfig } from '@aisling/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createMicrophoneRecorder } from '../audio/microphone'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'

/**
 * Owns the hearing input pipeline: capture microphone audio, recognize it
 * through the active hearing provider, and expose the transcript. Each step
 * emits a Devtools event so a silent failure is never invisible.
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
    useStageStore().appendEvent({ type: 'hearing:capture_started' })
    try {
      await recorder.start()
      recording.value = true
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      recording.value = false
      useStageStore().appendEvent({ type: 'hearing:error', error: error.value })
      throw cause
    }
  }

  async function stopAndTranscribe(draft?: HearingConfig): Promise<string | undefined> {
    if (!recording.value)
      return undefined

    recording.value = false
    useStageStore().appendEvent({ type: 'hearing:capture_stopped' })
    recognizing.value = true
    try {
      const blob = await recorder.stop()
      if (blob.size === 0)
        throw new Error('The recording is empty — nothing was captured.')

      useStageStore().appendEvent({ type: 'hearing:recognition_started' })
      const data = await blob.arrayBuffer()
      const text = await settings.transcribe({ data, mimeType: blob.type || 'audio/webm' }, draft)
      transcript.value = text
      useStageStore().appendEvent({ type: 'hearing:transcript_ready', transcript: text })
      return text
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      useStageStore().appendEvent({ type: 'hearing:error', error: error.value })
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
