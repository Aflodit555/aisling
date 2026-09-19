import type { WebSearchProvider } from '../search'
import type { Tool } from '../tool'

/**
 * Renders search results as a numbered list the model can read and cite, with
 * each source URL kept on its own line. The provider already normalized the
 * vendor JSON; the character only ever sees this Aisling-owned text.
 */
function formatSearchResults(query: string, results: ReadonlyArray<{ title: string; url: string; snippet: string }>): string {
  if (results.length === 0)
    return `No web results found for "${query}".`

  const blocks = results.map((result, index) => (
    `[${index + 1}] ${result.url}\n${result.title}\n${result.snippet}`
  ))

  return `Found ${results.length} web result${results.length === 1 ? '' : 's'} for "${query}":\n\n${blocks.join('\n\n')}`
}

/**
 * Builds the `web_search` tool from a search provider. This is the first Tool —
 * future tools (calculator, files, code) join the same `Tool` shape.
 */
export function createWebSearchTool(provider: WebSearchProvider): Tool {
  return {
    name: 'web_search',
    description: 'Search the web for current or unfamiliar information and return results with source URLs. Prefer what you already know; use this when the user asks or when the answer needs up-to-date facts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
    async run(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query)
        return 'No query provided.'
      const results = await provider.search(query)
      return formatSearchResults(query, results)
    },
  }
}
