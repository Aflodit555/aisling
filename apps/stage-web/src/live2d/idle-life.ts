/**
 * Idle life — small, irregular movement layered over the looping Idle motion.
 *
 * Mao's Idle motion bakes one blink into a fixed 5.6 s loop and never moves the
 * eyeballs, so on its own the character reads as a loop. This layer adds:
 *   - blinks at random intervals (sometimes a double blink), replacing the baked one;
 *   - gaze fixations: mostly at the viewer, sometimes a glance away, with the
 *     head following the eyes a little and more slowly;
 *   - slow posture shifts: body lean and head tilt drifting to new rest points.
 * Everything except blinking is an additive offset on the motion's value, so
 * the Idle motion keeps playing underneath. While a gesture motion plays, the
 * gesture owns the eyes (its authored blinks and eye shapes pass through); the
 * hand-over eases over EYE_HANDOVER_MS both ways so the eyes never snap.
 */

import type { ParameterSource } from './parameter-controller'

export interface IdleLifeOptions {
  /** Eye-open parameters (the model's EyeBlink group). */
  eyeIds: readonly string[]
  /** True while a non-idle (gesture) motion plays. */
  isGesture: () => boolean
  /** Injected for tests; defaults to Math.random. */
  random?: () => number
  priority: number
}

const GAZE_X = 'ParamEyeBallX'
const GAZE_Y = 'ParamEyeBallY'
const HEAD_X = 'ParamAngleX'
const HEAD_Y = 'ParamAngleY'
const HEAD_Z = 'ParamAngleZ'
const BODY_X = 'ParamBodyAngleX'
const BODY_Z = 'ParamBodyAngleZ'

/** Blink shape: quick close, brief hold, slower open. */
const BLINK_CLOSE_MS = 80
const BLINK_HOLD_MS = 50
const BLINK_OPEN_MS = 150
const BLINK_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS
/** At least the longest gesture fade-in (Mao: 0.5 s). */
const EYE_HANDOVER_MS = 500

/** Exponential approach with time constant `tau` (frame-rate independent). */
function approach(current: number, goal: number, dtMs: number, tau: number): number {
  return current + (goal - current) * (1 - Math.exp(-dtMs / tau))
}

/** Eye openness (1 open → 0 shut → 1) `t` ms into a blink. */
export function blinkOpenness(t: number): number {
  if (t <= 0 || t >= BLINK_MS)
    return 1
  if (t < BLINK_CLOSE_MS)
    return 1 - (t / BLINK_CLOSE_MS) ** 2
  if (t < BLINK_CLOSE_MS + BLINK_HOLD_MS)
    return 0
  const u = (t - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS
  return 1 - (1 - u) ** 2
}

export function createIdleLife(options: IdleLifeOptions): ParameterSource {
  const random = options.random ?? Math.random
  const between = (min: number, max: number) => min + (max - min) * random()
  const eyeIds = [...options.eyeIds]

  // Blink: time until the next blink, and time into the current one (-1 = none).
  let nextBlinkMs = between(1_500, 4_000)
  let blinkT = -1
  let secondBlink = false
  // 1 while idle life owns the eyes, 0 while a gesture does.
  let eyeOwnership = 1

  // Gaze fixation target and smoothed eye/head positions.
  let nextGazeMs = between(1_200, 3_500)
  let gazeTarget = { x: 0, y: 0 }
  const eye = { x: 0, y: 0 }
  const head = { x: 0, y: 0 }

  // Posture rest point and smoothed offsets.
  let nextPostureMs = between(6_000, 14_000)
  let postureTarget = { lean: 0, sway: 0, tilt: 0 }
  const posture = { lean: 0, sway: 0, tilt: 0 }

  function pickGaze(): { x: number; y: number } {
    // Mostly look at the viewer; now and then glance aside.
    if (random() < 0.55)
      return { x: between(-0.06, 0.06), y: between(-0.04, 0.06) }
    const side = random() < 0.5 ? -1 : 1
    return { x: side * between(0.25, 0.55), y: between(-0.3, 0.2) }
  }

  function advance(dtMs: number): number {
    // Blink timeline.
    if (blinkT >= 0) {
      blinkT += dtMs
      if (blinkT >= BLINK_MS) {
        blinkT = -1
        secondBlink = !secondBlink && random() < 0.15
        nextBlinkMs = secondBlink ? between(60, 140) : between(2_200, 6_000)
      }
    }
    else {
      nextBlinkMs -= dtMs
      if (nextBlinkMs <= 0)
        blinkT = 0
    }

    nextGazeMs -= dtMs
    if (nextGazeMs <= 0) {
      gazeTarget = pickGaze()
      nextGazeMs = between(1_200, 3_500)
    }
    eye.x = approach(eye.x, gazeTarget.x, dtMs, 70)
    eye.y = approach(eye.y, gazeTarget.y, dtMs, 70)
    head.x = approach(head.x, gazeTarget.x * 0.4, dtMs, 500)
    head.y = approach(head.y, gazeTarget.y * 0.4, dtMs, 500)

    nextPostureMs -= dtMs
    if (nextPostureMs <= 0) {
      postureTarget = { lean: between(-4, 4), sway: between(-3, 3), tilt: between(-5, 5) }
      nextPostureMs = between(6_000, 14_000)
    }
    posture.lean = approach(posture.lean, postureTarget.lean, dtMs, 1_600)
    posture.sway = approach(posture.sway, postureTarget.sway, dtMs, 1_600)
    posture.tilt = approach(posture.tilt, postureTarget.tilt, dtMs, 1_600)

    return blinkOpenness(blinkT)
  }

  return {
    id: 'idle-life',
    priority: options.priority,
    targets: new Set([...eyeIds, GAZE_X, GAZE_Y, HEAD_X, HEAD_Y, HEAD_Z, BODY_X, BODY_Z]),
    sample: ({ readBase, dtMs }) => {
      const openness = advance(dtMs)
      const claims = new Map<string, number>([
        [GAZE_X, readBase(GAZE_X) + eye.x],
        [GAZE_Y, readBase(GAZE_Y) + eye.y],
        [HEAD_X, readBase(HEAD_X) + head.x * 30],
        [HEAD_Y, readBase(HEAD_Y) + head.y * 30],
        [HEAD_Z, readBase(HEAD_Z) + posture.tilt],
        [BODY_X, readBase(BODY_X) + posture.lean],
        [BODY_Z, readBase(BODY_Z) + posture.sway],
      ])
      // Replace the Idle motion's baked blink (never close below fully open), then blink on our schedule.
      const step = dtMs / EYE_HANDOVER_MS
      eyeOwnership = options.isGesture() ? Math.max(0, eyeOwnership - step) : Math.min(1, eyeOwnership + step)
      if (eyeOwnership > 0) {
        for (const id of eyeIds) {
          const base = readBase(id)
          claims.set(id, base + (Math.max(base, 1) * openness - base) * eyeOwnership)
        }
      }
      return claims
    },
  }
}
