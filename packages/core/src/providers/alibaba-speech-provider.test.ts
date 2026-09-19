import { describe, expect, it } from 'vitest'

import {
  buildFinishTaskMessage,
  buildRunTaskMessage,
  createAlibabaSpeechProvider,
  pcmToWav,
  type WebSocketLike,
} from './alibaba-speech-provider'

class StubWebSocket implements WebSocketLike {
  binaryType: string | undefined
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}
}

function makeStub(): { ws: StubWebSocket; factory: (url: string) => WebSocketLike; url: () => string } {
  let openedUrl = ''
  const ws = new StubWebSocket()
  return {
    ws,
    factory: (url: string) => {
      openedUrl = url
      return ws
    },
    url: () => openedUrl,
  }
}

describe('alibaba (DashScope) speech provider', () => {
  it('builds the run-task and finish-task messages', () => {
    const run = buildRunTaskMessage('hi', { taskId: 't1', model: 'qwen-audio-3.0-tts-flash', voice: 'Cherry', sampleRate: 24000 })
    expect(run).toMatchObject({
      header: { action: 'run-task', task_id: 't1', streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: 'qwen-audio-3.0-tts-flash',
        input: { text: 'hi' },
      },
    })

    const finish = buildFinishTaskMessage('t1')
    expect(finish).toEqual({ header: { action: 'finish-task', task_id: 't1' }, payload: { input: { directive: 'finish' } } })
  })

  it('wraps PCM as a WAV container', () => {
    const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]), 24000)
    const bytes = new Uint8Array(wav)
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('RIFF')
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('WAVE')
    expect(bytes.length).toBe(44 + 4)
  })

  it('collects binary PCM and resolves a WAV', async () => {
    const stub = makeStub()
    const provider = createAlibabaSpeechProvider({
      apiKey: 'k',
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'Cherry',
      WebSocketImpl: stub.factory,
    })

    const pending = provider.synthesize({ text: 'hello' })

    expect(stub.url()).toContain('model=qwen-audio-3.0-tts-flash')
    stub.ws.onopen?.({})
    expect(stub.ws.sent[0]).toContain('"action":"run-task"')

    stub.ws.onmessage?.({ data: new Uint8Array([9, 9, 9, 9]).buffer })
    stub.ws.onmessage?.({ data: JSON.stringify({ header: { event: 'task-finished' } }) })

    const result = await pending
    expect(result.audio?.kind).toBe('bytes')
    if (result.audio?.kind === 'bytes') {
      expect(result.audio.mimeType).toBe('audio/wav')
      expect(new Uint8Array(result.audio.data).slice(0, 4).join(',')).toBe('82,73,70,70')
    }
    expect(stub.ws.sent.some(message => message.includes('finish-task'))).toBe(true)
  })

  it('rejects on task-failed', async () => {
    const stub = makeStub()
    const provider = createAlibabaSpeechProvider({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      WebSocketImpl: stub.factory,
    })

    const pending = provider.synthesize({ text: 'hi' })
    stub.ws.onopen?.({})
    stub.ws.onmessage?.({ data: JSON.stringify({ header: { event: 'task-failed' }, payload: { message: 'bad voice' } }) })

    await expect(pending).rejects.toThrow('bad voice')
  })
})
