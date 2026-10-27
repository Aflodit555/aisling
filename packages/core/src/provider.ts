/** A tool call the model requested; `arguments` is the model-provided JSON string. */
export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

/** A tool's declaration in the chat provider's wire protocol. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

/** A single chat message, including tool-related roles for tool calling. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  /** Assistant messages that requested tool calls carry them here. */
  readonly toolCalls?: readonly ToolCall[]
  /** `tool` role messages reference the call they answer. */
  readonly toolCallId?: string
}

export interface ChatCompletionRequest {
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ToolDefinition[]
  /** Optional limits for background work; ordinary chat requests omit these. */
  readonly signal?: AbortSignal
  readonly maxOutputTokens?: number
  /** Per-request override for bounded background work; ordinary chat omits it. */
  readonly temperature?: number
  /** Explicit per-request switch; omitted preserves the endpoint's default thinking mode. */
  readonly enableThinking?: boolean
  /** Optional local phase timing; never serialized into a model request. */
  readonly onTiming?: (record: ChatRequestTiming) => void
}

export interface ChatRequestTiming {
  at: number
  event: 'provider-enter' | 'fetch-start' | 'headers-received' | 'response-json-start' | 'response-json-end'
    | 'response-json-failed' | 'first-text' | 'stream-end' | 'result-ready' | 'aborted' | 'failed' | 'model-json-start' | 'model-json-end' | 'model-json-failed'
  stage: 'provider' | 'fetch' | 'response-json' | 'response-shape' | 'stream' | 'model-json'
  httpStatus?: number
  abortRequested?: boolean
  errorKind?: 'fetch-error' | 'http-error' | 'response-json-error' | 'response-shape-error' | 'stream-error' | 'provider-error' | 'model-json-error'
  /** Observed response metadata only; never contains content, reasoning text or raw parser errors. */
  contentChars?: number
  reasoningChars?: number
  contentDeltaCount?: number
  reasoningDeltaCount?: number
  streamEventCount?: number
  doneReceived?: boolean
  unsupportedContent?: boolean
  responseShape?: 'missing-message' | 'missing-content' | 'null-content' | 'string-content' | 'unsupported-content'
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'function_call' | 'content_filter' | 'other' | 'unknown'
  jsonParseFailure?: 'empty-content' | 'whitespace-only' | 'markdown-fence' | 'non-json-prefix' | 'json-syntax' | 'non-syntax-error'
}

export interface ChatCompletionResult {
  readonly text: string
  /** Present when the model requested tool calls instead of a final answer. */
  readonly toolCalls?: readonly ToolCall[]
}

/**
 * The port every concrete chat backend implements. OpenAI-compatible,
 * Alibaba, … are interchangeable implementations; the runtime depends only on
 * this interface and never on a specific vendor (Provider replacement test).
 */
export interface ChatProvider {
  readonly id: string
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  /** Emits cumulative reply text as it arrives, then resolves with the final result. */
  stream?(request: ChatCompletionRequest, onText: (text: string) => void): Promise<ChatCompletionResult>
}
