/**
 * Vision is a perception capability: an image enters, a textual observation
 * leaves. Like Hearing, it is split into boundaries that stay independent:
 *
 *   Image Source    (file picker / future camera)  — lives in the app adapter
 *   Vision Provider (VisionProvider)               — image → observation text
 *   Vision Adapter                                  — observation → Stimulus
 *
 * The core only owns the provider contract; DOM File / HTMLInputElement never
 * belong here.
 */

export interface ImageInput {
  readonly data: ArrayBuffer
  readonly mimeType: string
}

export interface VisionRequest {
  readonly image: ImageInput
  readonly prompt?: string
}

export interface VisualObservation {
  readonly text: string
}

/** Turns an image into a textual description of what it shows. */
export interface VisionProvider {
  readonly id: string
  analyze(request: VisionRequest): Promise<VisualObservation>
}

/** The character's ability to see. */
export interface VisionCapability {
  readonly kind: 'vision'
  readonly provider: VisionProvider
}
