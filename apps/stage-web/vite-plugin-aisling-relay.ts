import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

/**
 * A minimal, provider-specific relay that runs inside the Vite dev/preview
 * server (`pnpm dev`). It performs the header-authenticated Alibaba calls
 * server-side (Native HTTP, not WebSocket) and returns audio/transcript to the
 * browser. It is transport/auth only — no runtime, no framework.
 */

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      }
      catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Reads an upstream error body and preserves status + a safe message snippet. */
function describeUpstreamError(status: number, rawText: string): string {
  let message: string | undefined
  try {
    const parsed = JSON.parse(rawText) as { message?: string; code?: string; error?: { message?: string } }
    message = parsed.message ?? parsed.error?.message ?? parsed.code
  }
  catch {
    // non-JSON error body — use a raw snippet instead
  }
  const snippet = message?.slice(0, 300) ?? rawText.slice(0, 300).replace(/\s+/g, ' ').trim()
  return `Alibaba upstream error (HTTP ${status})${snippet ? `: ${snippet}` : ''}`
}

/** Only http/https audio URLs on an Alibaba host are allowed (SSRF guard). */
function isSafeAliyunAudioUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      return false
    const host = url.hostname.toLowerCase()
    return host === 'aliyuncs.com' || host.endsWith('.aliyuncs.com')
  }
  catch {
    return false
  }
}

/** Alibaba Native HTTP TTS: SpeechSynthesizer → audio URL → download. */
async function handleAlibabaTts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  try {
    const body = await readJsonBody(req)
    const text = String(body.text ?? '')
    const endpoint = String(body.endpoint ?? '')
    const model = String(body.model ?? '')
    const voice = String(body.voice ?? '')
    const apiKey = String(body.apiKey ?? '')
    if (!text || !endpoint || !model || !voice || !apiKey) {
      sendJson(res, 400, { error: 'missing text/endpoint/model/voice/apiKey' })
      return
    }

    const ttsUrl = `${endpoint.replace(/\/+$/, '')}/services/audio/tts/SpeechSynthesizer`
    const upstream = await fetch(ttsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: { text, voice, format: 'wav' } }),
    })

    const rawText = await upstream.text().catch(() => '')
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: describeUpstreamError(upstream.status, rawText) })
      return
    }

    let envelope: { output?: { audio?: { url?: string } } }
    try {
      envelope = JSON.parse(rawText) as typeof envelope
    }
    catch {
      sendJson(res, 502, { error: 'Alibaba TTS returned invalid JSON' })
      return
    }

    const audioUrl = envelope.output?.audio?.url
    if (!audioUrl) {
      sendJson(res, 502, { error: 'Alibaba TTS returned no audio URL' })
      return
    }
    if (!isSafeAliyunAudioUrl(audioUrl)) {
      sendJson(res, 502, { error: 'Alibaba TTS returned an unsafe audio URL' })
      return
    }

    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      sendJson(res, 502, { error: `Alibaba TTS audio download failed (HTTP ${audioRes.status})` })
      return
    }
    const bytes = Buffer.from(await audioRes.arrayBuffer())
    sendJson(res, 200, { audio: { base64: bytes.toString('base64'), mimeType: 'audio/wav' } })
  }
  catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function extractAsrText(data: Record<string, unknown>): string {
  const output = data.output
  if (output && typeof output === 'object') {
    const choices = (output as Record<string, unknown>).choices
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as Record<string, unknown>).message
      const content = message && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined
      if (typeof content === 'string')
        return content.trim()
      if (Array.isArray(content)) {
        const text = content
          .map(part => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined))
          .filter((part): part is string => typeof part === 'string')
          .join('')
          .trim()
        if (text)
          return text
      }
    }
    const directText = (output as Record<string, unknown>).text
    if (typeof directText === 'string')
      return directText.trim()
  }
  const topText = data.text
  return typeof topText === 'string' ? topText.trim() : ''
}

/** Alibaba Native ASR: multimodal-generation with an input_audio Data URI. */
async function handleAlibabaAsr(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  try {
    const body = await readJsonBody(req)
    const audioBase64 = String(body.audioBase64 ?? '')
    const mimeType = String(body.mimeType ?? 'audio/webm')
    const model = String(body.model ?? '')
    const endpoint = String(body.endpoint ?? '')
    const apiKey = String(body.apiKey ?? '')
    if (!audioBase64 || !model || !endpoint || !apiKey) {
      sendJson(res, 400, { error: 'missing audioBase64/model/endpoint/apiKey' })
      return
    }

    const dataUri = `data:${mimeType};base64,${audioBase64}`
    const asrUrl = `${endpoint.replace(/\/+$/, '')}/services/aigc/multimodal-generation/generation`
    const upstream = await fetch(asrUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            { role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] },
          ],
        },
      }),
    })

    const rawText = await upstream.text().catch(() => '')
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: describeUpstreamError(upstream.status, rawText) })
      return
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawText) as Record<string, unknown>
    }
    catch {
      sendJson(res, 502, { error: 'Alibaba ASR returned invalid JSON' })
      return
    }

    const text = extractAsrText(data)
    if (!text) {
      sendJson(res, 502, { error: 'Alibaba ASR returned no transcript' })
      return
    }
    sendJson(res, 200, { text })
  }
  catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** OpenAI-compatible transcription (kept as a separate Hearing provider). */
async function handleTranscription(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  try {
    const body = await readJsonBody(req)
    const audioBase64 = String(body.audioBase64 ?? '')
    const mimeType = String(body.mimeType ?? 'audio/webm')
    const model = String(body.model ?? '')
    const baseUrl = String(body.baseUrl ?? '')
    const apiKey = String(body.apiKey ?? '')
    const language = body.language ? String(body.language) : undefined

    if (!audioBase64 || !model || !baseUrl || !apiKey) {
      sendJson(res, 400, { error: 'missing audioBase64/model/baseUrl/apiKey' })
      return
    }

    const form = new FormData()
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: mimeType }), fileNameForMime(mimeType))
    form.append('model', model)
    if (language)
      form.append('language', language)

    const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    const rawText = await upstream.text().catch(() => '')
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: describeUpstreamError(upstream.status, rawText) })
      return
    }
    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawText) as Record<string, unknown>
    }
    catch {
      sendJson(res, 502, { error: 'Transcription provider returned invalid JSON' })
      return
    }
    sendJson(res, 200, data)
  }
  catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function fileNameForMime(mimeType: string): string {
  if (mimeType.includes('webm'))
    return 'recording.webm'
  if (mimeType.includes('mp4') || mimeType.includes('m4a'))
    return 'recording.m4a'
  if (mimeType.includes('mp3') || mimeType.includes('mpeg'))
    return 'recording.mp3'
  return 'recording.wav'
}

export function aislingRelayPlugin(): Plugin {
  const routes: Array<[string, (req: IncomingMessage, res: ServerResponse) => Promise<void>]> = [
    ['/api/relay/alibaba-tts', handleAlibabaTts],
    ['/api/relay/alibaba-asr', handleAlibabaAsr],
    ['/api/relay/transcription', handleTranscription],
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
