import type { SpeechAudio } from '@aisling/core'

let current: HTMLAudioElement | undefined

/** Stops whatever is currently playing. */
export function stopPlayback(): void {
  current?.pause()
  current = undefined
}

/**
 * Plays a `SpeechAudio`. This is the renderer layer: the speech provider only
 * produces audio; this module owns turning it into sound. Future renderers
 * (VTS, OBS, an external device) replace this without touching providers.
 */
export function playSpeechResult(audio: SpeechAudio): Promise<void> {
  stopPlayback()

  return new Promise<void>((resolve, reject) => {
    const fromBytes = audio.kind === 'bytes'
    const url = fromBytes
      ? URL.createObjectURL(new Blob([audio.data], { type: audio.mimeType }))
      : audio.url

    const element = new Audio(url)
    current = element

    const cleanup = () => {
      if (fromBytes)
        URL.revokeObjectURL(url)
      if (current === element)
        current = undefined
    }

    element.onended = () => {
      cleanup()
      resolve()
    }
    element.onerror = () => {
      cleanup()
      reject(new Error('Audio playback failed'))
    }
    element.play().catch((error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error('Audio playback failed'))
    })
  })
}
