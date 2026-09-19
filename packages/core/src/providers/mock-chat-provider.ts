import type { ChatCompletionRequest, ChatCompletionResult, ChatProvider } from '../provider'

export interface MockChatProviderOptions {
  /** Extra latency to emulate a real backend and surface the "thinking" state. */
  delayMs?: number
  /** Identifier reported on `provider:called` events. */
  id?: string
}

/**
 * Deterministic chat provider used to prove the platform boundary, not to
 * simulate intelligence. It echoes the last user message with an explicit
 * mock marker so every reply is traceable to this provider.
 */
export function createMockChatProvider(options: MockChatProviderOptions = {}): ChatProvider {
  const delayMs = options.delayMs ?? 0
  const id = options.id ?? 'mock'

  async function complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    if (delayMs > 0)
      await new Promise<void>(resolve => setTimeout(resolve, delayMs))

    const lastUser = [...request.messages].reverse().find(message => message.role === 'user')
    const userText = lastUser && typeof lastUser.content === 'string' ? lastUser.content : ''
    const text = userText
      ? `I'm here. (mock) You said: “${userText}”`
      : 'I’m here. (mock)'

    return { text }
  }

  return { id, complete }
}
