import type { HearingProvider, RecognitionRequest, Transcript } from '../hearing'

export interface OpenAICompatibleTranscriptionOptions {
  /** Base URL of the OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`. */
  baseUrl: string
  apiKey: string
  model: string
  language?: string
  /** Injectable fetch for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** `direct` (default) posts to the endpoint; `relay` posts to a local relay. */
  transport?: 'direct' | 'relay'
  /** Relay endpoint used when `transport` is `relay`. */
  relayUrl?: string
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`
}

/** OpenAI-compatible endpoints often infer the format from the filename extension. */
function fileNameForMime(mimeType: string): string {
  if (mimeType.includes('webm'))
    return 'recording.webm'
  if (mimeType.includes('mp4') || mimeType.includes('m4a'))
    return 'recording.m4a'
  if (mimeType.includes('mp3') || mimeType.includes('mpeg'))
    return 'recording.mp3'
  return 'recording.wav'
}

/** Reads the transcript text from OpenAI-compatible response variants. */
export function normalizeTranscriptionText(response: unknown): string {
  if (!response || typeof response !== 'object')
    return ''

  const record = response as Record<string, unknown>
  const direct = record.text
  if (typeof direct === 'string' && direct.trim())
    return direct.trim()

  for (const key of ['result', 'data', 'output']) {
    const nested = record[key]
    if (nested && typeof nested === 'object') {
      const text = (nested as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim())
        return text.trim()
    }
  }

  if (Array.isArray(record.segments)) {
    const joined = record.segments
      .map(segment => (segment && typeof segment === 'object' ? (segment as Record<string, unknown>).text : undefined))
      .filter((text): text is string => typeof text === 'string')
      .join('')
      .trim()
    if (joined)
      return joined
  }

  return ''
}

/**
 * A concrete `HearingProvider` that POSTs audio to an OpenAI-compatible
 * `/audio/transcriptions` endpoint (multipart `file` + `model`).
 */
export function createOpenAICompatibleTranscriptionProvider(
  options: OpenAICompatibleTranscriptionOptions,
): HearingProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  if (options.transport === 'relay') {
    return createRelayTranscriptionProvider(options)
  }

  async function recognize(request: RecognitionRequest): Promise<Transcript> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([request.audio.data], { type: request.audio.mimeType }),
      request.audio.fileName ?? fileNameForMime(request.audio.mimeType),
    )
    form.append('model', options.model)
    if (options.language)
      form.append('language', options.language)

    let response: Response
    try {
      response = await fetchImpl(endpoint(options.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the transcription provider (${detail})`)
    }

    if (!response.ok) {
      const body = await readErrorBody(response)
      throw new Error(describeFailure(response.status, body))
    }

    const data = await response.json()
    const text = normalizeTranscriptionText(data)
    if (!text)
      throw new Error('Transcription provider returned an empty result')

    return { text }
  }

  return { id: 'openai-compatible-transcription', recognize }
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  return btoa(binary)
}

/**
 * Browser-side relay transport: POSTs the audio as base64 JSON to a thin local
 * relay, which performs the header-authenticated multipart request server-side
 * and returns the transcript. Avoids browser CORS on the external endpoint.
 */
function createRelayTranscriptionProvider(options: OpenAICompatibleTranscriptionOptions): HearingProvider {
  const relayUrl = options.relayUrl ?? '/api/relay/transcription'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  async function recognize(request: RecognitionRequest): Promise<Transcript> {
    let response: Response
    try {
      response = await fetchImpl(relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: arrayBufferToBase64(request.audio.data),
          mimeType: request.audio.mimeType,
          model: options.model,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          language: options.language,
        }),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the transcription relay (${detail})`)
    }

    const data = await response.json() as { text?: string; error?: string }
    if (!response.ok || data.error)
      throw new Error(data.error ?? `Transcription relay error (${response.status})`)

    const text = normalizeTranscriptionText(data)
    if (!text)
      throw new Error('Transcription relay returned an empty result')

    return { text }
  }

  return { id: 'openai-compatible-transcription', recognize }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: { message?: string } }
    return data.error?.message ?? ''
  }
  catch {
    return ''
  }
}

function describeFailure(status: number, body: string): string {
  const hint = body ? `: ${body}` : ''
  if (status === 401)
    return `Authentication failed (401). Check your API key.${hint}`
  if (status === 404)
    return `Endpoint not found (404). Check the Base URL.${hint}`
  if (status === 429)
    return `Rate limited (429).${hint}`
  return `Transcription provider error (${status})${hint}`
}
