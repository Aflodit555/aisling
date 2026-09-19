import { createUserTextStimulus, type Stimulus } from '@aisling/core'

/**
 * Adapter that turns web input into the platform's `Stimulus` contract.
 * Replacing this source with Bilibili or another source only changes this
 * adapter, never Character Core (Input replacement test).
 */
export function createWebTextStimulus(text: string): Stimulus {
  return createUserTextStimulus({ source: 'web', text })
}
