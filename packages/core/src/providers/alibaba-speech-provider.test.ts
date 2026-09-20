import { describe, expect, it } from 'vitest'

import {
  buildContinueTaskMessage,
  buildFinishTaskMessage,
  buildRunTaskMessage,
  createAlibabaSpeechProvider,
  pcmToWav,
} from './alibaba-speech-provider'

describe('alibaba (DashScope) speech provider', () => {
  it('builds the official duplex task messages', () => {
    const run = buildRunTaskMessage({
      taskId: 't1',
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'longanhuan_v3.6',
      sampleRate: 22050,
    })
    expect(run).toMatchObject({
      header: { action: 'run-task', task_id: 't1', streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: 'qwen-audio-3.0-tts-flash',
        parameters: { format: 'mp3', sample_rate: 22050, voice: 'longanhuan_v3.6' },
        input: {},
      },
    })

    expect(buildContinueTaskMessage('t1', 'hi')).toEqual({
      header: { action: 'continue-task', task_id: 't1', streaming: 'duplex' },
      payload: { input: { text: 'hi' } },
    })
    expect(buildFinishTaskMessage('t1')).toEqual({
      header: { action: 'finish-task', task_id: 't1', streaming: 'duplex' },
      payload: { input: {} },
    })
  })

  it('wraps PCM as a WAV container', () => {
    const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]), 24000)
    const bytes = new Uint8Array(wav)
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('RIFF')
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('WAVE')
    expect(bytes.length).toBe(48)
  })

  it('sends the selected upstream transport through the relay and returns audio', async () => {
    let sentBody: Record<string, unknown> | undefined
    const provider = createAlibabaSpeechProvider({
      apiKey: 'k',
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'longanhuan_v3.6',
      endpoint: 'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
      transport: 'websocket',
      fetchImpl: async (_url, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ audio: { base64: 'SUQz', mimeType: 'audio/mpeg' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    const result = await provider.synthesize({ text: 'hello' })
    expect(sentBody).toMatchObject({ transport: 'websocket', text: 'hello' })
    expect(result.audio?.kind).toBe('bytes')
    if (result.audio?.kind === 'bytes') {
      expect(result.audio.mimeType).toBe('audio/mpeg')
      expect(new Uint8Array(result.audio.data).join(',')).toBe('73,68,51')
    }
  })

  it('surfaces classified relay errors', async () => {
    const provider = createAlibabaSpeechProvider({
      apiKey: 'k',
      model: 'm',
      voice: 'v',
      endpoint: 'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Alibaba TTS authentication failed (HTTP 401).' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    await expect(provider.synthesize({ text: 'hi' })).rejects.toThrow('authentication failed')
  })
})
