import type { WebSearchProvider } from '../search'
import type { Tool } from '../tool'

/**
 * Gives the model the same compact title-and-snippet text as DuckDuckGo Lite.
 */
function formatSearchResults(results: ReadonlyArray<{ title: string; snippet: string }>): string {
  if (results.length === 0)
    return 'No results.'

  return results.map(result => `${result.title}\n${result.snippet}`).join('\n\n')
}

/**
 * Builds the `search` tool from a search provider. This is the first Tool —
 * future tools (calculator, files, code) join the same `Tool` shape.
 */
export function createWebSearchTool(provider: WebSearchProvider): Tool {
  return {
    name: 'search',
    description: 'Search the web for current or unfamiliar information. Returns the top five titles and snippets from DuckDuckGo Lite.',
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
      try {
        return formatSearchResults(await provider.search(query))
      }
      catch {
        return 'Search failed.'
      }
    },
  }
}
