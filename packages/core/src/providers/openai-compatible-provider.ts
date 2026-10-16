import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatProvider,
  ChatRequestTiming,
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
    finish_reason?: string | null
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: WireToolCall[]
    }
  }>
}

interface OpenAIStreamChunk {
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  error?: { message?: string }
}

type ResponseMetadata = Pick<ChatRequestTiming, 'contentChars' | 'reasoningChars' | 'contentDeltaCount' |
  'reasoningDeltaCount' | 'streamEventCount' | 'doneReceived' | 'unsupportedContent' | 'finishReason'>
function finishReason(value: unknown): ChatRequestTiming['finishReason'] {
  if (value === null || value === undefined) return 'unknown'
  return ['stop', 'length', 'tool_calls', 'function_call', 'content_filter'].includes(value as string)
    ? value as ChatRequestTiming['finishReason'] : 'other'
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
  onText?: (text: string) => void,
): Promise<ChatCompletionResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let stage: ChatRequestTiming['stage'] = 'provider'
  let httpStatus: number | undefined
  const metadata: ResponseMetadata | undefined = request.onTiming ? {} : undefined
  function timing(event: ChatRequestTiming['event'], errorKind?: ChatRequestTiming['errorKind']): void {
    if (!request.onTiming) return
    try { request.onTiming({ at: Date.now(), event, stage, httpStatus, ...metadata,
      abortRequested: request.signal?.aborted === true, errorKind }) }
    catch { /* A timing sink must never alter a request or its errors. */ }
  }
  const onAbort = () => timing('aborted')
  timing('provider-enter')
  if (request.onTiming && request.signal) {
    if (request.signal.aborted) onAbort()
    else request.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: request.messages.map(toWireMessage),
      stream: Boolean(onText),
    }
    const temperature = request.temperature ?? options.temperature
    if (Number.isFinite(temperature))
      body.temperature = Math.max(0, Math.min(2, temperature!))
    if (request.enableThinking !== undefined)
      body.enable_thinking = request.enableThinking
    if (request.tools && request.tools.length > 0)
      body.tools = toWireTools(request.tools)
    if (request.maxOutputTokens !== undefined) {
      if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)
        throw new Error('Invalid completion token limit')
      body.max_completion_tokens = request.maxOutputTokens
    }

    let response: Response
    stage = 'fetch'; timing('fetch-start')
    try {
      response = await fetchImpl(endpoint(options.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      })
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new ProviderRequestError(0, `Could not reach the provider (${detail})`)
    }
    httpStatus = response.status
    timing('headers-received')
    if (!response.ok) {
      stage = 'response-json'
      throw new ProviderRequestError(response.status, describeFailure(response.status, await readErrorBody(response, request.onTiming ? timing : undefined)))
    }

    if (onText && !response.headers.get('content-type')?.includes('application/json')) {
      stage = 'stream'
      let first = true
      const result = await readStream(response, text => {
        if (first) { first = false; timing('first-text') }
        onText(text)
      }, metadata)
      timing('stream-end')
      timing('result-ready')
      return result
    }

    stage = 'response-json'; timing('response-json-start')
    let data: OpenAICompletionResponse
    try {
      data = await response.json() as OpenAICompletionResponse
      timing('response-json-end')
    }
    catch (error) { timing('response-json-failed', 'response-json-error'); throw error }
    stage = 'response-shape'
    const message = data.choices?.[0]?.message
    const text = typeof message?.content === 'string' ? message.content : ''
    if (metadata) Object.assign(metadata, { contentChars: text.length,
      reasoningChars: typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0,
      unsupportedContent: message?.content != null && typeof message.content !== 'string',
      finishReason: finishReason(data.choices?.[0]?.finish_reason) })
    const toolCalls = message?.tool_calls?.map(call => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }))

    if (onText && text) {
      timing('first-text')
      onText(text)
    }
    timing('result-ready')
    return toolCalls && toolCalls.length > 0
      ? { text, toolCalls }
      : { text }
  }
  catch (error) {
    timing('failed', stage === 'stream' ? 'stream-error' : error instanceof ProviderRequestError
      ? error.status === 0 ? 'fetch-error' : 'http-error'
      : stage === 'response-json' ? 'response-json-error' : stage === 'response-shape' ? 'response-shape-error' : 'provider-error')
    throw error
  }
  finally { if (request.onTiming) request.signal?.removeEventListener('abort', onAbort) }
}

async function readStream(response: Response, onText: (text: string) => void, metadata?: ResponseMetadata): Promise<ChatCompletionResult> {
  if (!response.body)
    throw new ProviderRequestError(response.status, 'Provider returned an empty stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  let text = ''
  let buffer = ''
  let dataLines: string[] = []
  let completed = false
  if (metadata) Object.assign(metadata, { contentChars: 0, reasoningChars: 0, contentDeltaCount: 0,
    reasoningDeltaCount: 0, streamEventCount: 0, doneReceived: false, unsupportedContent: false, finishReason: 'unknown' })

  function dispatch(): void {
    if (!dataLines.length)
      return
    const payload = dataLines.join('\n')
    dataLines = []
    if (payload === '[DONE]') {
      completed = true
      if (metadata) metadata.doneReceived = true
      return
    }
    let chunk: OpenAIStreamChunk
    try {
      chunk = JSON.parse(payload) as OpenAIStreamChunk
    }
    catch {
      throw new ProviderRequestError(response.status, 'Provider returned an invalid stream event')
    }
    if (chunk.error)
      throw new ProviderRequestError(response.status, chunk.error.message ?? 'Provider stream failed')
    if (metadata) {
      metadata.streamEventCount!++
      const choice = chunk.choices?.[0], reasoning = choice?.delta?.reasoning_content
      if (choice?.finish_reason != null) metadata.finishReason = finishReason(choice.finish_reason)
      if (typeof reasoning === 'string' && reasoning) { metadata.reasoningChars! += reasoning.length; metadata.reasoningDeltaCount!++ }
      if (choice?.delta?.content != null && typeof choice.delta.content !== 'string') metadata.unsupportedContent = true
    }
    const delta = chunk.choices?.[0]?.delta
    if (typeof delta?.content === 'string' && delta.content) {
      text += delta.content
      if (metadata) { metadata.contentChars = text.length; metadata.contentDeltaCount!++ }
      onText(text)
    }
    for (const part of delta?.tool_calls ?? []) {
      const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' }
      call.id += part.id ?? ''
      call.name += part.function?.name ?? ''
      call.arguments += part.function?.arguments ?? ''
      calls.set(part.index, call)
    }
  }

  function consume(chunk: string): void {
    buffer += chunk
    let end: number
    while (!completed && (end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '')
      buffer = buffer.slice(end + 1)
      if (!line) dispatch()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      consume(decoder.decode(value, { stream: true }))
      if (completed) break
    }
    if (!completed) {
      consume(decoder.decode())
      if (buffer) consume('\n')
      dispatch()
    }
  }
  finally {
    // DONE, parse failure and consumer refusal must all release the HTTP body.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  const toolCalls = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call)
  return toolCalls.length ? { text, toolCalls } : { text }
}

async function readErrorBody(response: Response, timing?: (event: ChatRequestTiming['event'], errorKind?: ChatRequestTiming['errorKind']) => void): Promise<string> {
  timing?.('response-json-start')
  try {
    const data = await response.json() as OpenAIErrorBody
    timing?.('response-json-end')
    return data.error?.message ?? ''
  }
  catch {
    timing?.('response-json-failed', 'response-json-error')
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
    async stream(request: ChatCompletionRequest, onText: (text: string) => void): Promise<ChatCompletionResult> {
      return openAIChatCompletion(options, request, onText)
    },
  }
}

export type { ToolCall }
