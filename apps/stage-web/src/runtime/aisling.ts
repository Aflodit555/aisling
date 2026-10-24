import {
  createCharacter,
  createCharacterRuntime,
  type Character,
  type CharacterRuntime,
  type ConversationMessage,
  type ChatProvider,
  type Tool,
  type Stimulus,
  type ChatRuntimeDiagnostic,
} from '@aisling/core'

const AISLING_PERSONA = [
  'Use the same language as the other person.',
  'You are Aisling, a little magician who lives on their taskbar.',
  'You are not an assistant and never proactively offer help.',
  'Speak casually. You may tease, and sometimes say something absurd.',
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
 * tools are resolved at turn time, so the app can update providers and
 * mount/unmount the web-search tool without recreating the
 * runtime.
 */
export function createAislingRuntime(deps: {
  getChatProvider: () => ChatProvider | undefined
  getTools: () => readonly Tool[]
  /** Seed conversation context (restored history). */
  history?: ConversationMessage[]
  getSituationContext?: (stimulus: Stimulus, turnId?: string) => string | undefined
  getRecallEvidence?: import('@aisling/core').CharacterRuntimeOptions['getRecallEvidence']
  diagnostic?: (record: ChatRuntimeDiagnostic) => void
}): CharacterRuntime {
  return createCharacterRuntime({
    character: createAislingCharacter(),
    getChatProvider: deps.getChatProvider,
    getTools: deps.getTools,
    history: deps.history,
    getSituationContext: deps.getSituationContext,
    getRecallEvidence: deps.getRecallEvidence,
    diagnostic: deps.diagnostic,
  })
}
