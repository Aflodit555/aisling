/**
 * Speaking-aware mouth signal.
 *
 * Turns a raw audio amplitude sample (0..1) plus the speech lifecycle flag into
 * a stable, normalized mouth openness (0..1). It is deliberately not a raw RMS
 * passthrough: it separates the *silence floor* (when a sample counts as quiet)
 * from the *output floor* (the minimum openness kept while actually speaking),
 * bridges short weak/silent gaps with a time-based hold, and smooths over time
 * so frame-rate changes do not change the visible behaviour.
 *
 * This is presentation-signal logic only: it knows nothing about providers,
 * codecs, AnalyserNode, Live2D or character ownership.
 */

export interface MouthSignalConfig {
  /** Raw level (0..1) that maps to full openness (1.0). */
  reference: number
  /** Normalized envelope below which a sample counts as silence (noise floor). */
  silenceFloor: number
  /** Minimum mouth openness while speech is active; never applied when idle. */
  outputFloor: number
  /** Silence must persist this long (ms) before the mouth starts to close. */
  holdMs: number
  /** Time-based attack rate (per second); higher opens faster. */
  attackRatePerSec: number
  /** Time-based release rate (per second); lower closes slower. */
  releaseRatePerSec: number
  /** Below this a closing level snaps to exactly 0 (gentle, after smoothing). */
  epsilon: number
}

export const DEFAULT_MOUTH_SIGNAL_CONFIG: MouthSignalConfig = {
  reference: 0.25,
  silenceFloor: 0.02,
  outputFloor: 0.06,
  holdMs: 160,
  attackRatePerSec: 12,
  releaseRatePerSec: 5,
  epsilon: 0.01,
}

export interface MouthSignal {
  /**
   * Feed one frame. `rawLevel` may be `undefined` when no analysable audio is
   * available (e.g. a suspended AudioContext) — the current level is held
   * rather than treated as silence.
   */
  update(rawLevel: number | undefined, speaking: boolean, dtMs: number): number
  /** Resets smoothing and hold state (idempotent). */
  reset(): void
  /** The current smoothed openness (0..1). */
  readonly level: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function createMouthSignal(config: Partial<MouthSignalConfig> = {}): MouthSignal {
  const {
    reference,
    silenceFloor,
    outputFloor,
    holdMs,
    attackRatePerSec,
    releaseRatePerSec,
    epsilon,
  } = { ...DEFAULT_MOUTH_SIGNAL_CONFIG, ...config }

  const referenceSafe = reference > 0 ? reference : 1

  let level = 0
  let nowMs = 0
  let lastActiveAtMs = Number.NEGATIVE_INFINITY

  function update(rawLevel: number | undefined, speaking: boolean, dtMs: number): number {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
    nowMs += dt

    if (rawLevel === undefined || !Number.isFinite(rawLevel)) {
      // No usable sample: hold the current openness. A suspended context or a
      // missing element must not produce a spurious 0 spike that reads as silence.
      return clamp01(level)
    }

    const envelope = clamp01(rawLevel / referenceSafe)

    const voiced = envelope >= silenceFloor
    if (voiced)
      lastActiveAtMs = nowMs

    const longSilent = nowMs - lastActiveAtMs > holdMs
    const target = (!speaking || longSilent) ? 0 : Math.max(envelope, outputFloor)

    // Time-based asymmetric smoothing: the exact frame size drops out, so a
    // 32 ms step matches two 16 ms steps.
    const rate = target > level ? attackRatePerSec : releaseRatePerSec
    const alpha = 1 - Math.exp(-rate * (dt / 1000))
    level += (target - level) * alpha
    level = clamp01(level)

    if (target === 0 && level < epsilon)
      level = 0

    return level
  }

  function reset(): void {
    level = 0
    nowMs = 0
    lastActiveAtMs = Number.NEGATIVE_INFINITY
  }

  return {
    update,
    reset,
    get level() {
      return level
    },
  }
}
