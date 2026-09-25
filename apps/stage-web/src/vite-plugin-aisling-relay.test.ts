import { createServer } from 'vite'
import { expect, it, vi } from 'vitest'

import { aislingRelayPlugin } from '../vite-plugin-aisling-relay'

it('serves DuckDuckGo Lite through the web search relay without a key', async () => {
  const nativeFetch = globalThis.fetch
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<a class="result-link">A</a>'))
  const server = await createServer({ configFile: false, plugins: [aislingRelayPlugin()], server: { host: '127.0.0.1', port: 0 } })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/relay/web-search?q=OpenAI`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('result-link')
    expect(upstream).toHaveBeenCalledWith('https://lite.duckduckgo.com/lite/?q=OpenAI', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  }
  finally {
    upstream.mockRestore()
    await server.close()
  }
})
