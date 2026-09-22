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

/**
 * Describes the audio a streaming provider produces. This is what the playback
 * layer matches against — the Speech Runtime never inspects codecs or vendors.
 *
 * `kind` describes the data/framing, not the transport: a network chunk is
 * never assumed to be a complete audio frame.
 */
export type SpeechStreamKind = 'encoded' | 'pcm'

export interface SpeechStreamDescriptor {
  readonly kind: SpeechStreamKind
  /** Container/codec MIME type for `encoded` streams (e.g. audio/mpeg). */
  readonly mimeType?: string
  /** Sample rate in Hz for `pcm` streams. */
  readonly sampleRate?: number
  /** Channel count for `pcm` streams. */
  readonly channels?: number
}

/**
 * Sink for a streaming provider. The provider owns producing encoded audio
 * bytes; it never touches playback. `onEnd` means "provider finished producing",
 * which is deliberately not the same as "playback finished".
 */
export interface SpeechStreamSink {
  /** First audio bytes are available (the provider has started producing). */
  onStart?(): void
  /** A chunk of encoded audio bytes — not necessarily a frame boundary. */
  onAudio?(chunk: Uint8Array): void
  /** The provider finished producing audio. */
  onEnd?(): void
  onError?(error: Error): void
}

/** A provider's streaming capability: what it produces, and how to stream it. */
export interface SpeechStreamCapability {
  readonly descriptor: SpeechStreamDescriptor
  stream(request: SpeechRequest, sink: SpeechStreamSink): Promise<void>
}

/** Generates speech audio from text. Implementation-agnostic; playback is separate. */
export interface SpeechProvider {
  readonly id: string
  /** One-shot synthesis (or direct native speech via `SpeechResult.spoken`). */
  synthesize(request: SpeechRequest): Promise<SpeechResult>
  /** Present only when the provider can stream audio. */
  stream?: SpeechStreamCapability
  /**
   * True when `synthesize` speaks directly (e.g. speechSynthesis) and returns no
   * audio bytes. The audible period is the `synthesize` call itself.
   */
  speaksDirectly?: boolean
}

/** The character's ability to speak. */
export interface SpeechCapability {
  readonly kind: 'speech'
  readonly provider: SpeechProvider
}
