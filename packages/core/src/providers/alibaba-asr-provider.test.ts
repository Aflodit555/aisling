import { describe, expect, it } from 'vitest'

import { createAlibabaAsrProvider, extractAsrText } from './alibaba-asr-provider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('alibaba (DashScope) ASR provider', () => {
  it('builds the direct request with an input_audio Data URI and parses the transcript', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return jsonResponse({ output: { choices: [{ message: { content: [{ text: '你好' }] } }] } })
    }

    const provider = createAlibabaAsrProvider({
      endpoint: 'https://x.cn-beijing.maas.aliyuncs.com/api/v1',
      apiKey: 'k',
      model: 'qwen-audio-3.0-asr-flash',
      transport: 'direct',
      fetchImpl,
    })

    const result = await provider.recognize({ audio: { data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'audio/webm' } })

    expect(result.text).toBe('你好')
    expect(capturedUrl).toBe('https://x.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')

    const body = JSON.parse(capturedInit?.body as string) as {
      model: string
      input: { messages: Array<{ role: string; content: Array<{ type: string; input_audio?: { data: string } }> }> }
    }
    expect(body.model).toBe('qwen-audio-3.0-asr-flash')
    const content = body.input.messages[0]?.content
    const audioData = content?.find(part => part.type === 'input_audio')?.input_audio?.data
    expect(audioData).toMatch(/^data:audio\/webm;base64,/)
  })

  it('normalizes the transcript from response variants', () => {
    expect(extractAsrText({ output: { choices: [{ message: { content: [{ text: 'a' }] } }] } })).toBe('a')
    expect(extractAsrText({ output: { choices: [{ message: { content: 'b' } }] } })).toBe('b')
    expect(extractAsrText({ output: { text: 'c' } })).toBe('c')
    expect(extractAsrText({ text: 'd' })).toBe('d')
    expect(extractAsrText({})).toBe('')
  })

  it('relay transport posts JSON and parses the transcript', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const fetchImpl: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ text: 'heard' })
    }

    const provider = createAlibabaAsrProvider({
      endpoint: 'https://x/api/v1',
      apiKey: 'k',
      model: 'qwen-audio-3.0-asr-flash',
      transport: 'relay',
      relayUrl: '/api/relay/alibaba-asr',
      fetchImpl,
    })

    const result = await provider.recognize({ audio: { data: new ArrayBuffer(4), mimeType: 'audio/webm' } })

    expect(result.text).toBe('heard')
    expect(capturedBody?.model).toBe('qwen-audio-3.0-asr-flash')
    expect(capturedBody?.audioBase64).toBeTruthy()
  })

  it('surfaces a non-JSON relay response as a descriptive error', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 502 })
    const provider = createAlibabaAsrProvider({
      endpoint: 'https://x/api/v1',
      apiKey: 'k',
      model: 'm',
      transport: 'relay',
      fetchImpl,
    })

    await expect(provider.recognize({ audio: { data: new ArrayBuffer(4), mimeType: 'audio/webm' } }))
      .rejects.toThrow(/non-JSON response/)
  })
})
