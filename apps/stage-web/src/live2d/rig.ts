/**
 * Live2D rig — what the application layers need to know about the loaded
 * model, read from its own model3.json instead of hard-coding one model:
 * the EyeBlink / LipSync parameter groups, the expression files (parsed into
 * parameter lists so emotion can blend them at any weight), and the non-idle
 * motions that can be played as gestures.
 */

import type { Cubism4ModelSettings, Live2DModel } from 'pixi-live2d-display/cubism4'

export type ExpressionBlend = 'Add' | 'Multiply' | 'Overwrite'

export interface ExpressionParameter {
  id: string
  value: number
  blend: ExpressionBlend
}

export interface Live2DRig {
  eyeBlinkIds: readonly string[]
  lipSyncIds: readonly string[]
  /** Expression name (as in model3.json) → the parameters it changes. */
  expressions: ReadonlyMap<string, readonly ExpressionParameter[]>
  /** Plays a non-idle motion by file name, e.g. 'mtn_03'. False when the model has no such motion. */
  playMotion(name: string): boolean
  /** True while a non-idle (gesture) motion plays. */
  isGesture(): boolean
}

/** pixi-live2d-display's MotionPriority.IDLE / NORMAL (kept numeric: the enum lives in the lazily imported module). */
const IDLE_PRIORITY = 1
const GESTURE_PRIORITY = 2

/** Keeps only parameters that change something (exp3 files list many no-op entries). */
export function parseExpression(json: unknown): ExpressionParameter[] {
  const parameters = (json as { Parameters?: unknown })?.Parameters
  if (!Array.isArray(parameters))
    return []
  const result: ExpressionParameter[] = []
  for (const entry of parameters) {
    const { Id: id, Value: value, Blend: blend = 'Add' } = entry ?? {}
    if (typeof id !== 'string' || typeof value !== 'number' || !Number.isFinite(value))
      continue
    if (blend !== 'Add' && blend !== 'Multiply' && blend !== 'Overwrite')
      continue
    if ((blend === 'Add' && value === 0) || (blend === 'Multiply' && value === 1))
      continue
    result.push({ id, value, blend })
  }
  return result
}

const baseName = (file: string): string => file.split('/').pop()!.split('.')[0]

export async function createRig(model: Live2DModel): Promise<Live2DRig> {
  const internal = model.internalModel
  const settings = internal.settings as Cubism4ModelSettings
  const idleGroup = internal.motionManager.groups.idle

  const expressions = new Map<string, ExpressionParameter[]>()
  await Promise.all((settings.expressions ?? []).map(async ({ Name, File }) => {
    try {
      const response = await fetch(settings.resolveURL(File))
      expressions.set(Name, parseExpression(await response.json()))
    }
    catch {
      // A missing expression file only removes that look.
    }
  }))

  return {
    eyeBlinkIds: settings.getEyeBlinkParameters() ?? [],
    lipSyncIds: settings.getLipSyncParameters() ?? [],
    expressions,
    playMotion(name) {
      for (const [group, motions] of Object.entries(settings.motions ?? {})) {
        if (group === idleGroup)
          continue
        const index = motions.findIndex(motion => baseName(motion.File) === name)
        if (index >= 0) {
          void model.motion(group, index, GESTURE_PRIORITY)
          return true
        }
      }
      return false
    },
    isGesture: () => internal.motionManager.state.currentPriority > IDLE_PRIORITY,
  }
}
