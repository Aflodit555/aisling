import type { ImageInput, VisionProvider, VisionRequest, VisualObservation } from '../vision'

export interface OpenAICompatibleVisionOptions {
  /** Base URL of the OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`. */
  baseUrl: string
  apiKey: string
  model: string
  /** Injectable fetch for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function toDataUrl(image: ImageInput): string {
  return `data:${image.mimeType};base64,${toBase64(image.data)}`
}

/**
 * A concrete `VisionProvider` that sends an image to an OpenAI-compatible
 * multimodal `/chat/completions` endpoint (image_url content part) and returns
 * the model's textual description.
 */
export function createOpenAICompatibleVisionProvider(
  options: OpenAICompatibleVisionOptions,
): VisionProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  async function analyze(request: VisionRequest): Promise<VisualObservation> {
    let response: Response
    try {
      response = await fetchImpl(endpoint(options.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: request.prompt ?? 'Describe this image concisely, focusing on what is visible.' },
              { type: 'image_url', image_url: { url: toDataUrl(request.image) } },
            ],
          }],
          stream: false,
        }),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the vision provider (${detail})`)
    }

    if (!response.ok)
      throw new Error(describeFailure(response.status, await readError(response)))

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text)
      throw new Error('Vision provider returned an empty observation')

    return { text }
  }

  return { id: 'openai-compatible-vision', analyze }
}

async function readError(response: Response): Promise<string> {
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
  return `Vision provider error (${status})${hint}`
}
