import { describe, expect, it } from 'vitest'

import type { WebSearchProvider } from '../search'
import { createWebSearchTool } from './web-search-tool'

const provider: WebSearchProvider = {
  id: 'stub',
  async search(query) {
    return [{ title: 'OpenAI', snippet: 'AI research org' }]
  },
}

describe('web search tool', () => {
  it('returns compact titles and snippets without URLs', async () => {
    const tool = createWebSearchTool(provider)

    const result = await tool.run({ query: 'OpenAI' })

    expect(result).toBe('OpenAI\nAI research org')
  })

  it('handles a missing query', async () => {
    const tool = createWebSearchTool(provider)
    await expect(tool.run({})).resolves.toBe('No query provided.')
  })

  it('gives the model a short failure result', async () => {
    const tool = createWebSearchTool({ id: 'failed', search: async () => { throw new Error('network error') } })
    await expect(tool.run({ query: 'OpenAI' })).resolves.toBe('Search failed.')
  })
})
