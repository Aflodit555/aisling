/**
 * Speech is an expression capability: it turns character text into audio for
 * the world to hear. It is deliberately separate from Consciousness (thinking)
 * and from playback (a renderer concern), so a future output channel (VTS,
 * OBS, an external device) can consume the same provider without changes.
 */

export interface SpeechRequest {
  readonly text: string
  readonly voice?: string
}

/** Audio produced by a speech provider: either a URL or raw bytes. */
export type SpeechAudio =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'bytes'; readonly data: ArrayBuffer; readonly mimeType: string }

export interface SpeechResult {
  /** Generated audio, when the provider returns audio for the playback layer. */
  readonly audio?: SpeechAudio
  /** True when the provider already spoke the text directly (e.g. speechSynthesis). */
  readonly spoken?: boolean
}

/** Generates speech audio from text. Implementation-agnostic; playback is separate. */
export interface SpeechProvider {
  readonly id: string
  synthesize(request: SpeechRequest): Promise<SpeechResult>
}

/** The character's ability to speak. */
export interface SpeechCapability {
  readonly kind: 'speech'
  readonly provider: SpeechProvider
}
