import { createServer } from 'node:http'
import type { Server } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createOpenAICompatibleTranscriptionProvider } from './providers/openai-compatible-transcription-provider'

interface RouteResult {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
}

type RouteHandler = (baseUrl: string, method: string, url: string, body: string) => RouteResult

async function withServer(handler: RouteHandler) {
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const result = handler(`http://127.0.0.1:${port}`, req.method ?? 'GET', req.url ?? '/', raw)
      res.writeHead(result.status, { 'Content-Type': 'application/json', ...result.headers })
      res.end(result.body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: (() => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      return `http://127.0.0.1:${port}`
    })(),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

describe('hearing over real HTTP', () => {
  it('transcribes audio through an OpenAI-compatible /audio/transcriptions endpoint', async () => {
    const server = await withServer((_baseUrl, _method, url): RouteResult => {
      if (url === '/v1/audio/transcriptions')
        return { status: 200, headers: {}, body: JSON.stringify({ text: 'heard you over http' }) }
      return { status: 404, headers: {}, body: '' }
    })

    try {
      const provider = createOpenAICompatibleTranscriptionProvider({
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'sk',
        model: 'whisper-1',
      })

      const result = await provider.recognize({ audio: { data: new ArrayBuffer(8), mimeType: 'audio/wav' } })

      expect(result.text).toBe('heard you over http')
    }
    finally {
      await server.close()
    }
  })
})
