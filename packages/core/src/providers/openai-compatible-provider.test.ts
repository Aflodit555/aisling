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
      temperature: 0.9,
      fetchImpl,
    })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(result.text).toBe('hi there')
    expect(captured.url).toBe('https://api.example.com/v1/chat/completions')

    const headers = captured.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-key')

    const body = JSON.parse(captured.init?.body as string) as { model: string; messages: unknown[]; temperature: number }
    expect(body.model).toBe('gpt-x')
    expect(body.temperature).toBe(0.9)
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

  it('forwards a 1.1 temperature unchanged', async () => {
    const { fetchImpl, captured } = await captureFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', temperature: 1.1, fetchImpl })
    await provider.complete({ messages: [] })
    expect(JSON.parse(captured.init?.body as string).temperature).toBe(1.1)
  })

  it('shows streamed text before the response finishes and joins split events', async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'))
        await held
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"好"}}]}\n'))
        controller.enqueue(encoder.encode('\n' + 'data: [DONE]\n\n'))
        controller.close()
      },
    })
    const { fetchImpl, captured } = await captureFetch(() => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl })
    const updates: string[] = []
    let first!: () => void
    const firstText = new Promise<void>(resolve => { first = resolve })
    const result = provider.stream!({ messages: [{ role: 'user', content: 'hi' }] }, text => {
      updates.push(text)
      first()
    })

    await firstText
    expect(updates).toEqual(['你'])
    expect(JSON.parse(captured.init?.body as string).stream).toBe(true)
    release()
    await expect(result).resolves.toEqual({ text: '你好' })
    expect(updates).toEqual(['你', '你好'])
  })

  it('reassembles tool calls from streamed argument fragments', async () => {
    const events = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'web_search', arguments: '{"query":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Aisling"}' } }] } }] },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    const { fetchImpl } = await captureFetch(() => new Response(events, { headers: { 'Content-Type': 'text/event-stream' } }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl })
    await expect(provider.stream!({ messages: [] }, () => {})).resolves.toEqual({
      text: '',
      toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"query":"Aisling"}' }],
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
