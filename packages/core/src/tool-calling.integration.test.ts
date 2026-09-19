import { createServer } from 'node:http'
import type { Server } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import { createOpenAICompatibleProvider } from './providers/openai-compatible-provider'
import { createCharacterRuntime } from './runtime'
import type { WebSearchProvider } from './search'
import { createUserTextStimulus } from './stimulus'
import { createWebSearchTool } from './tools/web-search-tool'

const stubSearch: WebSearchProvider = {
  id: 'stub',
  async search() {
    return [{ title: 'OpenAI', url: 'https://openai.com', snippet: 'AI research org', source: 'stub' }]
  },
}

interface CapturedRequest {
  body: Record<string, unknown>
}

async function withToolCallingServer() {
  const requests: CapturedRequest[] = []
  let count = 0
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      count += 1
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
      requests.push({ body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (count === 1) {
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"OpenAI"}' } }],
            },
          }],
        }))
      }
      else {
        res.end(JSON.stringify({ choices: [{ message: { content: 'final answer citing sources' } }] }))
      }
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

describe('tool calling over real HTTP', () => {
  it('runs the character → tool → character loop', async () => {
    const server = await withToolCallingServer()

    try {
      const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, apiKey: 'k', model: 'm' })
      const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
      const runtime = createCharacterRuntime({
        character,
        createId: () => 't',
        getChatProvider: () => provider,
        getTools: () => [createWebSearchTool(stubSearch)],
      })

      const events: string[] = []
      runtime.onEvent(event => events.push(event.type))

      const turn = await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'What is OpenAI?' }))

      expect(turn.status).toBe('completed')
      expect(turn.output).toEqual({ kind: 'text', text: 'final answer citing sources' })
      expect(events).toContain('tool:requested')
      expect(events).toContain('tool:started')
      expect(events).toContain('tool:completed')

      // The second request carries the tool result back to the model.
      const second = server.requests[1]?.body
      const messages = second?.messages as Array<{ role: string; tool_call_id?: string }>
      expect(messages.some(message => message.role === 'tool' && message.tool_call_id === 'call_1')).toBe(true)
    }
    finally {
      await server.close()
    }
  })
})
