const { protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { existsSync, statSync } = require('node:fs')

/**
 * Production Stage loader. Instead of `file://` (which has no origin and would
 * break both `localStorage` and the history router), the built renderer is
 * served under a fixed, standard, secure custom scheme: `aisling://stage`.
 *
 * `registerStageScheme` must run before `app.whenReady()`; `registerStageProtocol`
 * must run after it. Both are idempotent.
 */
const SCHEME = 'aisling'
const HOST = 'stage'
const STAGE_DIST = path.join(__dirname, '..', 'stage-web', 'dist')

function isBuiltRendererAvailable() {
  return existsSync(path.join(STAGE_DIST, 'index.html'))
}

function buildStageUrl() {
  return `${SCHEME}://${HOST}/`
}

function registerStageScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

function resolveAssetPath(requestUrl) {
  const url = new URL(requestUrl)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '' || pathname === '/')
    pathname = '/index.html'
  const relative = pathname.replace(/^\/+/, '')
  const filePath = path.normalize(path.join(STAGE_DIST, relative))
  if (!filePath.startsWith(STAGE_DIST))
    return undefined
  return filePath
}

async function handleStageRequest(request) {
  try {
    const url = new URL(request.url)
    if (url.hostname === HOST && url.pathname === '/api/relay/web-search') {
      const query = url.searchParams.get('q')?.trim() ?? ''
      if (!query || query.length > 500)
        return new Response('Search query must be 1–500 characters.', { status: 400 })
      try {
        const upstream = await fetch(`https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query })}`, { signal: AbortSignal.timeout(10000) })
        return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      catch {
        return new Response('Could not reach DuckDuckGo Lite.', { status: 502 })
      }
    }
    let filePath = resolveAssetPath(request.url)
    if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      // Unknown paths fall back to the SPA shell so client-side routes work.
      filePath = path.join(STAGE_DIST, 'index.html')
    }
    return net.fetch(pathToFileURL(filePath).toString())
  }
  catch {
    return new Response('Not found', { status: 404 })
  }
}

let protocolRegistered = false

function registerStageProtocol() {
  if (protocolRegistered)
    return
  protocolRegistered = true
  protocol.handle(SCHEME, handleStageRequest)
}

module.exports = {
  SCHEME,
  HOST,
  STAGE_DIST,
  isBuiltRendererAvailable,
  buildStageUrl,
  registerStageScheme,
  registerStageProtocol,
}
