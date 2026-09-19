import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleProvider, testOpenAICompatibleConnection } from './openai-compatible-provider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Captured {
  url: string
  init: RequestInit | undefined
}

async function captureFetch(reply: () => Response): Promise<{ fetchImpl: typeof fetch; captured: Captured }> {
  const captured: Captured = { url: '', init: undefined }
  const fetchImpl: typeof fetch = async (input, init) => {
    captured.url = String(input)
    captured.init = init
    return reply()
  }
  return { fetchImpl, captured }
}

describe('openai-compatible provider', () => {
  it('posts a chat completion and returns the reply text', async () => {
    const { fetchImpl, captured } = await captureFetch(() => jsonResponse({
      choices: [{ message: { content: 'hi there' } }],
    }))
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-key',
      model: 'gpt-x',
      fetchImpl,
    })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(result.text).toBe('hi there')
    expect(captured.url).toBe('https://api.example.com/v1/chat/completions')

    const headers = captured.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-key')

    const body = JSON.parse(captured.init?.body as string) as { model: string; messages: unknown[] }
    expect(body.model).toBe('gpt-x')
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('surfaces a friendly 401 error', async () => {
    const { fetchImpl } = await captureFetch(() => jsonResponse({ error: { message: 'bad key' } }, 401))
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x/v1',
      apiKey: 'bad',
      model: 'm',
      fetchImpl,
    })

    await expect(provider.complete({ messages: [] })).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('Authentication failed'),
    })
  })

  it('reports connection success and failure', async () => {
    const ok = await captureFetch(() => jsonResponse({ choices: [{ message: { content: 'pong' } }] }))
    await expect(testOpenAICompatibleConnection({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: ok.fetchImpl,
    })).resolves.toEqual({ ok: true })

    const failed = await captureFetch(() => jsonResponse({ error: { message: 'nope' } }, 401))
    const result = await testOpenAICompatibleConnection({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: failed.fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })
})
