import type { SpeechRequest, SpeechStreamSink } from '@aisling/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import type { StreamingPlaybackCallbacks } from '../audio/streaming-playback'
import { createStreamingPlayback } from '../audio/streaming-playback'
import { useSettingsStore } from './settings'
import { useSpeechStore } from './speech'

vi.mock('../audio/streaming-playback', () => ({ createStreamingPlayback: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem() {} } })
  setActivePinia(createPinia())
  const settings = useSettingsStore(), speech = useSpeechStore()
  return { settings, speech }
}

it('waits for actual native start, aborts replaced speech, and ignores its late completion', async () => {
  const { settings, speech } = fixture()
  const pending: Array<{ request: SpeechRequest; finish: () => void }> = []
  settings.activeSpeechProvider = { id: 'native', speaksDirectly: true,
    synthesize: request => new Promise(resolve => pending.push({ request, finish: () => resolve({ spoken: true }) })) }
  const first = speech.speak('你好，hello。'); expect(speech.speaking).toBe(false)
  pending[0]!.request.onStart?.(); expect(speech.speaking).toBe(true)
  const second = speech.speak('下一句 English!')
  expect(pending[0]!.request.signal?.aborted).toBe(true)
  pending[0]!.finish(); await first
  expect(speech.phase).toBe('buffering')
  pending[1]!.request.onStart?.(); expect(speech.speaking).toBe(true)
  pending[1]!.finish(); await second; expect(speech.phase).toBe('idle')
})

it('settles cancelled streaming, suppresses late chunks, and drains a new multi-chunk reply once', async () => {
  const { settings, speech } = fixture()
  const callbacks: StreamingPlaybackCallbacks[] = []
  const players: Array<{ enqueue: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
  vi.mocked(createStreamingPlayback).mockImplementation((_descriptor, hooks) => {
    callbacks.push(hooks)
    const player = { start: vi.fn(), enqueue: vi.fn(), complete: vi.fn(), dispose: vi.fn(), getAudioElement: () => undefined,
      phase: 'buffering' as const, startedAt: 1 }
    players.push(player); return player
  })
  const streams: Array<{ request: SpeechRequest; sink: SpeechStreamSink }> = []
  const synthesize = vi.fn()
  settings.activeSpeechProvider = { id: 'stream', synthesize, stream: { descriptor: { kind: 'encoded', mimeType: 'audio/mpeg' },
    stream: async (request, sink) => { streams.push({ request, sink }) } } }
  const first = speech.speak('旧回复'); speech.stop(); await first
  expect(streams[0]!.request.signal?.aborted).toBe(true)
  const second = speech.speak('新回复，中英 mixed，标点！'.repeat(30))
  streams[0]!.sink.onAudio?.(new Uint8Array([9])); streams[0]!.sink.onEnd?.()
  for (const n of [1, 2, 3]) streams[1]!.sink.onAudio?.(new Uint8Array([n]))
  expect(players[1]!.enqueue).toHaveBeenCalledTimes(3)
  callbacks[1]!.onPhase?.('playing'); expect(speech.speaking).toBe(true)
  callbacks[1]!.onPhase?.('buffering'); expect(speech.speaking).toBe(false)
  callbacks[1]!.onPhase?.('playing')
  streams[1]!.sink.onEnd?.(); expect(speech.speaking).toBe(true)
  expect(players[1]!.complete).toHaveBeenCalledOnce()
  callbacks[1]!.onEnded?.('completed'); await second
  expect(speech.phase).toBe('idle'); expect(synthesize).not.toHaveBeenCalled()
  expect(players[0]!.dispose).toHaveBeenCalledOnce()
  callbacks[1]!.onEnded?.('completed')
  expect(players[1]!.dispose).toHaveBeenCalledOnce()
})

it('does not start a stale one-shot fallback after replacement and exposes an error phase', async () => {
  const { settings, speech } = fixture()
  vi.mocked(createStreamingPlayback).mockReturnValue(undefined)
  const synthesize = vi.fn(async () => { throw new Error('synthesis failed') })
  settings.activeSpeechProvider = { id: 'fallback', synthesize, stream: {
    descriptor: { kind: 'pcm' }, stream: vi.fn() } }
  const old = speech.speak('old'); const current = speech.speak('current')
  await Promise.all([old, current])
  expect(synthesize).toHaveBeenCalledOnce()
  expect(synthesize.mock.calls[0]).toBeDefined()
  expect(speech.phase).toBe('error')
  speech.stop(); expect(speech.phase).toBe('idle')
})
