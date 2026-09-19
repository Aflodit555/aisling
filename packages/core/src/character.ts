import type { Capability, ChatCapability } from './capability'

/** A playable character: identity plus the abilities it can perform. */
export interface Character {
  readonly id: string
  readonly name: string
  /** System-level persona injected as the leading chat message. */
  readonly persona: string
  readonly capabilities: readonly Capability[]
}

export interface CharacterInput {
  id: string
  name: string
  persona: string
  capabilities: readonly Capability[]
}

export function createCharacter(input: CharacterInput): Character {
  return { ...input }
}

/** Returns the character's chat capability, if it has one. */
export function findChatCapability(character: Character): ChatCapability | undefined {
  return character.capabilities.find(
    (capability): capability is ChatCapability => capability.kind === 'chat',
  )
}
