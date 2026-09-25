import type { SearchResult, WebSearchProvider } from '../search'

/** DuckDuckGo Lite results are fetched through the app's same-origin relay. */
export function createDuckDuckGoLiteWebSearchProvider(): WebSearchProvider {
  return {
    id: 'duckduckgo',
    async search(query: string): Promise<SearchResult[]> {
      const response = await fetch(`/api/relay/web-search?${new URLSearchParams({ q: query })}`)
      if (!response.ok)
        throw new Error(`Search failed (HTTP ${response.status}).`)

      const page = new DOMParser().parseFromString(await response.text(), 'text/html')
      const snippets = Array.from(page.querySelectorAll('.result-snippet'))
      return Array.from(page.querySelectorAll('.result-link')).slice(0, 5).map((link, index) => ({
        title: link.textContent?.trim() ?? '',
        snippet: snippets[index]?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      }))
    },
  }
}
