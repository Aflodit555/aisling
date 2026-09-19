/**
 * Hearing is a perception capability: audio enters, text leaves. It is split
 * into three boundaries that stay independent of each other:
 *
 *   Audio Source   (microphone / file / stream)  — lives in the app adapter
 *   Recognition    (HearingProvider)             — audio → transcript
 *   Hearing Adapter                              — transcript → Stimulus
 *
 * The core only owns the recognition provider contract; browser MediaRecorder
 * and friends never belong here.
 */

export interface RecognitionAudio {
  readonly data: ArrayBuffer
  readonly mimeType: string
  readonly fileName?: string
}

export interface RecognitionRequest {
  readonly audio: RecognitionAudio
  readonly language?: string
}

export interface Transcript {
  readonly text: string
}

/** Turns audio into a transcript. Implementation-agnostic. */
export interface HearingProvider {
  readonly id: string
  recognize(request: RecognitionRequest): Promise<Transcript>
}

/** The character's ability to listen. */
export interface HearingCapability {
  readonly kind: 'hearing'
  readonly provider: HearingProvider
}
