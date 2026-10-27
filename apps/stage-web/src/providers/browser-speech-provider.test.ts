import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserSpeechProvider } from './browser-speech-provider'

afterEach(() => vi.unstubAllGlobals())
it('uses real start/end events, rejects errors, and settles cancellation without engine terminal events', async () => {
  const queue: SpeechSynthesisUtterance[] = []
  const synth = { getVoices: () => [], speak: (u: SpeechSynthesisUtterance) => queue.push(u), cancel: vi.fn() }
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  const provider = createBrowserSpeechProvider(), started = vi.fn(), abort = new AbortController()
  const first = provider.synthesize({ text: '中英 mixed，第一句。第二句！', signal: abort.signal, onStart: started })
  expect(started).not.toHaveBeenCalled()
  queue[0]!.onstart?.({} as SpeechSynthesisEvent); expect(started).toHaveBeenCalledOnce()
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort(); await cancelled; expect(synth.cancel).toHaveBeenCalledOnce()
  const second = provider.synthesize({ text: '再播放。' })
  queue[1]!.onend?.({} as SpeechSynthesisEvent); await expect(second).resolves.toEqual({ spoken: true })
  const failed = provider.synthesize({ text: '错误测试' })
  queue[2]!.onerror?.({ error: 'network' } as SpeechSynthesisErrorEvent)
  await expect(failed).rejects.toThrow('network')
  const count = queue.length
  await expect(provider.synthesize({ text: 'stale', signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(queue).toHaveLength(count)
})
