import {
  createCharacter,
  createCharacterRuntime,
  type Character,
  type CharacterRuntime,
  type ChatMessage,
  type ChatProvider,
  type Tool,
} from '@aisling/core'

const AISLING_PERSONA = [
  'You are Aisling, a calm and curious companion.',
  'Speak briefly and warmly; stay present with whoever is talking to you.',
].join(' ')

export function createAislingCharacter(): Character {
  return createCharacter({
    id: 'aisling',
    name: 'Aisling',
    persona: AISLING_PERSONA,
    capabilities: [],
  })
}

/**
 * Assembles the phase-1 Aisling runtime. The chat provider and the active
 * tools are resolved at turn time, so the app can hot-swap mock ↔ real
 * providers (and mount/unmount the web-search tool) without recreating the
 * runtime.
 */
export function createAislingRuntime(deps: {
  getChatProvider: () => ChatProvider | undefined
  getTools: () => readonly Tool[]
  /** Seed conversation context (restored history). */
  history?: ChatMessage[]
}): CharacterRuntime {
  return createCharacterRuntime({
    character: createAislingCharacter(),
    getChatProvider: deps.getChatProvider,
    getTools: deps.getTools,
    history: deps.history,
  })
}
