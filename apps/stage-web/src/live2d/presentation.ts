export const LIVE2D_MODEL_URL = import.meta.env.VITE_LIVE2D_MODEL_URL?.trim()
  || '/live2d/aisling/aisling.model3.json'

export const CUBISM_CORE_URL = import.meta.env.VITE_CUBISM_CORE_URL?.trim()
  || '/live2d/live2dcubismcore.min.js'

/** Standard Live2D lip-sync parameter (Hiyori "LipSync" group). */
export const MOUTH_OPEN_PARAMETER = 'ParamMouthOpenY'

/**
 * Application-layer parameter source priorities. Higher wins when two sources
 * claim the same parameter. Speech owns the mouth above any future
 * expression/motion source; manual pose sits just above the native (unregistered)
 * model value.
 */
export const PARAMETER_SOURCE_PRIORITY = {
  manual: 10,
  speech: 100,
} as const

export interface CharacterDisplayTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export const DEFAULT_CHARACTER_DISPLAY_TRANSFORM: CharacterDisplayTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
}

export const CHARACTER_DISPLAY_LIMITS = {
  scale: { min: 0.5, max: 1.5, step: 0.05 },
  offset: { min: -240, max: 240, step: 1 },
} as const

export function fitLive2DModel(
  viewport: { width: number; height: number },
  model: { width: number; height: number },
): { scale: number; x: number; y: number } {
  const scale = model.width > 0 && model.height > 0
    ? Math.min(viewport.width / model.width, viewport.height / model.height) * 0.92
    : 1

  return { scale, x: viewport.width / 2, y: viewport.height / 2 }
}

export function applyCharacterDisplayTransform(
  fitted: { scale: number; x: number; y: number },
  transform: CharacterDisplayTransform,
): { scale: number; x: number; y: number } {
  return {
    scale: fitted.scale * transform.scale,
    x: fitted.x + transform.offsetX,
    y: fitted.y + transform.offsetY,
  }
}

export function normalizeCharacterDisplayTransform(value: unknown): CharacterDisplayTransform {
  const input = value && typeof value === 'object' ? value as Partial<CharacterDisplayTransform> : {}
  const clamp = (candidate: unknown, fallback: number, min: number, max: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, candidate))
      : fallback

  return {
    scale: clamp(input.scale, 1, CHARACTER_DISPLAY_LIMITS.scale.min, CHARACTER_DISPLAY_LIMITS.scale.max),
    offsetX: clamp(input.offsetX, 0, CHARACTER_DISPLAY_LIMITS.offset.min, CHARACTER_DISPLAY_LIMITS.offset.max),
    offsetY: clamp(input.offsetY, 0, CHARACTER_DISPLAY_LIMITS.offset.min, CHARACTER_DISPLAY_LIMITS.offset.max),
  }
}
