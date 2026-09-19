import type { ToolDefinition } from './provider'

/**
 * Minimal tool domain: a `Tool` is a named capability the character can invoke
 * (web search, later calculator/files/code). It is NOT an agent framework —
 * there is no planning, memory, or multi-agent loop here.
 */

export interface Tool {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  run(args: Readonly<Record<string, unknown>>): Promise<string>
}

/** The character's ability to use tools. */
export interface ToolCapability {
  readonly kind: 'tool'
  readonly tools: readonly Tool[]
}

/** Maps a domain `Tool` onto the chat provider's wire declaration. */
export function toToolDefinition(tool: Tool): ToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}
