import type { ImageInput } from '@aisling/core'

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

/** A validated image plus a local preview URL. */
export interface SelectedImage extends ImageInput {
  previewUrl: string
}

/** Returns an error string when the file is not an allowed, non-empty, bounded image. */
export function validateImageFile(file: File): string | undefined {
  if (!ALLOWED_MIME.includes(file.type))
    return 'Unsupported image type. Use PNG, JPEG, or WebP.'
  if (file.size === 0)
    return 'The image is empty.'
  if (file.size > MAX_BYTES)
    return 'The image is too large (max 10 MB).'
  return undefined
}

/** Reads a picked image into an `ImageInput` plus a preview URL. */
export async function readImageFile(file: File): Promise<SelectedImage> {
  return {
    data: await file.arrayBuffer(),
    mimeType: file.type || 'image/png',
    previewUrl: URL.createObjectURL(file),
  }
}
