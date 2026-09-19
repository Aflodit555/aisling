import { createServer } from 'node:http'
import type { Server } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleVisionProvider } from './providers/openai-compatible-vision-provider'

async function withVisionServer() {
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'a red ball on a table' } }] }))
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

describe('vision over real HTTP', () => {
  it('returns the model observation', async () => {
    const server = await withVisionServer()

    try {
      const provider = createOpenAICompatibleVisionProvider({
        baseUrl: server.baseUrl,
        apiKey: 'k',
        model: 'gpt-4o-mini',
      })

      const result = await provider.analyze({ image: { data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'image/png' } })

      expect(result.text).toBe('a red ball on a table')
    }
    finally {
      await server.close()
    }
  })
})
