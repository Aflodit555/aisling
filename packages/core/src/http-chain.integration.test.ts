import { createServer } from 'node:http'
import type { Server } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import { createOpenAICompatibleProvider } from './providers/openai-compatible-provider'
import { createCharacterRuntime } from './runtime'
import { createUserTextStimulus } from './stimulus'

interface FakeCompletion {
  status: number
  payload: unknown
}

/**
 * Starts a local HTTP server that speaks the OpenAI `/chat/completions`
 * protocol, so the real `OpenAICompatibleProvider` runs over real HTTP without
 * a vendor API key.
 */
async function withOpenAIServer(handler: (body: { model?: string }) => FakeCompletion) {
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) as { model?: string } : {}
      const result = handler(body)
      res.writeHead(result.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result.payload))
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

describe('real HTTP chain (OpenAI-compatible)', () => {
  it('runs the full loop over a real HTTP endpoint', async () => {
    const fake = await withOpenAIServer((body) => {
      expect(body.model).toBe('aisling-model')
      return { status: 200, payload: { choices: [{ message: { content: 'real-reply-over-http' } }] } }
    })

    try {
      const provider = createOpenAICompatibleProvider({
        baseUrl: fake.baseUrl,
        apiKey: 'sk-local',
        model: 'aisling-model',
      })
      const character = createCharacter({ id: 'aisling', name: 'Aisling', persona: 'p', capabilities: [] })
      const runtime = createCharacterRuntime({ character, createId: () => 't', getChatProvider: () => provider })

      const turn = await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'hello' }))

      expect(turn.status).toBe('completed')
      expect(turn.output).toEqual({ kind: 'text', text: 'real-reply-over-http' })
    }
    finally {
      await fake.close()
    }
  })

  it('turns an authentication failure into a failed turn, not a crash', async () => {
    const fake = await withOpenAIServer(() => ({
      status: 401,
      payload: { error: { message: 'invalid key' } },
    }))

    try {
      const provider = createOpenAICompatibleProvider({ baseUrl: fake.baseUrl, apiKey: 'bad', model: 'm' })
      const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
      const runtime = createCharacterRuntime({ character, createId: () => 't', getChatProvider: () => provider })

      const turn = await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'hi' }))

      expect(turn.status).toBe('failed')
      expect(turn.error).toContain('401')
    }
    finally {
      await fake.close()
    }
  })
})
