import { createVisualStimulus, type Stimulus } from '@aisling/core'

/**
 * Vision Adapter: an already-computed observation (plus optional caption)
 * becomes a `VisualStimulus`, so it enters the same runtime chain as text and
 * hearing — never a separate vision-message flow.
 */
export function createWebVisualStimulus(observation: string, caption?: string): Stimulus {
  return createVisualStimulus({ source: 'web', observation, caption })
}
