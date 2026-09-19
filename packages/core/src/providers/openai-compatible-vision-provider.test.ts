import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleVisionProvider } from './openai-compatible-vision-provider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('openai-compatible vision provider', () => {
  it('sends the image as a data URL and returns the observation', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return jsonResponse({ choices: [{ message: { content: 'a cat on a windowsill' } }] })
    }

    const provider = createOpenAICompatibleVisionProvider({
      baseUrl: 'https://x/v1/',
      apiKey: 'k',
      model: 'gpt-4o-mini',
      fetchImpl,
    })

    const result = await provider.analyze({ image: { data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/png' } })

    expect(result.text).toBe('a cat on a windowsill')
    expect(capturedUrl).toBe('https://x/v1/chat/completions')

    const body = JSON.parse(capturedInit?.body as string) as {
      model: string
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>
    }
    expect(body.model).toBe('gpt-4o-mini')
    const content = body.messages[0]?.content
    expect(content?.[0]?.type).toBe('text')
    expect(content?.[1]?.type).toBe('image_url')
    expect(content?.[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('surfaces an auth failure', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: { message: 'bad key' } }, 401)
    const provider = createOpenAICompatibleVisionProvider({
      baseUrl: 'https://x/v1',
      apiKey: 'bad',
      model: 'm',
      fetchImpl,
    })

    await expect(provider.analyze({ image: { data: new ArrayBuffer(0), mimeType: 'image/png' } }))
      .rejects.toThrow(/401/)
  })
})
