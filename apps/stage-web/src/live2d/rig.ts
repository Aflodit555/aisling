/**
 * Live2D rig — what the application layers need to know about the loaded
 * model, read from its own model3.json instead of hard-coding one model:
 * the EyeBlink / LipSync parameter groups, the expression files (parsed into
 * parameter lists so emotion can blend them at any weight), and the non-idle
 * motions that can be played as gestures.
 */

import type { Cubism4InternalModel, Cubism4ModelSettings, Live2DModel } from 'pixi-live2d-display/cubism4'

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
  /** Plays once; emotion can interrupt a click, while clicks never interrupt a gesture. */
  playMotion(name: string, reason?: 'interaction' | 'emotion'): Promise<boolean>
  /** Visits every available gesture before refilling, without consecutive repeats. */
  playRandomMotion(): Promise<boolean>
  /** Includes a gesture being started, so parameter layers yield before its first frame. */
  isGesture(): boolean
}

/** pixi-live2d-display's MotionPriority.IDLE / NORMAL (kept numeric: the enum lives in the lazily imported module). */
const IDLE_PRIORITY = 1
const GESTURE_PRIORITY = 2
const EMOTION_PRIORITY = 3

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

export async function createRig(model: Live2DModel, random = Math.random): Promise<Live2DRig> {
  const internal = model.internalModel as Cubism4InternalModel
  const settings = internal.settings as Cubism4ModelSettings
  const manager = internal.motionManager
  const idleGroup = manager.groups.idle

  // Mao's hit-area names are empty; using the IDs keeps head and body distinct.
  internal.hitAreas = Object.fromEntries((settings.hitAreas ?? []).flatMap(area => {
    const index = internal.getDrawableIndex(area.Id)
    const name = area.Name || area.Id
    return index >= 0 ? [[name, { id: area.Id, name, index }]] : []
  }))

  const motions = new Map<string, { group: string; index: number }>()
  await Promise.all(Object.entries(settings.motions ?? {}).flatMap(([group, definitions]) =>
    group === idleGroup ? [] : definitions.map(async (definition, index) => {
      try {
        const motion = await manager.loadMotion(group, index)
        if (motion) {
          motion.setIsLoop(false)
          motions.set(baseName(definition.File), { group, index })
        }
      }
      catch { /* A missing gesture does not prevent the character from loading. */ }
    })))

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

  let pendingPriority = 0
  let revision = 0
  let lastMotion: string | undefined
  let remaining: string[] = []
  const priorityNow = () => Math.max(pendingPriority, manager.state.currentPriority, manager.state.reservePriority)

  async function playMotion(name: string, reason: 'interaction' | 'emotion' = 'interaction'): Promise<boolean> {
    const motion = motions.get(name)
    const priority = reason === 'emotion' ? EMOTION_PRIORITY : GESTURE_PRIORITY
    if (!motion || manager.destroyed || priority <= priorityNow())
      return false
    const ticket = ++revision
    pendingPriority = priority
    try {
      const started = await model.motion(motion.group, motion.index, priority)
      if (started) {
        lastMotion = name
        const index = remaining.indexOf(name)
        if (index >= 0)
          remaining.splice(index, 1)
      }
      return started
    }
    catch {
      return false
    }
    finally {
      if (ticket === revision) {
        pendingPriority = 0
        if (manager.state.reservedGroup === motion.group && manager.state.reservedIndex === motion.index)
          manager.state.setReserved(undefined, undefined, 0)
      }
    }
  }

  return {
    eyeBlinkIds: settings.getEyeBlinkParameters() ?? [],
    lipSyncIds: settings.getLipSyncParameters() ?? [],
    expressions,
    playMotion,
    async playRandomMotion() {
      if (manager.destroyed || priorityNow() > IDLE_PRIORITY || !motions.size)
        return false
      if (!remaining.length)
        remaining = [...motions.keys()]
      const choices = remaining.filter(name => name !== lastMotion)
      const candidates = choices.length ? choices : remaining
      const name = candidates[Math.floor(random() * candidates.length)]!
      return playMotion(name)
    },
    isGesture: () => priorityNow() > IDLE_PRIORITY,
  }
}
