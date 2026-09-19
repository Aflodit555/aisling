import { describe, expect, it } from 'vitest'

import {
  createOpenAICompatibleTranscriptionProvider,
  normalizeTranscriptionText,
} from './openai-compatible-transcription-provider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('openai-compatible transcription provider', () => {
  it('posts multipart audio and returns the transcript', async () => {
    let capturedBody: FormData | undefined
    let capturedUrl = ''
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input)
      capturedBody = init?.body as FormData
      return jsonResponse({ text: 'hello there' })
    }

    const provider = createOpenAICompatibleTranscriptionProvider({
      baseUrl: 'https://x/v1/',
      apiKey: 'sk',
      model: 'whisper-1',
      fetchImpl,
    })

    const result = await provider.recognize({ audio: { data: new ArrayBuffer(4), mimeType: 'audio/wav' } })

    expect(result.text).toBe('hello there')
    expect(capturedUrl).toBe('https://x/v1/audio/transcriptions')
    expect(capturedBody?.get('model')).toBe('whisper-1')
    expect(capturedBody?.get('file')).toBeTruthy()
  })

  it('surfaces an auth failure', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: { message: 'bad key' } }, 401)
    const provider = createOpenAICompatibleTranscriptionProvider({
      baseUrl: 'https://x/v1',
      apiKey: 'bad',
      model: 'whisper-1',
      fetchImpl,
    })

    await expect(provider.recognize({ audio: { data: new ArrayBuffer(0), mimeType: 'audio/wav' } }))
      .rejects.toThrow(/401/)
  })

  it('normalizes OpenAI-compatible text variants', () => {
    expect(normalizeTranscriptionText({ text: 'a' })).toBe('a')
    expect(normalizeTranscriptionText({ result: { text: 'b' } })).toBe('b')
    expect(normalizeTranscriptionText({ output: { text: 'c' } })).toBe('c')
    expect(normalizeTranscriptionText({ segments: [{ text: 'd' }, { text: 'e' }] })).toBe('de')
    expect(normalizeTranscriptionText({})).toBe('')
  })
})
