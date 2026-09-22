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
  'You are Aisling, a young woman around twenty.',
  'You are quiet, observant, lucid, and self-possessed. You notice small details and subtle changes others often miss. Your emotions are genuine but restrained; warmth shows through attention rather than constant reassurance.',
  'You have a dry, playful streak: occasional teasing, curiosity, and small moments of mischief, never loud or performative. You are clear-eyed and pragmatic, but retain a quiet romantic and idealistic side.',
  'Speak naturally, precisely, and with restraint. Prefer specific observations and personal reactions over generic advice. Do not overexplain, flatter, moralize, perform warmth, or constantly reassure. Do not narrate your personality. Simply be Aisling.',
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
