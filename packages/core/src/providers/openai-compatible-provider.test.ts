import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequestTiming } from '../provider'

import { createOpenAICompatibleProvider } from './openai-compatible-provider'

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
  afterEach(() => vi.useRealTimers())

  it('times headers separately from unchanged response.json processing', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const records: ChatRequestTiming[] = []
    let headers!: (r: Response) => void, body!: (v: unknown) => void
    const json = vi.fn(() => new Promise(resolve => { body = resolve }))
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { headers = resolve }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'Private key', model: 'mock', fetchImpl })
    const running = provider.complete({ messages: [], onTiming: r => records.push(r) })
    expect(records.map(r => r.event)).toEqual(['provider-enter', 'fetch-start'])
    vi.setSystemTime(1100)
    headers({ ok: true, status: 200, json } as unknown as Response)
    await Promise.resolve(); await Promise.resolve()
    expect(records.at(-1)).toMatchObject({ event: 'response-json-start', stage: 'response-json', httpStatus: 200, at: 1100 })
    vi.setSystemTime(1400); body({ choices: [{ message: { content: 'Private model response' } }] })
    expect((await running).text).toBe('Private model response')
    expect(records.find(r => r.event === 'response-json-end')?.at).toBe(1400)
    expect(records.at(-1)).toMatchObject({ event: 'result-ready', stage: 'response-shape' })
    expect(json).toHaveBeenCalledOnce(); expect(fetchImpl).toHaveBeenCalledOnce()
    expect(JSON.stringify(records)).not.toContain('Private')
  })

  it.each(['fetch', 'response-json'] as const)('records cancellation during %s without calling it model generation timeout', async stage => {
    const records: ChatRequestTiming[] = [], controller = new AbortController()
    let reject!: (e: Error) => void
    const held = new Promise<never>((_, r) => { reject = r })
    const fetchImpl = vi.fn(async () => stage === 'fetch' ? held : { ok: true, status: 200, json: () => held } as unknown as Response)
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', fetchImpl })
    const running = provider.complete({ messages: [], signal: controller.signal, onTiming: r => records.push(r) })
    const failed = expect(running).rejects.toThrow()
    for (let n = 0; n < 6; n++) await Promise.resolve()
    controller.abort(); reject(new DOMException('Mock abort', 'AbortError')); await failed
    expect(records.find(r => r.event === 'aborted')).toMatchObject({ stage, abortRequested: true })
    expect(records.at(-1)).toMatchObject({ event: 'failed', stage,
      errorKind: stage === 'fetch' ? 'fetch-error' : 'response-json-error' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each(['network', 'http', 'json'] as const)('keeps %s errors and records their actual request stage', async failure => {
    const records: ChatRequestTiming[] = []
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', fetchImpl: async () => {
      if (failure === 'network') throw new TypeError('Private network error')
      return failure === 'http' ? jsonResponse({ error: { message: 'Private server error' } }, 429) : new Response('{invalid', { status: 200 })
    } })
    await expect(provider.complete({ messages: [], onTiming: r => records.push(r) })).rejects.toThrow()
    expect(records.at(-1)).toMatchObject({ event: 'failed', errorKind: failure === 'network' ? 'fetch-error' : failure === 'http' ? 'http-error' : 'response-json-error', abortRequested: false })
    if (failure === 'http') expect(records.find(r => r.event === 'headers-received')).toMatchObject({ httpStatus: 429 })
    if (failure === 'json') expect(records.some(r => r.event === 'response-json-failed')).toBe(true)
    expect(JSON.stringify(records)).not.toContain('Private')
  })

  it('optional timing never changes the wire body, response or call count, even if the sink throws', async () => {
    const bodies: string[] = []
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(init!.body as string); return jsonResponse({ choices: [{ message: { content: 'ok' } }] }) })
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', temperature: 1.2, fetchImpl })
    for (const onTiming of [undefined, () => { throw new Error('sink') }]) {
      expect(await provider.complete({ messages: [], maxOutputTokens: 1200, onTiming })).toEqual({ text: 'ok' })
    }
    expect(bodies[0]).toBe(bodies[1]); expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(bodies[1]!)).toEqual({ model: 'm', messages: [], stream: false, temperature: 1.2, max_completion_tokens: 1200 })
  })
  it('forwards optional background limits without changing ordinary request bodies', async () => {
    const { fetchImpl, captured } = await captureFetch(() => jsonResponse({ choices: [{ message: { content: '{}' } }] }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://example.com/v1', apiKey: 'mock', model: 'mock', fetchImpl })
    const controller = new AbortController()
    await provider.complete({ messages: [], signal: controller.signal, maxOutputTokens: 1200 })
    expect(captured.init?.signal).toBe(controller.signal)
    expect(JSON.parse(captured.init!.body as string).max_completion_tokens).toBe(1200)
    await provider.complete({ messages: [] })
    expect(JSON.parse(captured.init!.body as string)).toEqual({ model: 'mock', messages: [], stream: false })
    expect(captured.init?.signal).toBeUndefined()
  })
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

  it('A can override sampling per request while B retains the configured temperature', async () => {
    const { fetchImpl, captured } = await captureFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', temperature: 1.2, fetchImpl })
    await provider.complete({ messages: [], temperature: 0.2 })
    expect(JSON.parse(captured.init!.body as string).temperature).toBe(0.2)
    await provider.complete({ messages: [] })
    expect(JSON.parse(captured.init!.body as string).temperature).toBe(1.2)
  })

  it.each([false, true])('serializes enableThinking=%s at the top level for one request only', async enableThinking => {
    const { fetchImpl, captured } = await captureFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://api.ppio.com/openai', apiKey: 'MOCK_ONLY', model: 'qwen/qwen3.8-flash', temperature: 1.2, fetchImpl })
    await provider.stream!({ messages: [], maxOutputTokens: 800, temperature: 0.2, enableThinking }, () => {})
    expect(JSON.parse(captured.init!.body as string)).toEqual({ model: 'qwen/qwen3.8-flash', messages: [], stream: true,
      temperature: 0.2, max_completion_tokens: 800, enable_thinking: enableThinking })
    await provider.stream!({ messages: [] }, () => {})
    expect(JSON.parse(captured.init!.body as string)).toEqual({ model: 'qwen/qwen3.8-flash', messages: [], stream: true, temperature: 1.2 })
  })

  it('distinguishes early headers, first content text and a fully collected stream', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const records: ChatRequestTiming[] = [], updates: string[] = []
    let feed!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', fetchImpl: async () =>
      new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }) })
    const running = provider.stream!({ messages: [], onTiming: r => records.push(r) }, text => updates.push(text))
    for (let n = 0; n < 6; n++) await Promise.resolve()
    expect(records.at(-1)).toMatchObject({ event: 'headers-received', at: 1000 })
    vi.setSystemTime(1200)
    feed.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"claims\\":"}}]}\n\n'))
    for (let n = 0; n < 6; n++) await Promise.resolve()
    expect(records.at(-1)).toMatchObject({ event: 'first-text', stage: 'stream', at: 1200 })
    expect(records.some(r => r.event === 'result-ready')).toBe(false)
    vi.setSystemTime(1800)
    feed.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"[]}"}}]}\n\ndata: [DONE]\n\n')); feed.close()
    expect(await running).toEqual({ text: '{"claims":[]}' })
    expect(records.find(r => r.event === 'stream-end')).toMatchObject({ at: 1800 })
    expect(records.at(-1)).toMatchObject({ event: 'result-ready', at: 1800 })
    expect(records.filter(r => r.event === 'first-text')).toHaveLength(1)
    expect(JSON.stringify(records)).not.toContain('claims')
  })

  it('records cancellation while reading a stream and never turns it into a completed response', async () => {
    const records: ChatRequestTiming[] = [], abort = new AbortController()
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', fetchImpl: async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(new DOMException('Mock abort', 'AbortError')), { once: true })
      } })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    const running = provider.stream!({ messages: [], signal: abort.signal, onTiming: r => records.push(r) }, () => {})
    const failed = expect(running).rejects.toThrow('Mock abort')
    for (let n = 0; n < 6; n++) await Promise.resolve()
    abort.abort(); await failed
    expect(records.find(r => r.event === 'aborted')).toMatchObject({ stage: 'stream', abortRequested: true })
    expect(records.some(r => r.event === 'result-ready' || r.event === 'stream-end')).toBe(false)
  })

  it('reports malformed SSE as a stream error, not an HTTP rejection after status 200', async () => {
    const records: ChatRequestTiming[] = []
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm', fetchImpl: async () =>
      new Response('data: invalid-json\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) })
    await expect(provider.stream!({ messages: [], onTiming: r => records.push(r) }, () => {})).rejects.toThrow('invalid stream event')
    expect(records.at(-1)).toMatchObject({ stage: 'stream', httpStatus: 200, errorKind: 'stream-error' })
  })

  it('finishes on the provider DONE marker without waiting for a held HTTP body', async () => {
    let cancelCount = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')) },
      cancel() { cancelCount++ },
    })
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm',
      fetchImpl: async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }) })
    let settled = false
    const running = provider.stream!({ messages: [] }, () => {}).then(r => { settled = true; return r })
    for (let n = 0; n < 20; n++) await Promise.resolve()
    expect(settled).toBe(true)
    expect(await running).toEqual({ text: '{}' }); expect(cancelCount).toBe(1)
  })

  it.each([false, true])('cancels a malformed held SSE body with diagnostics enabled=%s', async enabled => {
    const cancel = vi.fn(), records: ChatRequestTiming[] = []
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: invalid-json\n\n')) }, cancel,
    })
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'MOCK_ONLY', model: 'mock',
      fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) })
    await expect(provider.stream!({ messages: [], onTiming: enabled ? r => records.push(r) : undefined }, () => {}))
      .rejects.toThrow('invalid stream event')
    expect(cancel).toHaveBeenCalledOnce()
    if (enabled) expect(records.at(-1)).toMatchObject({ event: 'failed', errorKind: 'stream-error' })
    else expect(records).toEqual([])
  })

  it('counts reasoning separately, preserves content fragments, and retains terminal length without a delta', async () => {
    const events = [
      { choices: [{ delta: { reasoning_content: 'Private reasoning', content: null } }] },
      { choices: [{ delta: { content: '{"ok":' } }] },
      { choices: [{ delta: { content: 'true}' } }] },
      { choices: [{ finish_reason: 'length' }] },
      { choices: [], usage: { completion_tokens: 800 } },
    ]
    const payload = events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
    const records: ChatRequestTiming[] = [], updates: string[] = []
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm',
      fetchImpl: async () => new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } }) })
    expect(await provider.stream!({ messages: [], onTiming: r => records.push(r) }, t => updates.push(t))).toEqual({ text: '{"ok":true}' })
    expect(updates).toEqual(['{"ok":', '{"ok":true}'])
    expect(records.at(-1)).toMatchObject({ contentChars: 11, reasoningChars: 17, contentDeltaCount: 2,
      reasoningDeltaCount: 1, streamEventCount: 5, finishReason: 'length', doneReceived: true, unsupportedContent: false })
    expect(JSON.stringify(records)).not.toContain('Private reasoning')
    expect(JSON.stringify(records)).not.toContain('"ok"')
  })

  it('reasoning-only streams return empty content, never expose thinking as final text', async () => {
    const records: ChatRequestTiming[] = [], onText = vi.fn()
    const payload = 'data: {"choices":[{"delta":{"reasoning_content":"Private thinking","content":null}}]}\n\n'
      + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm',
      fetchImpl: async () => new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } }) })
    expect(await provider.stream!({ messages: [], onTiming: r => records.push(r) }, onText)).toEqual({ text: '' })
    expect(onText).not.toHaveBeenCalled(); expect(records.some(r => r.event === 'first-text')).toBe(false)
    expect(records.at(-1)).toMatchObject({ contentChars: 0, reasoningChars: 16, finishReason: 'length', doneReceived: true })
    expect(JSON.stringify(records)).not.toContain('Private thinking')
  })

  it('normalizes unknown finish reasons and counts unsupported content without logging its value', async () => {
    const records: ChatRequestTiming[] = []
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'k', model: 'm',
      fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":{"text":"Private output"}},"finish_reason":"Private finish"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) })
    expect(await provider.stream!({ messages: [], onTiming: r => records.push(r) }, () => {})).toEqual({ text: '' })
    expect(records.at(-1)).toMatchObject({ contentChars: 0, unsupportedContent: true, finishReason: 'other', doneReceived: false })
    expect(JSON.stringify(records)).not.toContain('Private')
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

})
