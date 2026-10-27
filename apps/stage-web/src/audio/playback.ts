import type { SpeechAudio } from '@aisling/core'

let cancelCurrent: (() => void) | undefined

/** Stops whatever is currently playing. */
export function stopPlayback(): void {
  cancelCurrent?.()
}

/**
 * Plays a `SpeechAudio`. This is the renderer layer: the speech provider only
 * produces audio; this module owns turning it into sound. Future renderers
 * (VTS, OBS, an external device) replace this without touching providers.
 */
export function playSpeechResult(
  audio: SpeechAudio,
  hooks?: { onElement?: (element: HTMLAudioElement) => void; onPlaying?: () => void; onWaiting?: () => void },
): Promise<void> {
  stopPlayback()

  return new Promise<void>((resolve, reject) => {
    const fromBytes = audio.kind === 'bytes'
    const url = fromBytes
      ? URL.createObjectURL(new Blob([audio.data], { type: audio.mimeType }))
      : audio.url

    const element = new Audio(url)
    hooks?.onElement?.(element)
    let settled = false

    const cleanup = () => {
      if (settled) return
      settled = true
      element.onended = element.onerror = element.onplaying = element.onwaiting = null
      if (fromBytes)
        URL.revokeObjectURL(url)
      if (cancelCurrent === cancel)
        cancelCurrent = undefined
    }
    const cancel = () => {
      element.pause()
      cleanup()
      resolve()
    }
    cancelCurrent = cancel
    element.onplaying = () => hooks?.onPlaying?.()
    element.onwaiting = () => hooks?.onWaiting?.()

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
