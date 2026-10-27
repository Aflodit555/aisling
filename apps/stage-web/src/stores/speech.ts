import type { SpeechProvider, SpeechStreamCapability } from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { createAudioActivity, type AudioActivity } from '../audio/audio-activity'
import { playSpeechResult, stopPlayback } from '../audio/playback'
import { createStreamingPlayback, type StreamingPlayback } from '../audio/streaming-playback'
import { useSettingsStore } from './settings'

export type SpeechPhase = 'idle' | 'buffering' | 'playing' | 'draining' | 'error'

/**
 * Speech runtime: owns a speech session, its lifecycle and cleanup. It sits
 * between the provider (which produces audio / a stream) and playback (which
 * owns the audio element and queue). It matches a provider's stream descriptor
 * against the playback layer's capabilities, and never inspects codecs or
 * vendors (no audio/mpeg, MediaSource, Alibaba, … here).
 *
 * Lifecycle: speech:start → audio:chunk* → speech:progress* → speech:end.
 * `speech:end` is the single terminal event; provider finished is deliberately
 * distinct from playback finished, so `completed` only fires once the audio has
 * actually drained.
 *
 * It also exposes `readLevel()`: the raw playing audio amplitude (0..1, or
 * `undefined` when nothing is analysable) for Character Presentation. This is a
 * live signal, distinct from the `speaking` lifecycle boolean.
 */
export const useSpeechStore = defineStore('speech', () => {
  const settings = useSettingsStore()
  const phase = ref<SpeechPhase>('idle')
  // speaking = "the user can actually hear Aisling" — true only while audio is
  // playing/draining, not while the provider is still buffering/generating.
  const speaking = computed(() => phase.value === 'playing' || phase.value === 'draining')

  let sessionId = ''
  let activePlayback: StreamingPlayback | undefined
  let activeActivity: AudioActivity | undefined
  let activeAbort: AbortController | undefined

  function log(session: string, message: string): void {
    if (import.meta.env.MODE === 'development')
      console.log(`[speech] ${session} ${message}`)
  }

  function disposeActiveActivity(): void {
    activeActivity?.dispose()
    activeActivity = undefined
  }

  function disposeActivePlayback(): void {
    disposeActiveActivity()
    activePlayback?.dispose()
    activePlayback = undefined
  }

  function attachActivity(element: HTMLAudioElement): void {
    disposeActiveActivity()
    activeActivity = createAudioActivity(element)
  }

  function endSession(session: string, reason: 'completed' | 'error'): void {
    if (sessionId !== session)
      return
    log(session, `speech:end reason=${reason}`)
    sessionId = ''
    activeAbort?.abort()
    disposeActivePlayback()
    activeAbort = undefined
    phase.value = reason === 'error' ? 'error' : 'idle'
  }

  async function speak(text: string): Promise<void> {
    const provider = settings.activeSpeechProvider
    if (!provider || !text.trim())
      return

    // A new speech replaces any in-flight session. This is not a full
    // interruption system, but a stale session must never leak into the new one.
    stop()
    sessionId = crypto.randomUUID()
    const session = sessionId
    const controller = new AbortController()
    activeAbort = controller
    phase.value = 'buffering'
    log(session, 'speech:start')

    try {
      if (provider.stream) {
        const streamed = await runStreaming(session, provider.stream, text, controller.signal)
        if (streamed)
          return
      }
      if (sessionId !== session) return
      await runOneshot(session, provider, text, controller.signal)
    }
    catch (error) {
      if (sessionId !== session)
        return
      const message = error instanceof Error ? error.message : String(error)
      log(session, `speech:error ${message}`)
      endSession(session, 'error')
    }
  }

  function runStreaming(session: string, capability: SpeechStreamCapability, text: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const settle = () => { signal.removeEventListener('abort', cancelled); resolve(true) }
      const cancelled = () => settle()
      signal.addEventListener('abort', cancelled, { once: true })

      const playback = createStreamingPlayback(capability.descriptor, {
        onPhase(next) {
          if (sessionId !== session)
            return
          // 'ended' is the playback terminal; the store terminal is onEnded.
          if (next === 'ended')
            return
          phase.value = next
          log(session, `speech:progress ${next}`)
        },
        onEnded(reason) {
          if (sessionId !== session)
            return
          endSession(session, reason)
          settle()
        },
        onError(error) {
          if (sessionId !== session)
            return
          log(session, `speech:error ${error.message}`)
        },
      })

      // No playback implementation can consume this descriptor → fall back.
      if (!playback) {
        signal.removeEventListener('abort', cancelled)
        resolve(false)
        return
      }

      activePlayback = playback
      playback.start()
      const element = playback.getAudioElement()
      if (element)
        attachActivity(element)

      void capability.stream({ text, signal }, {
        onStart() {
          if (sessionId !== session)
            return
          log(session, 'provider started')
        },
        onAudio(chunk) {
          if (sessionId !== session)
            return
          activePlayback?.enqueue(chunk)
        },
        onEnd() {
          if (sessionId !== session)
            return
          log(session, 'provider finished')
          activePlayback?.complete()
        },
        onError(error) {
          if (sessionId !== session)
            return
          log(session, `provider error: ${error.message}`)
          endSession(session, 'error')
          settle()
        },
      }).catch((error: unknown) => {
        if (sessionId !== session)
          return
        const message = error instanceof Error ? error.message : String(error)
        log(session, `provider error: ${message}`)
        endSession(session, 'error')
        settle()
      })
    })
  }

  async function runOneshot(session: string, provider: SpeechProvider, text: string, signal: AbortSignal): Promise<void> {
    if (provider.speaksDirectly) {
      // Native speech (speechSynthesis): the audible period is the synthesize
      // call itself and there is no audio element to analyse.
      await provider.synthesize({ text, signal, onStart: () => {
        if (sessionId !== session) return
        phase.value = 'playing'
      } })
      if (sessionId !== session)
        return
      endSession(session, 'completed')
      return
    }

    const result = await provider.synthesize({ text, signal })
    if (sessionId !== session)
      return

    if (result.audio) {
      await playSpeechResult(result.audio, {
        onPlaying: () => {
          if (sessionId !== session) return
          phase.value = 'playing'
        },
        onWaiting: () => {
          if (sessionId !== session) return
          phase.value = 'buffering'
        },
        onElement: (element) => {
          if (sessionId === session)
            attachActivity(element)
        },
      })
      if (sessionId !== session)
        return
      endSession(session, 'completed')
      return
    }

    // Provider reported it spoke without the capability flag — treat as finished.
    phase.value = 'playing'
    endSession(session, 'completed')
  }

  function readLevel(): number | undefined {
    // Raw analysable amplitude (0..1); undefined means "no signal to analyse"
    // (no element, or a suspended/retrying AudioContext) — never a silent 0.
    return activeActivity?.level()
  }

  function stop(): void {
    sessionId = ''
    activeAbort?.abort()
    activeAbort = undefined
    disposeActivePlayback()
    stopPlayback()
    phase.value = 'idle'
  }

  return { speaking, phase, speak, stop, readLevel }
})
