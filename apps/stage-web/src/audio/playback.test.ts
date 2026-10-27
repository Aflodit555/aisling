import { afterEach, expect, it, vi } from 'vitest'
import { playSpeechResult, stopPlayback } from './playback'

afterEach(() => { stopPlayback(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('stops old one-shot audio immediately, settles its promise and releases its object URL', async () => {
  const elements: Array<{ pause: ReturnType<typeof vi.fn>; onended?: () => void; onplaying?: () => void }> = []
  vi.stubGlobal('Audio', class {
    pause = vi.fn(); play = vi.fn(async () => {})
    constructor() { elements.push(this) }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const playing = vi.fn()
  const first = playSpeechResult({ kind: 'bytes', data: new ArrayBuffer(3), mimeType: 'audio/mpeg' }, { onPlaying: playing })
  elements[0]!.onplaying?.(); expect(playing).toHaveBeenCalledOnce()
  const second = playSpeechResult({ kind: 'url', url: 'https://example.invalid/audio' })
  await first
  expect(elements[0]!.pause).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce()
  stopPlayback(); await second
  expect(elements[1]!.pause).toHaveBeenCalledOnce()
  stopPlayback(); expect(revoke).toHaveBeenCalledOnce()
})
