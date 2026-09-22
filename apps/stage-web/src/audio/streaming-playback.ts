/**
 * Streaming playback boundary.
 *
 * Playback is a separate layer from the Speech Runtime: it declares which
 * `SpeechStreamDescriptor`s it can consume and hands back a playback controller.
 * The Speech Runtime never inspects codecs (audio/mpeg, MediaSource, …) — it
 * only asks this layer "can you play this descriptor?".
 *
 * The one concrete implementation today is a MediaSource + SourceBuffer player
 * for encoded byte streams (MP3). It owns exactly one HTMLAudioElement, appends
 * incoming bytes strictly in order (SourceBuffer.updateend gates the next
 * appendBuffer), and knows nothing about Alibaba, DashScope, CharacterOutput or
 * the conversation.
 */

import type { SpeechStreamDescriptor } from '@aisling/core'

export type PlaybackPhase = 'buffering' | 'playing' | 'draining' | 'ended' | 'error'

export interface StreamingPlaybackDeps {
  createMediaSource(): MediaSource
  createAudio(): HTMLAudioElement
  createObjectURL(obj: Blob | MediaSource): string
  revokeObjectURL(url: string): void
}

export interface StreamingPlaybackCallbacks {
  onPhase?(phase: PlaybackPhase): void
  /** The single terminal event. `reason` is 'completed' only after real playback drained. */
  onEnded?(reason: 'completed' | 'error'): void
  onError?(error: Error): void
}

export interface StreamingPlayback {
  enqueue(chunk: Uint8Array): void
  /** Marks that the provider finished producing audio (not the same as playback finished). */
  complete(): void
  start(): void
  /** Idempotent; safe to call more than once. */
  dispose(): void
  /** The audio element (available after `start()`), for audio analysis. */
  getAudioElement(): HTMLAudioElement | undefined
  readonly phase: PlaybackPhase
  readonly startedAt: number
}

function defaultDeps(): StreamingPlaybackDeps {
  return {
    createMediaSource: () => new MediaSource(),
    createAudio: () => new Audio(),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  }
}

function isMediaSourceTypeSupported(mimeType: string): boolean {
  return typeof MediaSource !== 'undefined'
    && typeof MediaSource.isTypeSupported === 'function'
    && MediaSource.isTypeSupported(mimeType)
}

/** The concrete MSE player for an encoded byte stream (e.g. MP3). */
export function createMseStreamingPlayback(
  mimeType: string,
  callbacks: StreamingPlaybackCallbacks,
  deps: StreamingPlaybackDeps = defaultDeps(),
): StreamingPlayback {
  let phase: PlaybackPhase = 'buffering'
  let startedAt = 0
  let mediaSource: MediaSource | undefined
  let sourceBuffer: SourceBuffer | undefined
  let audio: HTMLAudioElement | undefined
  let objectUrl: string | undefined
  const queue: Uint8Array[] = []
  let providerComplete = false
  let streamEnded = false
  let ended = false
  let disposed = false

  function setPhase(next: PlaybackPhase): void {
    if (phase === next)
      return
    phase = next
    callbacks.onPhase?.(next)
  }

  function finish(reason: 'completed' | 'error', error?: Error): void {
    if (ended)
      return
    ended = true
    if (reason === 'error') {
      setPhase('error')
      callbacks.onError?.(error ?? new Error('Playback failed'))
    }
    else {
      setPhase('ended')
    }
    callbacks.onEnded?.(reason)
  }

  function flush(): void {
    if (disposed || ended || !sourceBuffer)
      return
    if (sourceBuffer.updating)
      return
    if (queue.length > 0) {
      const chunk = queue.shift()!
      try {
        sourceBuffer.appendBuffer(chunk as BufferSource)
      }
      catch (error) {
        finish('error', error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    if (providerComplete && !streamEnded && mediaSource) {
      try {
        streamEnded = true
        mediaSource.endOfStream()
        setPhase('draining')
      }
      catch (error) {
        finish('error', error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  function onUpdateEnd(): void {
    flush()
  }

  function onSourceBufferError(): void {
    finish('error', new Error('SourceBuffer error'))
  }

  function onSourceOpen(): void {
    if (disposed || ended || !mediaSource)
      return
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType)
      sourceBuffer.addEventListener('updateend', onUpdateEnd)
      sourceBuffer.addEventListener('error', onSourceBufferError)
      flush()
      if (audio) {
        const playPromise = audio.play()
        if (playPromise) {
          playPromise.catch((error: unknown) => {
            if (!disposed && !ended)
              finish('error', error instanceof Error ? error : new Error('Audio playback failed'))
          })
        }
      }
    }
    catch (error) {
      finish('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  function onPlaying(): void {
    if (!ended)
      setPhase('playing')
  }

  function onAudioEnded(): void {
    finish('completed')
  }

  function onAudioError(): void {
    finish('error', new Error('Audio playback failed'))
  }

  function start(): void {
    if (disposed || startedAt)
      return
    startedAt = Date.now()
    mediaSource = deps.createMediaSource()
    mediaSource.addEventListener('sourceopen', onSourceOpen)
    audio = deps.createAudio()
    objectUrl = deps.createObjectURL(mediaSource)
    audio.src = objectUrl
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('ended', onAudioEnded)
    audio.addEventListener('error', onAudioError)
    // Chunks arriving before sourceopen simply wait in the queue.
  }

  function enqueue(chunk: Uint8Array): void {
    if (disposed || ended || providerComplete)
      return
    if (chunk.byteLength === 0)
      return
    queue.push(chunk)
    flush()
  }

  function complete(): void {
    if (disposed || ended)
      return
    providerComplete = true
    flush()
  }

  function dispose(): void {
    if (disposed)
      return
    disposed = true
    ended = true
    queue.length = 0
    if (sourceBuffer) {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd)
      sourceBuffer.removeEventListener('error', onSourceBufferError)
    }
    if (mediaSource) {
      mediaSource.removeEventListener('sourceopen', onSourceOpen)
      try {
        if (mediaSource.readyState === 'open')
          mediaSource.endOfStream()
      }
      catch { /* already ended */ }
    }
    if (audio) {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('ended', onAudioEnded)
      audio.removeEventListener('error', onAudioError)
      try {
        audio.pause()
      }
      catch { /* already stopped */ }
      audio.removeAttribute('src')
      try {
        audio.load()
      }
      catch { /* ignore */ }
    }
    if (objectUrl) {
      try {
        deps.revokeObjectURL(objectUrl)
      }
      catch { /* ignore */ }
      objectUrl = undefined
    }
    sourceBuffer = undefined
    mediaSource = undefined
    audio = undefined
  }

  return {
    enqueue,
    complete,
    start,
    dispose,
    getAudioElement: () => audio,
    get phase() {
      return phase
    },
    get startedAt() {
      return startedAt
    },
  }
}

/** A playback implementation that consumes a specific stream descriptor. */
interface PlaybackImplementation {
  readonly id: string
  supports(descriptor: SpeechStreamDescriptor): boolean
  create(
    descriptor: SpeechStreamDescriptor,
    callbacks: StreamingPlaybackCallbacks,
    deps?: StreamingPlaybackDeps,
  ): StreamingPlayback
}

/** MSE MP3: continuous encoded byte stream, audio/mpeg, and the environment supports it. */
const mseMpegImplementation: PlaybackImplementation = {
  id: 'mse-mpeg',
  supports(descriptor) {
    return descriptor.kind === 'encoded'
      && descriptor.mimeType === 'audio/mpeg'
      && isMediaSourceTypeSupported('audio/mpeg')
  },
  create(descriptor, callbacks, deps) {
    return createMseStreamingPlayback(descriptor.mimeType ?? 'audio/mpeg', callbacks, deps)
  },
}

// Adding a future playback (e.g. PCM WebAudio) = append one entry here. The
// Speech Runtime's control flow stays unchanged.
const implementations: readonly PlaybackImplementation[] = [mseMpegImplementation]

export function supportsStreamingPlayback(descriptor: SpeechStreamDescriptor): boolean {
  return implementations.some(impl => impl.supports(descriptor))
}

/** Returns a playback controller, or `undefined` when no implementation supports the descriptor. */
export function createStreamingPlayback(
  descriptor: SpeechStreamDescriptor,
  callbacks: StreamingPlaybackCallbacks,
  deps?: StreamingPlaybackDeps,
): StreamingPlayback | undefined {
  const impl = implementations.find(item => item.supports(descriptor))
  return impl ? impl.create(descriptor, callbacks, deps) : undefined
}
