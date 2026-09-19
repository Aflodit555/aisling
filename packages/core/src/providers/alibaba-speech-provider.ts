import type { SpeechProvider, SpeechRequest, SpeechResult } from '../speech'

/**
 * Alibaba / DashScope realtime TTS over WebSocket (`qwen-audio-3.0-tts-flash`).
 *
 * Protocol (verified against the aflodit_live2d_copilot `dashscopeRealtime.js`):
 *   URL    wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<model>
 *   Auth   Authorization: Bearer <DASHSCOPE_API_KEY>   (header; Node `ws` only)
 *   Client run-task { header:{action,task_id,streaming:"duplex"}, payload:{task_group:"audio",
 *          task:"tts",function:"SpeechSynthesizer",model,parameters:{...},input:{text}} }
 *   Server task-started / result-generated / task-finished / task-failed
 *   Audio  raw PCM (binary frames) or base64 in result-generated payload.output.audio
 *
 * Browsers cannot set WebSocket headers, so the browser path passes the key as a
 * URL query (`api-key`) — unverified against the real endpoint; point `endpoint`
 * at a local relay if header auth is required.
 */

export interface AlibabaSpeechProviderOptions {
  apiKey: string
  model: string
  voice: string
  /** WebSocket endpoint (workspace/user-specific); defaults to the DashScope realtime URL. */
  endpoint?: string
  sampleRate?: number
  /** Injectable WebSocket factory for tests; defaults to the browser `WebSocket`. */
  WebSocketImpl?: (url: string) => WebSocketLike
  /** `websocket` (default) opens a direct WebSocket; `relay` POSTs to a local relay. */
  transport?: 'websocket' | 'relay'
  /** Relay endpoint used when `transport` is `relay`. */
  relayUrl?: string
  /** Injectable fetch for the relay transport. */
  fetchImpl?: typeof fetch
}

export interface WebSocketLike {
  binaryType?: string
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  send(data: string): void
  close(): void
}

const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
const DEFAULT_SAMPLE_RATE = 24000
const SYNTHESIS_TIMEOUT_MS = 30000

function buildUrl(endpoint: string, model: string, apiKey: string): string {
  const separator = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${separator}model=${encodeURIComponent(model)}&api-key=${encodeURIComponent(apiKey)}`
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 4000)
}

/** Builds the `run-task` message that starts one synthesis. */
export function buildRunTaskMessage(
  text: string,
  options: { taskId: string; model: string; voice: string; sampleRate: number },
): Record<string, unknown> {
  return {
    header: { action: 'run-task', task_id: options.taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: options.model,
      parameters: {
        text_type: 'PlainText',
        format: 'pcm',
        sample_rate: options.sampleRate,
        volume: 50,
        rate: 1.0,
        pitch: 1.0,
        word_timestamp_enabled: false,
        voice: options.voice,
      },
      input: { text },
    },
  }
}

/** Builds the `finish-task` message that ends one synthesis. */
export function buildFinishTaskMessage(taskId: string): Record<string, unknown> {
  return { header: { action: 'finish-task', task_id: taskId }, payload: { input: { directive: 'finish' } } }
}

/** Wraps raw s16le PCM as a playable WAV (RIFF) container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, numChannels = 1, bitsPerSample = 16): ArrayBuffer {
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const buffer = new ArrayBuffer(44 + pcm.length)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, pcm.length, true)
  new Uint8Array(buffer, 44).set(pcm)
  return buffer
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes
}

function defaultWebSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

/**
 * Browser-side relay transport: POSTs the request to a thin local relay that
 * performs the header-authenticated WebSocket handshake server-side and returns
 * the wrapped WAV bytes. The API key never enters a WebSocket query string.
 */
function createRelaySpeechProvider(options: AlibabaSpeechProviderOptions, endpoint: string): SpeechProvider {
  const relayUrl = options.relayUrl ?? '/api/relay/alibaba-tts'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  return {
    id: 'alibaba',

    async synthesize(request: SpeechRequest): Promise<SpeechResult> {
      const text = sanitizeText(request.text)
      if (!text)
        throw new Error('Speech text is empty')

      let response: Response
      try {
        response = await fetchImpl(relayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, endpoint, model: options.model, voice: options.voice, apiKey: options.apiKey }),
        })
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Could not reach the speech relay (${detail})`)
      }

      const data = await response.json() as { audio?: { base64?: string; mimeType?: string }; error?: string }
      if (!response.ok || data.error)
        throw new Error(data.error ?? `Speech relay error (${response.status})`)

      const base64 = data.audio?.base64
      if (!base64)
        throw new Error('Speech relay returned no audio')

      const bytes = decodeBase64(base64)
      const audioData = new ArrayBuffer(bytes.length)
      new Uint8Array(audioData).set(bytes)
      return { audio: { kind: 'bytes', data: audioData, mimeType: data.audio?.mimeType ?? 'audio/wav' } }
    },
  }
}

/** A concrete `SpeechProvider` backed by Alibaba / DashScope realtime TTS. */
export function createAlibabaSpeechProvider(options: AlibabaSpeechProviderOptions): SpeechProvider {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const WebSocketImpl = options.WebSocketImpl ?? defaultWebSocket

  if (options.transport === 'relay') {
    return createRelaySpeechProvider(options, endpoint)
  }

  return {
    id: 'alibaba',

    async synthesize(request: SpeechRequest): Promise<SpeechResult> {
      const text = sanitizeText(request.text)
      if (!text)
        throw new Error('Speech text is empty')

      const taskId = crypto.randomUUID()
      const ws = WebSocketImpl(buildUrl(endpoint, options.model, options.apiKey))
      if (ws.binaryType !== undefined)
        ws.binaryType = 'arraybuffer'

      return new Promise<SpeechResult>((resolve, reject) => {
        const chunks: Uint8Array[] = []
        let base64Audio = ''
        let finished = false
        let timer: ReturnType<typeof setTimeout> | undefined

        const cleanup = (): void => {
          if (timer)
            clearTimeout(timer)
          try {
            ws.close()
          }
          catch { /* already closed */ }
        }

        const fail = (error: Error): void => {
          if (finished)
            return
          finished = true
          cleanup()
          reject(error)
        }

        const succeed = (): void => {
          if (finished)
            return
          finished = true
          cleanup()
          const pcm = base64Audio ? decodeBase64(base64Audio) : concatBytes(chunks)
          if (pcm.length === 0) {
            reject(new Error('Speech provider returned no audio'))
            return
          }
          resolve({ audio: { kind: 'bytes', data: pcmToWav(pcm, sampleRate), mimeType: 'audio/wav' } })
        }

        ws.onopen = () => {
          ws.send(JSON.stringify(buildRunTaskMessage(text, { taskId, model: options.model, voice: options.voice, sampleRate })))
        }

        ws.onmessage = (event) => {
          const data = event.data
          if (typeof data === 'string') {
            let message: { header?: { event?: string }; payload?: { output?: { audio?: unknown }; message?: string; code?: string } }
            try {
              message = JSON.parse(data) as typeof message
            }
            catch {
              return
            }
            const eventName = message.header?.event
            if (eventName === 'result-generated') {
              const audio = message.payload?.output?.audio
              if (typeof audio === 'string')
                base64Audio += audio
              else if (audio && typeof audio === 'object') {
                const inner = (audio as { data?: unknown }).data
                if (typeof inner === 'string')
                  base64Audio += inner
              }
              return
            }
            if (eventName === 'task-finished') {
              ws.send(JSON.stringify(buildFinishTaskMessage(taskId)))
              succeed()
              return
            }
            if (eventName === 'task-failed') {
              fail(new Error(message.payload?.message ?? message.payload?.code ?? 'Speech task failed'))
            }
            return
          }

          if (data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(data)
            if (bytes.length)
              chunks.push(bytes)
          }
        }

        ws.onerror = () => fail(new Error('Speech WebSocket error'))
        ws.onclose = () => {
          if (!finished)
            fail(new Error('Speech WebSocket closed before completion'))
        }

        timer = setTimeout(() => fail(new Error('Speech synthesis timed out')), SYNTHESIS_TIMEOUT_MS)
      })
    },
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
