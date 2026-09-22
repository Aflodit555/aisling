/**
 * Mouth visual mapping — model-level calibration between the normalized mouth
 * signal (0..1) and the `ParamMouthOpenY` value written to the Live2D model.
 *
 * The Mouth Signal / Mouth Controller already produce a correct *logical*
 * openness; this layer only compensates for the Hiyori model's visually weak
 * response. It applies a concave curve (exponent < 1 lifts low–mid levels so
 * quiet speech stays visible) plus a modest gain, then clamps to the model's
 * parameter ceiling. Strong speech therefore approaches — but does not sit at —
 * full openness, instead of being pinned at 1.0.
 *
 * This is a pure value transform: it knows nothing about audio, providers,
 * ownership, Cubism or any specific parameter name.
 */

export interface MouthVisualMappingConfig {
  /** Concave exponent; < 1 lifts low–mid levels for visible openness. */
  exponent: number
  /** Linear gain applied after the curve. */
  gain: number
  /** Output ceiling (the model ParamMouthOpenY max). */
  max: number
}

/**
 * Chosen against the current Mouth Signal (reference 0.25, output floor 0.06):
 * a weak-but-voiced level of ~0.06–0.15 should still be visibly open, normal
 * speech (~0.3–0.6) should be clearly open, and only very loud speech should
 * reach the ceiling.
 */
export const DEFAULT_MOUTH_VISUAL_MAPPING: MouthVisualMappingConfig = {
  exponent: 0.6,
  gain: 1.1,
  max: 1,
}

export function mapMouthOpenness(
  level: number,
  config: Partial<MouthVisualMappingConfig> = {},
): number {
  const { exponent, gain, max } = { ...DEFAULT_MOUTH_VISUAL_MAPPING, ...config }
  if (!Number.isFinite(level))
    return 0

  const clamped = Math.min(1, Math.max(0, level))
  const exponentSafe = exponent > 0 ? exponent : 1
  const curved = Math.pow(clamped, exponentSafe)
  const scaled = curved * (Number.isFinite(gain) ? gain : 1)
  const ceiling = Number.isFinite(max) && max > 0 ? max : 1
  return Math.min(ceiling, Math.max(0, scaled))
}
