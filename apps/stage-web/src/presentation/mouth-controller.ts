/**
 * Mouth Controller — presentation-layer ownership state machine.
 *
 * Owns when the speech system is allowed to drive `ParamMouthOpenY`, and what
 * value it writes, across the full speech lifecycle:
 *
 *   speaking        → speech owns the mouth (active)
 *   speech ends     → release (cross-fade the last speech value to the native value)
 *   release done    → handoff (briefly force the mouth shut)
 *   handoff done    → idle (release ownership, native motion regains control)
 *
 * The controller knows nothing about Live2D parameters: the native mouth value
 * is passed in as `baseMouth` by the parameter layer, keeping this module pure
 * and unit-testable.
 */

import { createMouthSignal, type MouthSignal } from '../audio/mouth-signal'

export interface MouthControllerInput {
  /** Speech playback lifecycle (true while audio is actually playing). */
  speaking: boolean
  /** Raw analysable audio level (0..1), or undefined when there is no signal. */
  level: number | undefined
  /** Frame delta in milliseconds. */
  dtMs: number
  /** Native ParamMouthOpenY left by model.update() this frame (cross-fade target). */
  baseMouth: number
}

export interface MouthControllerFrame {
  /** Whether the speech system owns ParamMouthOpenY this frame. */
  ownsMouth: boolean
  /** Mouth openness (0..1) to write while ownsMouth is true. */
  mouthOpen: number
}

export interface MouthControllerOptions {
  /** The signal that maps raw audio to mouth openness. Defaults to a fresh one. */
  signal?: MouthSignal
  /** Cross-fade duration (ms) from the last speech value to the native value. */
  releaseMs?: number
  /** Forced-closed hold (ms) after release, so idle motion cannot reopen the mouth. */
  handoffMs?: number
}

export interface MouthController {
  update(input: MouthControllerInput): MouthControllerFrame
  reset(): void
  /** Current ownership state (idle/active/release/handoff). */
  readonly state: MouthState
  /** The underlying mouth signal's current smoothed output (0..1). */
  readonly signalLevel: number
}

export type MouthState = 'idle' | 'active' | 'release' | 'handoff'

const DEFAULT_RELEASE_MS = 200
const DEFAULT_HANDOFF_MS = 500

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function createMouthController(options: MouthControllerOptions = {}): MouthController {
  const signal = options.signal ?? createMouthSignal()
  const releaseMs = options.releaseMs ?? DEFAULT_RELEASE_MS
  const handoffMs = options.handoffMs ?? DEFAULT_HANDOFF_MS

  let state: MouthState = 'idle'
  let releaseRemainingMs = 0
  let handoffRemainingMs = 0
  let lastSpeechValue = 0
  let hasSignal = false

  function setState(next: MouthState): void {
    if (next === state)
      return
    state = next
  }

  function reset(): void {
    state = 'idle'
    releaseRemainingMs = 0
    handoffRemainingMs = 0
    lastSpeechValue = 0
    hasSignal = false
    signal.reset()
  }

  function update(input: MouthControllerInput): MouthControllerFrame {
    const { speaking, level, dtMs, baseMouth } = input

    if (speaking) {
      if (level !== undefined)
        hasSignal = true

      if (!hasSignal) {
        // Speaking without any analysable signal (e.g. browser speechSynthesis):
        // never claim the mouth, so native idle motion keeps full control and no
        // fake lip-sync is introduced.
        setState('idle')
        return { ownsMouth: false, mouthOpen: 0 }
      }

      // A new utterance (including re-speak during release/handoff) restarts the
      // signal so it opens from a closed mouth rather than a stale frozen value.
      if (state !== 'active')
        signal.reset()

      setState('active')
      releaseRemainingMs = releaseMs
      handoffRemainingMs = handoffMs
      lastSpeechValue = signal.update(level, true, dtMs)
      return { ownsMouth: true, mouthOpen: lastSpeechValue }
    }

    if (state === 'idle')
      return { ownsMouth: false, mouthOpen: 0 }

    if (state === 'active') {
      setState('release')
      releaseRemainingMs = releaseMs
      handoffRemainingMs = handoffMs
    }

    if (state === 'release') {
      releaseRemainingMs -= dtMs
      if (releaseRemainingMs > 0) {
        // Cross-fade from the last speech value toward the live native value,
        // re-read each frame so an idle motion curve is followed during handoff.
        const t = 1 - releaseRemainingMs / releaseMs
        const blend = smoothstep(t)
        return { ownsMouth: true, mouthOpen: lastSpeechValue * (1 - blend) + baseMouth * blend }
      }
      setState('handoff')
    }

    if (state === 'handoff') {
      handoffRemainingMs -= dtMs
      if (handoffRemainingMs > 0)
        return { ownsMouth: true, mouthOpen: 0 }
      setState('idle')
      hasSignal = false
      return { ownsMouth: false, mouthOpen: 0 }
    }

    return { ownsMouth: false, mouthOpen: 0 }
  }

  return {
    update,
    reset,
    get state() {
      return state
    },
    get signalLevel() {
      return signal.level
    },
  }
}
