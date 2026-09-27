export const LIVE2D_MODEL_URL = import.meta.env.VITE_LIVE2D_MODEL_URL?.trim()
  || '/live2d/mao/mao_pro.model3.json'

export const CUBISM_CORE_URL = import.meta.env.VITE_CUBISM_CORE_URL?.trim()
  || '/live2d/live2dcubismcore.min.js'

/** Fallback lip-sync parameter when the model declares no LipSync group (Mao uses ParamA). */
export const MOUTH_OPEN_PARAMETER = 'ParamMouthOpenY'

/**
 * Application-layer parameter source priorities, applied lowest first on top
 * of the native motion: each layer sees the result of the ones below it.
 * Speech owns the mouth above everything.
 */
export const PARAMETER_SOURCE_PRIORITY = {
  manual: 10,
  idle: 20,
  emotion: 30,
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
  scale: { min: 2 / 3, max: 1.5, step: 'any' },
  offset: { step: 1 },
} as const

export const DESKTOP_ENTRANCE_OVERSHOOT = 18

export interface StageCharacterLayout {
  width: number
  height: number
  centerX: number
  body: { x: number; y: number; width: number; height: number }
  envelope: { x: number; y: number; width: number; height: number }
}

/** The renderer's bottom edge is the virtual taskbar. Manual zoom is relative to auto-fit. */
export function fitStageCharacter(layout: StageCharacterLayout, input: CharacterDisplayTransform) {
  const { width, height, body, envelope } = layout
  // Include hidden effect meshes as well as room for head/body motion, at every zoom level.
  const headroom = Math.max(0, body.y - envelope.y) + body.height * 0.06
  const horizontal = Math.max(body.width * 1.15, envelope.width)
  const liftBudget = height * 0.10
  // Reserve effects once, plus usable lift space, rather than shrinking the full
  // body to pay for the largest zoom's headroom in advance.
  const autoScale = Math.min(width / horizontal, (height - liftBudget) / (body.height + headroom))
  const standingHeight = body.height * autoScale
  const scale = Math.min(CHARACTER_DISPLAY_LIMITS.scale.max, Math.max(CHARACTER_DISPLAY_LIMITS.scale.min, input.scale))
  const referenceZoom = 1.25
  const maxScale = Math.min(autoScale * referenceZoom / CHARACTER_DISPLAY_LIMITS.scale.min,
    (height - liftBudget) / (body.height / 2 + headroom))
  const fraction = (scale - CHARACTER_DISPLAY_LIMITS.scale.min)
    / (referenceZoom - CHARACTER_DISPLAY_LIMITS.scale.min)
  // Preserve the existing 67–125% sizes; extend 150% to 1.2 times the old maximum.
  const renderedScale = scale <= referenceZoom
    ? autoScale + (maxScale - autoScale) * fraction
    : maxScale * scale / referenceZoom
  const top = Math.min(Math.max(height - standingHeight, headroom * renderedScale + liftBudget),
    height - body.height * renderedScale / 2)
  const clearance = Math.max(0, top - headroom * renderedScale)
  const previousMinY = -Math.min(height * 0.18, clearance)
  // The Stage has no upper effect boundary. Allow the feet to reach the bar
  // at every zoom, while keeping the minimum-size display exactly as before.
  const minY = scale === CHARACTER_DISPLAY_LIMITS.scale.min ? previousMinY
    : Math.min(previousMinY, height - body.height * renderedScale - top)
  const offsetY = Math.min(0, Math.max(minY, input.offsetY))
  return {
    transform: { scale, offsetX: 0, offsetY },
    limits: { scale: { min: CHARACTER_DISPLAY_LIMITS.scale.min, max: CHARACTER_DISPLAY_LIMITS.scale.max }, offset: { min: minY, max: 0 } },
    scale: renderedScale,
    // These coordinates place the body bounds; the renderer accounts for its canvas anchor.
    x: width / 2 - layout.centerX * renderedScale,
    y: top + offsetY - body.y * renderedScale,
  }
}

/** Inherit Stage pixels and taskbar offset; grow the window instead of shrinking the model. */
export function fitDesktopCharacter(viewport: { width: number; height: number }, stage: StageCharacterLayout, input: CharacterDisplayTransform) {
  const fitted = fitStageCharacter(stage, input)
  const { body, envelope, centerX } = stage
  const margin = body.height * fitted.scale * 0.06 + DESKTOP_ENTRANCE_OVERSHOOT
  const y = viewport.height - stage.height + fitted.y
  return {
    ...fitted,
    x: viewport.width / 2 - centerX * fitted.scale,
    y,
    windowWidth: Math.ceil(Math.max(360, 2 * Math.max(centerX - envelope.x, envelope.x + envelope.width - centerX) * fitted.scale + 2 * margin)),
    windowHeight: Math.ceil(Math.max(460, stage.height - fitted.y - envelope.y * fitted.scale + margin)),
    canvasHeight: Math.ceil(Math.max(viewport.height + DESKTOP_ENTRANCE_OVERSHOOT,
      y + (envelope.y + envelope.height + body.height * 0.12) * fitted.scale)),
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
    offsetX: 0,
    offsetY: clamp(input.offsetY, 0, -Number.MAX_SAFE_INTEGER, 0),
  }
}
