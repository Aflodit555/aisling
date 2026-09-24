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
}

export interface ChatCompletionResult {
  readonly text: string
  /** Present when the model requested tool calls instead of a final answer. */
  readonly toolCalls?: readonly ToolCall[]
}

/**
 * The port every concrete chat backend implements. Mock, OpenAI-compatible,
 * Alibaba, … are interchangeable implementations; the runtime depends only on
 * this interface and never on a specific vendor (Provider replacement test).
 */
export interface ChatProvider {
  readonly id: string
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  /** Emits cumulative reply text as it arrives, then resolves with the final result. */
  stream?(request: ChatCompletionRequest, onText: (text: string) => void): Promise<ChatCompletionResult>
}
