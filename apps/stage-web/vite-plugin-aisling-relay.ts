import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'
import WebSocket, { type RawData } from 'ws'

type SpeechTransport = 'websocket' | 'http'

function buildRunTaskMessage(options: { taskId: string; model: string; voice: string }): Record<string, unknown> {
  return {
    header: { action: 'run-task', task_id: options.taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: options.model,
      parameters: {
        text_type: 'PlainText',
        voice: options.voice,
        format: 'mp3',
        sample_rate: 22050,
        volume: 50,
        rate: 1,
        pitch: 1,
        enable_ssml: false,
      },
      input: {},
    },
  }
}

function buildContinueTaskMessage(taskId: string, text: string): Record<string, unknown> {
  return {
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  }
}

function buildFinishTaskMessage(taskId: string): Record<string, unknown> {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }
}

function validateAlibabaTtsEndpoint(value: string, transport: SpeechTransport): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  }
  catch {
    return 'The endpoint is not a valid URL.'
  }
  if (url.username || url.password || url.search || url.hash)
    return 'The endpoint must not contain credentials, query parameters, or a fragment.'
  const host = url.hostname.toLowerCase()
  if (host !== 'aliyuncs.com' && !host.endsWith('.aliyuncs.com'))
    return 'The endpoint must use an aliyuncs.com host.'
  const path = url.pathname.replace(/\/+$/, '')
  if (transport === 'websocket' && (url.protocol !== 'wss:' || path !== '/api-ws/v1/inference'))
    return 'Realtime WebSocket Endpoint must use wss:// and end with /api-ws/v1/inference.'
  if (transport === 'http' && (url.protocol !== 'https:' || path !== '/api/v1'))
    return 'HTTP API Base URL must use https:// and end with /api/v1.'
  return undefined
}

/**
 * A minimal, provider-specific relay that runs inside the Vite dev/preview
 * server (`pnpm dev`). It performs header-authenticated Alibaba HTTP and
 * realtime WebSocket calls server-side and returns audio/transcript to the
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

function describeAuthOrUpstreamError(status: number, rawText = ''): string {
  if (status === 401 || status === 403)
    return `Alibaba TTS authentication failed (HTTP ${status}). Check the API Key and workspace region.`
  return describeUpstreamError(status, rawText)
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

function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data))
    return Buffer.concat(data)
  if (data instanceof ArrayBuffer)
    return Buffer.from(data)
  return Buffer.from(data)
}

function describeProviderFailure(header: Record<string, unknown>): string {
  const code = String(header.error_code ?? 'unknown')
  const message = String(header.error_message ?? 'Speech task failed')
  if (/unsupported|not supported|invalid.*(?:model|voice)|model|voice|音色/i.test(`${code} ${message}`))
    return `Unsupported Alibaba TTS model or voice (${code}): ${message}`
  return `Alibaba TTS provider error (${code}): ${message}`
}

/** Genuine DashScope duplex TTS: header auth, task events, binary MP3 chunks. */
function synthesizeAlibabaWebSocket(options: {
  endpoint: string
  apiKey: string
  model: string
  voice: string
  text: string
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const taskId = crypto.randomUUID()
    const chunks: Buffer[] = []
    let settled = false
    const ws = new WebSocket(options.endpoint, {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'X-DashScope-DataInspection': 'enable',
      },
    })
    const timer = setTimeout(() => fail(new Error('Alibaba TTS WebSocket timed out.')), 30000)

    function cleanup(): void {
      clearTimeout(timer)
      try {
        ws.close()
      }
      catch { /* already closed */ }
    }

    function fail(error: Error): void {
      if (settled)
        return
      settled = true
      cleanup()
      reject(error)
    }

    function succeed(): void {
      if (settled)
        return
      const audio = Buffer.concat(chunks)
      if (!audio.length) {
        fail(new Error('Alibaba TTS provider returned no audio chunks.'))
        return
      }
      settled = true
      cleanup()
      resolve(audio)
    }

    ws.on('open', () => {
      ws.send(JSON.stringify(buildRunTaskMessage({
        taskId,
        model: options.model,
        voice: options.voice,
      })))
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const chunk = rawDataToBuffer(data)
        if (chunk.length)
          chunks.push(chunk)
        return
      }

      let message: { header?: Record<string, unknown>; payload?: Record<string, unknown> }
      try {
        message = JSON.parse(rawDataToBuffer(data).toString('utf8')) as typeof message
      }
      catch {
        fail(new Error('Alibaba TTS WebSocket returned invalid JSON.'))
        return
      }

      const header = message.header ?? {}
      const event = String(header.event ?? '')
      if (event === 'task-started') {
        ws.send(JSON.stringify(buildContinueTaskMessage(taskId, options.text)))
        ws.send(JSON.stringify(buildFinishTaskMessage(taskId)))
      }
      else if (event === 'task-finished') {
        succeed()
      }
      else if (event === 'task-failed') {
        fail(new Error(describeProviderFailure(header)))
      }
      else if (event === 'error') {
        const detail = String(message.payload?.message ?? header.error_message ?? 'Unknown provider error')
        fail(new Error(`Alibaba TTS provider error: ${detail}`))
      }
    })

    ws.on('unexpected-response', (_request, response) => {
      response.resume()
      fail(new Error(describeAuthOrUpstreamError(response.statusCode ?? 502)))
    })
    ws.on('error', error => fail(new Error(`Alibaba TTS WebSocket failure: ${error.message}`)))
    ws.on('close', (code, reason) => {
      if (!settled)
        fail(new Error(`Alibaba TTS WebSocket closed before completion (${code}${reason.length ? `: ${reason.toString()}` : ''}).`))
    })
  })
}

/** Alibaba Native HTTP TTS: SpeechSynthesizer → audio URL → download. */
async function synthesizeAlibabaHttp(options: {
  endpoint: string
  apiKey: string
  model: string
  voice: string
  text: string
}): Promise<Buffer> {
  const ttsUrl = `${options.endpoint.replace(/\/+$/, '')}/services/audio/tts/SpeechSynthesizer`
  const upstream = await fetch(ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model, input: { text: options.text, voice: options.voice, format: 'wav' } }),
  })

  const rawText = await upstream.text().catch(() => '')
  if (!upstream.ok)
    throw new Error(describeAuthOrUpstreamError(upstream.status, rawText))

  let envelope: { output?: { audio?: { url?: string } } }
  try {
    envelope = JSON.parse(rawText) as typeof envelope
  }
  catch {
    throw new Error('Alibaba TTS returned invalid JSON.')
  }

  const audioUrl = envelope.output?.audio?.url
  if (!audioUrl)
    throw new Error('Alibaba TTS provider returned no audio URL.')
  if (!isSafeAliyunAudioUrl(audioUrl))
    throw new Error('Alibaba TTS returned an unsafe audio URL.')

  const audioRes = await fetch(audioUrl)
  if (!audioRes.ok)
    throw new Error(`Alibaba TTS audio download failed (HTTP ${audioRes.status}).`)
  return Buffer.from(await audioRes.arrayBuffer())
}

/**
 * Streams the realtime DashScope WebSocket's binary MP3 chunks straight to the
 * HTTP response as they arrive (chunked transfer). WebSocket message boundaries
 * are forwarded verbatim — they are not assumed to be MP3 frame boundaries; the
 * renderer appends them in order to a single MediaSource buffer.
 */
function streamAlibabaWebSocket(
  res: ServerResponse,
  options: { endpoint: string; apiKey: string; model: string; voice: string; text: string },
): Promise<void> {
  // This function owns the HTTP response end-to-end (success and error) and
  // never rejects, so the caller must not try to write a second response.
  return new Promise((resolve) => {
    const taskId = crypto.randomUUID()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket

    function cleanup(): void {
      clearTimeout(timer)
      try {
        ws?.close()
      }
      catch { /* already closed */ }
    }

    /** Finalizes the response (JSON error or stream abort) and settles. */
    function finish(error?: Error): void {
      if (settled)
        return
      settled = true
      cleanup()
      if (error) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error.message }))
        }
        else {
          res.destroy(error)
        }
      }
      resolve()
    }

    function armTimer(): void {
      clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('Alibaba TTS WebSocket timed out.')), 30000)
    }

    // Client aborted (e.g. renderer switched to a new speech session).
    res.on('close', () => {
      if (!settled) {
        settled = true
        cleanup()
        resolve()
      }
    })

    try {
      ws = new WebSocket(options.endpoint, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'X-DashScope-DataInspection': 'enable',
        },
      })
    }
    catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
      return
    }

    ws.on('open', () => {
      armTimer()
      ws.send(JSON.stringify(buildRunTaskMessage({
        taskId,
        model: options.model,
        voice: options.voice,
      })))
    })

    ws.on('message', (data, isBinary) => {
      armTimer()
      if (isBinary) {
        const chunk = rawDataToBuffer(data)
        if (chunk.length) {
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-cache',
            })
          }
          res.write(chunk)
        }
        return
      }

      let message: { header?: Record<string, unknown>; payload?: Record<string, unknown> }
      try {
        message = JSON.parse(rawDataToBuffer(data).toString('utf8')) as typeof message
      }
      catch {
        finish(new Error('Alibaba TTS WebSocket returned invalid JSON.'))
        return
      }

      const header = message.header ?? {}
      const event = String(header.event ?? '')
      if (event === 'task-started') {
        ws.send(JSON.stringify(buildContinueTaskMessage(taskId, options.text)))
        ws.send(JSON.stringify(buildFinishTaskMessage(taskId)))
      }
      else if (event === 'task-finished') {
        if (settled)
          return
        // No binary chunks forwarded → explicit error instead of an empty 200
        // that would leave the renderer waiting forever.
        if (!res.headersSent) {
          finish(new Error('Alibaba TTS provider returned no audio chunks.'))
          return
        }
        settled = true
        cleanup()
        res.end()
        resolve()
      }
      else if (event === 'task-failed') {
        finish(new Error(describeProviderFailure(header)))
      }
      else if (event === 'error') {
        const detail = String(message.payload?.message ?? header.error_message ?? 'Unknown provider error')
        finish(new Error(`Alibaba TTS provider error: ${detail}`))
      }
    })

    ws.on('unexpected-response', (_request, response) => {
      response.resume()
      finish(new Error(describeAuthOrUpstreamError(response.statusCode ?? 502)))
    })
    ws.on('error', error => finish(new Error(`Alibaba TTS WebSocket failure: ${error.message}`)))
    ws.on('close', (code, reason) => {
      if (!settled)
        finish(new Error(`Alibaba TTS WebSocket closed before completion (${code}${reason.length ? `: ${reason.toString()}` : ''}).`))
    })

    armTimer()
  })
}

/** Dispatches Alibaba TTS to the explicitly selected upstream transport. */
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
    const transport: SpeechTransport = body.transport === 'http' ? 'http' : 'websocket'
    if (!text || !endpoint || !model || !voice || !apiKey) {
      sendJson(res, 400, { error: 'missing text/endpoint/model/voice/apiKey' })
      return
    }

    const endpointError = validateAlibabaTtsEndpoint(endpoint, transport)
    if (endpointError) {
      sendJson(res, 400, { error: `Invalid Alibaba TTS endpoint: ${endpointError}` })
      return
    }

    const request = { text, endpoint, model, voice, apiKey }

    // Streaming realtime path: binary MP3 chunks forwarded as they arrive.
    if (body.stream === true && transport === 'websocket') {
      await streamAlibabaWebSocket(res, request)
      return
    }

    const bytes = transport === 'websocket'
      ? await synthesizeAlibabaWebSocket(request)
      : await synthesizeAlibabaHttp(request)
    sendJson(res, 200, {
      audio: {
        base64: bytes.toString('base64'),
        mimeType: transport === 'websocket' ? 'audio/mpeg' : 'audio/wav',
      },
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('authentication failed') ? 401 : 502
    sendJson(res, status, { error: message })
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
