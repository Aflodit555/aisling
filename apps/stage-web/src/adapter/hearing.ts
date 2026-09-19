import { createUserTextStimulus, type Stimulus } from '@aisling/core'

/**
 * Hearing Adapter: transcript → Stimulus. A spoken utterance becomes a normal
 * `UserTextStimulus` (source `microphone`), so it enters the exact same Runtime
 * main chain as web text — no separate voice-message flow exists.
 */
export function createHearingStimulus(transcript: string): Stimulus {
  return createUserTextStimulus({
    source: 'microphone',
    text: transcript,
    meta: { inputMode: 'speech' },
  })
}
