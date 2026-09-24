/**
 * Emotion look — maps the stable emotion weights onto the model.
 *
 * Each emotion is one of Mao's own expressions (blended at the emotion's
 * weight with Cubism's Add / Multiply / Overwrite rules, so intensity and
 * cross-fades come for free) plus a gaze/posture offset, and optionally a
 * gesture motion played once when the emotion is entered strongly.
 *
 * Mao expressions and why each emotion uses the one it does:
 *   exp_02  eyes closed in a smile                          → joy
 *   exp_05  brows knit and lowered, mouth corners down      → sad
 *   exp_08  narrowed eyes, pouting mouth                    → angry
 *   exp_07  eyes wide, pupils shrunk, brows up, mouth down  → surprised
 *   exp_06  blush, brows knit                               → shy
 * Unused: exp_01 (all-zero reset, i.e. neutral), exp_03 (plain closed eyes),
 * exp_04 (wide sparkling smile — the same emotion as exp_02 at another
 * intensity; one look per emotion keeps intensity a single axis).
 */

import type { Emotion, EmotionWeights } from '../presentation/emotion-state'
import type { ParameterSource } from './parameter-controller'
import type { ExpressionParameter, Live2DRig } from './rig'

export interface EmotionLook {
  /** Model expression shown at the emotion's weight. */
  expression: string
  /** Additive gaze / posture offsets at full weight. */
  pose: Readonly<Record<string, number>>
  /** Gesture motion (file name) played once when the emotion is entered strongly. */
  gesture?: string
}

export const MAO_LOOKS: Readonly<Record<Emotion, EmotionLook>> = {
  joy: { expression: 'exp_02', pose: { ParamAngleZ: 6, ParamAngleY: 4, ParamBodyAngleZ: 3 }, gesture: 'mtn_03' },
  sad: { expression: 'exp_05', pose: { ParamAngleY: -12, ParamAngleZ: -3, ParamEyeBallY: -0.45 } },
  angry: { expression: 'exp_08', pose: { ParamAngleX: -14, ParamAngleY: -3, ParamEyeBallX: -0.4 } },
  surprised: { expression: 'exp_07', pose: { ParamAngleY: 8, ParamBodyAngleX: -3 } },
  shy: { expression: 'exp_06', pose: { ParamAngleX: 8, ParamAngleY: -8, ParamAngleZ: 6, ParamEyeBallX: 0.45, ParamEyeBallY: -0.35 } },
}

/** Evidence strength (intensity × confidence) needed on entry to also play the gesture. */
export const GESTURE_MIN_STRENGTH = 0.6

/** Cubism expression blending at a partial weight. */
export function blendExpression(value: number, parameter: ExpressionParameter, weight: number): number {
  if (parameter.blend === 'Multiply')
    return value * (1 + (parameter.value - 1) * weight)
  if (parameter.blend === 'Overwrite')
    return value + (parameter.value - value) * weight
  return value + parameter.value * weight
}

const SILENT = 0.001

export function createEmotionLayer(options: {
  rig: Live2DRig
  looks: Readonly<Record<Emotion, EmotionLook>>
  weights: () => Readonly<EmotionWeights>
  priority: number
}): ParameterSource {
  const looks = Object.entries(options.looks) as [Emotion, EmotionLook][]
  const layers = looks.map(([emotion, look]) => ({
    emotion,
    expression: options.rig.expressions.get(look.expression) ?? [],
    pose: Object.entries(look.pose),
  }))
  const targets = new Set(layers.flatMap(layer => [...layer.expression.map(p => p.id), ...layer.pose.map(([id]) => id)]))

  return {
    id: 'emotion',
    priority: options.priority,
    targets,
    sample: ({ readBase }) => {
      const weights = options.weights()
      if (layers.every(layer => weights[layer.emotion] < SILENT))
        return undefined
      const claims = new Map<string, number>()
      const read = (id: string) => claims.get(id) ?? readBase(id)
      for (const layer of layers) {
        const weight = weights[layer.emotion]
        if (weight < SILENT)
          continue
        for (const parameter of layer.expression)
          claims.set(parameter.id, blendExpression(read(parameter.id), parameter, weight))
        for (const [id, offset] of layer.pose)
          claims.set(id, read(id) + offset * weight)
      }
      return claims
    },
  }
}
