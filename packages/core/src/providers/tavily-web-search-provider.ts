import type { SearchResult, WebSearchProvider } from '../search'

export interface TavilyWebSearchOptions {
  apiKey: string
  /** Overridable for tests; defaults to the Tavily search endpoint. */
  baseUrl?: string
  /** Injectable fetch for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

const DEFAULT_URL = 'https://api.tavily.com/search'

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>
}

/** A concrete `WebSearchProvider` backed by Tavily. */
export function createTavilyWebSearchProvider(options: TavilyWebSearchOptions): WebSearchProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const endpoint = options.baseUrl ?? DEFAULT_URL

  async function search(query: string): Promise<SearchResult[]> {
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the search provider (${detail})`)
    }

    if (!response.ok)
      throw new Error(describeFailure(response.status, await readError(response)))

    const data = await response.json() as TavilyResponse
    const results = Array.isArray(data.results) ? data.results : []
    return results.map(result => ({
      title: result.title ?? '',
      url: result.url ?? '',
      snippet: (result.content ?? '').slice(0, 800),
      source: 'tavily',
    }))
  }

  return { id: 'tavily', search }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 200)
  }
  catch {
    return ''
  }
}

function describeFailure(status: number, body: string): string {
  const hint = body ? `: ${body}` : ''
  if (status === 401)
    return `Authentication failed (401). Check your API key.${hint}`
  if (status === 429)
    return `Rate limited (429).${hint}`
  return `Search provider error (${status})${hint}`
}
