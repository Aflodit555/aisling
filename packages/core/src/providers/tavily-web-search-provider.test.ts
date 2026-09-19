import { describe, expect, it } from 'vitest'

import { createTavilyWebSearchProvider } from './tavily-web-search-provider'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('tavily web search provider', () => {
  it('normalizes results into Aisling SearchResult objects', async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl: typeof fetch = async (_input, init) => {
      capturedInit = init
      return jsonResponse({
        results: [{ title: 'OpenAI', url: 'https://openai.com', content: 'an AI research org' }],
      })
    }

    const provider = createTavilyWebSearchProvider({
      apiKey: 'k',
      baseUrl: 'https://tavily.local',
      fetchImpl,
    })

    const results = await provider.search('OpenAI')

    expect(results).toEqual([
      { title: 'OpenAI', url: 'https://openai.com', snippet: 'an AI research org', source: 'tavily' },
    ])
    const body = JSON.parse(capturedInit?.body as string) as { query: string }
    expect(body.query).toBe('OpenAI')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer k')
  })

  it('surfaces an auth failure', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({}, 401)
    const provider = createTavilyWebSearchProvider({ apiKey: 'bad', baseUrl: 'https://x', fetchImpl })

    await expect(provider.search('q')).rejects.toThrow(/401/)
  })
})
