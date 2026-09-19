import type { HearingProvider, RecognitionRequest, Transcript } from '../hearing'

/**
 * Alibaba / DashScope Native ASR (`qwen-audio-3.0-asr-flash`) over HTTP
 * multimodal-generation. The browser uses the `relay` transport; `direct` is
 * kept for tests and Node-side use. The request sends an `input_audio` content
 * part whose `data` is a Data URI (never a fake WAV around webm bytes).
 */

export interface AlibabaAsrOptions {
  endpoint: string
  apiKey: string
  model: string
  /** `relay` (default) posts to a local relay; `direct` posts to Alibaba. */
  transport?: 'direct' | 'relay'
  relayUrl?: string
  fetchImpl?: typeof fetch
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  return btoa(binary)
}

/** Reads the transcript from Alibaba multimodal-generation response variants. */
export function extractAsrText(data: Record<string, unknown>): string {
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

export function createAlibabaAsrProvider(options: AlibabaAsrOptions): HearingProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  async function recognizeDirect(request: RecognitionRequest): Promise<Transcript> {
    const dataUri = `data:${request.audio.mimeType};base64,${toBase64(request.audio.data)}`
    const url = `${options.endpoint.replace(/\/+$/, '')}/services/aigc/multimodal-generation/generation`

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }] },
        }),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the ASR provider (${detail})`)
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      throw new Error(`Alibaba ASR error (HTTP ${response.status})${raw ? `: ${raw.slice(0, 300)}` : ''}`)
    }

    const data = await response.json() as Record<string, unknown>
    const text = extractAsrText(data)
    if (!text)
      throw new Error('Alibaba ASR returned no transcript')
    return { text }
  }

  async function recognizeRelay(request: RecognitionRequest): Promise<Transcript> {
    const relayUrl = options.relayUrl ?? '/api/relay/alibaba-asr'

    let response: Response
    try {
      response = await fetchImpl(relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: toBase64(request.audio.data),
          mimeType: request.audio.mimeType,
          model: options.model,
          endpoint: options.endpoint,
          apiKey: options.apiKey,
        }),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the ASR relay (${detail})`)
    }

    const rawText = await response.text().catch(() => '')
    let data: { text?: string; error?: string }
    try {
      data = JSON.parse(rawText) as { text?: string; error?: string }
    }
    catch {
      throw new Error(`ASR relay returned a non-JSON response (HTTP ${response.status})`)
    }
    if (!response.ok || data.error)
      throw new Error(data.error ?? `ASR relay error (HTTP ${response.status})`)
    if (!data.text)
      throw new Error('ASR relay returned no transcript')
    return { text: data.text }
  }

  const recognize = options.transport === 'direct' ? recognizeDirect : recognizeRelay

  return { id: 'alibaba-asr', recognize }
}
