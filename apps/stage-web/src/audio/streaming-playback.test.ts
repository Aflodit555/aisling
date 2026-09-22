import type { SpeechStreamDescriptor } from '@aisling/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMseStreamingPlayback,
  createStreamingPlayback,
  supportsStreamingPlayback,
  type PlaybackPhase,
  type StreamingPlaybackDeps,
} from './streaming-playback'

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values)
const sleep = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

afterEach(() => {
  vi.unstubAllGlobals()
})

class FakeSourceBuffer {
  updating = false
  appended: Uint8Array[] = []
  private listeners = new Map<string, Array<() => void>>()

  appendBuffer(chunk: Uint8Array): void {
    if (this.updating)
      throw new Error('appendBuffer called while updating')
    this.updating = true
    this.appended.push(chunk)
    setTimeout(() => {
      this.updating = false
      this.emit('updateend')
    }, 0)
  }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter(item => item !== fn))
  }

  private emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? [])
      fn()
  }
}

class FakeMediaSource {
  readyState: 'closed' | 'open' | 'ended' = 'closed'
  sourceBuffer: FakeSourceBuffer | undefined
  private listeners = new Map<string, Array<() => void>>()

  addSourceBuffer(): FakeSourceBuffer {
    this.readyState = 'open'
    this.sourceBuffer = new FakeSourceBuffer()
    return this.sourceBuffer
  }

  endOfStream(): void {
    this.readyState = 'ended'
  }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter(item => item !== fn))
  }

  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? [])
      fn()
  }
}

class FakeAudio {
  src = ''
  played = false
  private listeners = new Map<string, Array<() => void>>()

  play(): Promise<void> {
    this.played = true
    return Promise.resolve()
  }

  pause(): void {}
  removeAttribute(): void {}
  load(): void {}

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter(item => item !== fn))
  }

  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? [])
      fn()
  }
}

function setup() {
  let mediaSource: FakeMediaSource | undefined
  let audio: FakeAudio | undefined
  const revokeObjectURL = vi.fn()
  const deps: StreamingPlaybackDeps = {
    createMediaSource: () => {
      mediaSource = new FakeMediaSource()
      return mediaSource as unknown as MediaSource
    },
    createAudio: () => {
      audio = new FakeAudio()
      return audio as unknown as HTMLAudioElement
    },
    createObjectURL: () => 'blob:fake',
    revokeObjectURL,
  }
  const phases: PlaybackPhase[] = []
  const ended: Array<'completed' | 'error'> = []
  const errors: Error[] = []
  const playback = createMseStreamingPlayback('audio/mpeg', {
    onPhase: phase => phases.push(phase),
    onEnded: reason => ended.push(reason),
    onError: error => errors.push(error),
  }, deps)
  return { playback, mediaSource: () => mediaSource!, audio: () => audio!, revokeObjectURL, phases, ended, errors }
}

describe('streaming playback queue', () => {
  it('appends chunks strictly in order and never concurrently', async () => {
    const h = setup()
    h.playback.start()

    // Chunks arriving before sourceopen stay queued.
    h.playback.enqueue(u8(1))
    h.playback.enqueue(u8(2))
    expect(h.mediaSource().sourceBuffer).toBeUndefined()

    h.mediaSource().emit('sourceopen')
    const sourceBuffer = h.mediaSource().sourceBuffer!
    // First chunk is being appended; the second is still queued, not concurrent.
    expect(sourceBuffer.appended.map(buffer => Array.from(buffer))).toEqual([[1]])
    expect(sourceBuffer.updating).toBe(true)

    // A chunk arriving while one is still appending must wait, not append concurrently.
    h.playback.enqueue(u8(3))

    await sleep()
    expect(sourceBuffer.appended.map(buffer => Array.from(buffer))).toEqual([[1], [2]])

    await sleep()
    expect(sourceBuffer.appended.map(buffer => Array.from(buffer))).toEqual([[1], [2], [3]])
  })

  it('ends the stream only after the queue is empty and playback actually drains', async () => {
    const h = setup()
    h.playback.start()
    h.playback.enqueue(u8(1))
    h.mediaSource().emit('sourceopen')

    // complete() while a chunk is still buffering must NOT endOfStream yet.
    h.playback.complete()
    expect(h.mediaSource().readyState).toBe('open')
    expect(h.ended).toEqual([])

    await sleep()
    // Queue drained → endOfStream → draining.
    expect(h.mediaSource().readyState).toBe('ended')
    expect(h.ended).toEqual([]) // still not terminal: playback has not drained

    h.audio().emit('playing')
    h.audio().emit('ended')
    expect(h.ended).toEqual(['completed'])
    expect(h.phases).toContain('playing')
    expect(h.phases).toContain('draining')
  })

  it('cleans up idempotently and suppresses terminal events after dispose', async () => {
    const h = setup()
    h.playback.start()
    h.playback.enqueue(u8(1))
    h.mediaSource().emit('sourceopen')
    h.playback.dispose()
    h.playback.dispose()
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:fake')

    // A late audio-ended must not emit a terminal event after dispose.
    h.audio().emit('ended')
    expect(h.ended).toEqual([])
  })
})

describe('playback selection by stream descriptor', () => {
  const mpeg: SpeechStreamDescriptor = { kind: 'encoded', mimeType: 'audio/mpeg' }
  const opus: SpeechStreamDescriptor = { kind: 'encoded', mimeType: 'audio/webm;codecs=opus' }
  const pcm: SpeechStreamDescriptor = { kind: 'pcm', sampleRate: 24000, channels: 1 }

  it('selects the MSE MP3 playback for a supported descriptor', () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    expect(supportsStreamingPlayback(mpeg)).toBe(true)
    expect(createStreamingPlayback(mpeg, {})).toBeDefined()
  })

  it('rejects unsupported descriptors (opus / pcm)', () => {
    expect(supportsStreamingPlayback(opus)).toBe(false)
    expect(supportsStreamingPlayback(pcm)).toBe(false)
    expect(createStreamingPlayback(opus, {})).toBeUndefined()
    expect(createStreamingPlayback(pcm, {})).toBeUndefined()
  })

  it('rejects a supported descriptor when the runtime MediaSource cannot play the MIME type', () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => false })
    expect(supportsStreamingPlayback(mpeg)).toBe(false)
    expect(createStreamingPlayback(mpeg, {})).toBeUndefined()
  })
})
