import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatProvider,
  ToolCall,
  ToolDefinition,
} from '../provider'

export interface OpenAICompatibleProviderOptions {
  /** Base URL of the OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`. */
  baseUrl: string
  apiKey: string
  model: string
  /** Sampling temperature. OpenAI-compatible APIs conventionally accept 0–2. */
  temperature?: number
  /** Injectable fetch for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

/** Error raised when an OpenAI-compatible endpoint rejects a request. */
export class ProviderRequestError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ProviderRequestError'
    this.status = status
  }
}

interface OpenAIErrorBody {
  error?: { message?: string }
}

interface WireToolCall {
  id: string
  type: string
  function: { name: string; arguments: string }
}

interface OpenAICompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: WireToolCall[]
    }
  }>
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content }
  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map(call => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  if (message.toolCallId)
    wire.tool_call_id = message.toolCallId
  return wire
}

function toWireTools(tools: readonly ToolDefinition[]): Array<{ type: string; function: ToolDefinition }> {
  return tools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** Performs one OpenAI-compatible chat completion, returning text and any tool calls. */
export async function openAIChatCompletion(
  options: OpenAICompatibleProviderOptions,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const body: Record<string, unknown> = {
    model: options.model,
    messages: request.messages.map(toWireMessage),
    stream: false,
  }
  if (Number.isFinite(options.temperature))
    body.temperature = Math.max(0, Math.min(2, options.temperature!))
  if (request.tools && request.tools.length > 0)
    body.tools = toWireTools(request.tools)

  let response: Response
  try {
    response = await fetchImpl(endpoint(options.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
    })
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ProviderRequestError(0, `Could not reach the provider (${detail})`)
  }

  if (!response.ok)
    throw new ProviderRequestError(response.status, describeFailure(response.status, await readErrorBody(response)))

  const data = await response.json() as OpenAICompletionResponse
  const message = data.choices?.[0]?.message
  const text = typeof message?.content === 'string' ? message.content : ''
  const toolCalls = message?.tool_calls?.map(call => ({
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }))

  return toolCalls && toolCalls.length > 0
    ? { text, toolCalls }
    : { text }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const data = await response.json() as OpenAIErrorBody
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
  return `Provider error (${status})${hint}`
}

/** A concrete `ChatProvider` that talks to any OpenAI-compatible endpoint. */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ChatProvider {
  return {
    id: 'openai-compatible',
    async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      return openAIChatCompletion(options, request)
    },
  }
}

export interface ConnectionTestResult {
  ok: boolean
  error?: string
}

/** Probes the endpoint with a minimal completion and reports whether it is usable. */
export async function testOpenAICompatibleConnection(
  options: OpenAICompatibleProviderOptions,
): Promise<ConnectionTestResult> {
  try {
    await openAIChatCompletion(options, { messages: [{ role: 'user', content: 'ping' }] })
    return { ok: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

export type { ToolCall }
