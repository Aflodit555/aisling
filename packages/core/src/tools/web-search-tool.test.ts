import { describe, expect, it } from 'vitest'

import type { WebSearchProvider } from '../search'
import { createWebSearchTool } from './web-search-tool'

const provider: WebSearchProvider = {
  id: 'stub',
  async search(query) {
    return [{ title: 'OpenAI', url: 'https://openai.com', snippet: 'AI research org', source: 'stub' }]
  },
}

describe('web search tool', () => {
  it('returns a cited, normalized result string', async () => {
    const tool = createWebSearchTool(provider)

    const result = await tool.run({ query: 'OpenAI' })

    expect(result).toContain('Found 1 web result for "OpenAI"')
    expect(result).toContain('[1] https://openai.com')
    expect(result).toContain('AI research org')
  })

  it('handles a missing query', async () => {
    const tool = createWebSearchTool(provider)
    await expect(tool.run({})).resolves.toBe('No query provided.')
  })
})
