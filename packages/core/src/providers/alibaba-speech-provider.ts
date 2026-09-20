import type { SpeechTransport } from '../config'
import type { SpeechProvider, SpeechRequest, SpeechResult } from '../speech'

/**
 * Alibaba TTS provider for the renderer. Both upstream transports go through
 * the local relay so an API key is never placed in a WebSocket URL. In realtime
 * mode the relay opens the genuine header-authenticated DashScope WebSocket.
 */
export interface AlibabaSpeechProviderOptions {
  apiKey: string
  model: string
  voice: string
  endpoint: string
  transport?: SpeechTransport
  relayUrl?: string
  fetchImpl?: typeof fetch
}

const DEFAULT_SAMPLE_RATE = 22050

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 4000)
}

/** Starts a duplex SpeechSynthesizer task. Text is sent only after task-started. */
export function buildRunTaskMessage(
  options: { taskId: string; model: string; voice: string; sampleRate?: number },
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
        voice: options.voice,
        format: 'mp3',
        sample_rate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
        volume: 50,
        rate: 1,
        pitch: 1,
        enable_ssml: false,
      },
      input: {},
    },
  }
}

/** Streams synthesis text after DashScope acknowledges task-started. */
export function buildContinueTaskMessage(taskId: string, text: string): Record<string, unknown> {
  return {
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  }
}

/** Signals that all text has been sent; task-finished is the terminal response. */
export function buildFinishTaskMessage(taskId: string): Record<string, unknown> {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }
}

/** Wraps raw s16le PCM as a playable WAV (kept for other PCM speech adapters). */
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

/** Creates a renderer provider backed by the local Alibaba transport relay. */
export function createAlibabaSpeechProvider(options: AlibabaSpeechProviderOptions): SpeechProvider {
  const relayUrl = options.relayUrl ?? '/api/relay/alibaba-tts'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const transport = options.transport ?? 'websocket'

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
          body: JSON.stringify({
            text,
            endpoint: options.endpoint,
            model: options.model,
            voice: options.voice,
            apiKey: options.apiKey,
            transport,
          }),
        })
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Could not reach the speech relay (${detail})`)
      }

      let data: { audio?: { base64?: string; mimeType?: string }; error?: string }
      try {
        data = await response.json() as typeof data
      }
      catch {
        throw new Error(`Speech relay returned an invalid response (HTTP ${response.status})`)
      }
      if (!response.ok || data.error)
        throw new Error(data.error ?? `Speech relay error (HTTP ${response.status})`)

      const base64 = data.audio?.base64
      if (!base64)
        throw new Error('Speech relay returned no audio')

      const bytes = decodeBase64(base64)
      const audioData = new ArrayBuffer(bytes.length)
      new Uint8Array(audioData).set(bytes)
      return { audio: { kind: 'bytes', data: audioData, mimeType: data.audio?.mimeType ?? 'audio/mpeg' } }
    },
  }
}
