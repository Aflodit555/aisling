import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'

import type { Plugin } from 'vite'

// Load the server relay in Node so Vite's config bundler does not rewrite ws's CommonJS entry.
const { handleAlibabaTts } = createRequire(import.meta.url)('./relay/alibaba-tts.cjs') as typeof import('./relay/alibaba-tts.cjs')

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleWebSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q')?.trim() ?? ''
  if (!query || query.length > 500) {
    sendJson(res, 400, { error: 'Search query must be 1–500 characters.' })
    return
  }
  try {
    const upstream = await fetch(`https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query })}`, { signal: AbortSignal.timeout(10000) })
    res.writeHead(upstream.status, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(await upstream.text())
  }
  catch {
    sendJson(res, 502, { error: 'Could not reach DuckDuckGo Lite.' })
  }
}

export function aislingRelayPlugin(): Plugin {
  const routes: Array<[string, (req: IncomingMessage, res: ServerResponse) => Promise<void>]> = [
    ['/api/relay/alibaba-tts', handleAlibabaTts],
    ['/api/relay/web-search', handleWebSearch],
  ]

  const mount = (server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }): void => {
    for (const [path, handler] of routes) {
      server.middlewares.use(path, (req, res) => {
        void handler(req, res)
      })
    }
  }

  return {
    name: 'aisling-relay',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}
