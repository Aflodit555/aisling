/** A character's reply as plain text — the only output kind produced today. */
export interface TextOutput {
  readonly kind: 'text'
  readonly text: string
}

/**
 * Everything a character can emit after processing a stimulus.
 *
 * Phase 1 produces only `text`. Future renderers (speech, expression, motion)
 * join this union as new members; neither `Stimulus` nor Character Core has
 * to be redesigned to add them (Renderer extension test).
 */
export type CharacterOutput = TextOutput

/** Convenience constructor for a text output. */
export function createTextOutput(text: string): TextOutput {
  return { kind: 'text', text }
}
