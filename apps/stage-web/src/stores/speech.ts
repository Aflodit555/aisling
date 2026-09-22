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
    disposeActivePlayback()
    sessionId = ''
    phase.value = 'idle'
  }

  async function speak(text: string): Promise<void> {
    const provider = settings.activeSpeechProvider
    if (!provider || !text.trim())
      return

    // A new speech replaces any in-flight session. This is not a full
    // interruption system, but a stale session must never leak into the new one.
    disposeActivePlayback()
    sessionId = crypto.randomUUID()
    const session = sessionId
    phase.value = 'buffering'
    log(session, 'speech:start')

    try {
      if (provider.stream) {
        const streamed = await runStreaming(session, provider.stream, text)
        if (streamed)
          return
      }
      await runOneshot(session, provider, text)
    }
    catch (error) {
      if (sessionId !== session)
        return
      const message = error instanceof Error ? error.message : String(error)
      log(session, `speech:error ${message}`)
      endSession(session, 'error')
    }
  }

  function runStreaming(session: string, capability: SpeechStreamCapability, text: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let firstChunkAt = 0
      let firstPlaybackAt = 0

      const playback = createStreamingPlayback(capability.descriptor, {
        onPhase(next) {
          if (sessionId !== session)
            return
          // 'ended' is the playback terminal; the store terminal is onEnded.
          if (next === 'ended')
            return
          phase.value = next
          if (next === 'playing' && !firstPlaybackAt) {
            firstPlaybackAt = Date.now()
            log(session, `first playback (${firstPlaybackAt})`)
          }
          log(session, `speech:progress ${next}`)
        },
        onEnded(reason) {
          if (sessionId !== session)
            return
          endSession(session, reason)
          resolve(true)
        },
        onError(error) {
          if (sessionId !== session)
            return
          log(session, `speech:error ${error.message}`)
        },
      })

      // No playback implementation can consume this descriptor → fall back.
      if (!playback) {
        resolve(false)
        return
      }

      activePlayback = playback
      playback.start()
      const element = playback.getAudioElement()
      if (element)
        attachActivity(element)

      void capability.stream({ text }, {
        onStart() {
          if (sessionId !== session)
            return
          log(session, 'provider started')
        },
        onAudio(chunk) {
          if (sessionId !== session)
            return
          if (!firstChunkAt) {
            firstChunkAt = Date.now()
            log(session, `first audio chunk (${firstChunkAt})`)
          }
          activePlayback?.enqueue(chunk)
        },
        onEnd() {
          if (sessionId !== session)
            return
          log(session, `provider finished (${Date.now()})`)
          activePlayback?.complete()
        },
        onError(error) {
          if (sessionId !== session)
            return
          log(session, `provider error: ${error.message}`)
          endSession(session, 'error')
          resolve(true)
        },
      }).catch((error: unknown) => {
        if (sessionId !== session)
          return
        const message = error instanceof Error ? error.message : String(error)
        log(session, `provider error: ${message}`)
        endSession(session, 'error')
        resolve(true)
      })
    })
  }

  async function runOneshot(session: string, provider: SpeechProvider, text: string): Promise<void> {
    if (provider.speaksDirectly) {
      // Native speech (speechSynthesis): the audible period is the synthesize
      // call itself and there is no audio element to analyse.
      phase.value = 'playing'
      await provider.synthesize({ text })
      if (sessionId !== session)
        return
      endSession(session, 'completed')
      return
    }

    const result = await provider.synthesize({ text })
    if (sessionId !== session)
      return

    if (result.audio) {
      phase.value = 'playing'
      await playSpeechResult(result.audio, {
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
    disposeActivePlayback()
    stopPlayback()
    sessionId = ''
    phase.value = 'idle'
  }

  return { speaking, phase, speak, stop, readLevel }
})
