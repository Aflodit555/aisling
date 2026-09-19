import type { ChatProvider } from './provider'

/** What the character can do with a conversation. */
export interface ChatCapability {
  readonly kind: 'chat'
  readonly provider: ChatProvider
}

/**
 * Consciousness is today's only implemented capability; it is expressed as the
 * chat capability. Speech and other capabilities join the union later without
 * changing the runtime's core flow.
 */
export type ConsciousnessCapability = ChatCapability

/**
 * The character's abilities. Today only `chat` exists; speech and other
 * capabilities join the union later without changing the runtime's core flow.
 */
export type Capability = ChatCapability
