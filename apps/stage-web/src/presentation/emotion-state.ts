/**
 * Emotion state — turns sparse judge samples into a stable, decaying emotion.
 *
 * The categories are the emotions the character model can show distinctly
 * (one Mao expression each). There is no "neutral" label: neutral is simply
 * the absence of a shown emotion, reached when the evidence decays away. Jev
 * reports intensity and confidence; their product is the only evidence value
 * this module thresholds, once:
 *
 *   neutral → emotion   strength ≥ ENTER
 *   emotion → other     strength ≥ current level + SWITCH_MARGIN (hysteresis)
 *   same emotion        refreshes the level and the hold
 *   after the hold      the level halves every HALF_LIFE_MS       (decay)
 *   level < EXIT        back to neutral                           (EXIT < ENTER)
 *
 * Shown weights ease toward their goals (fast rise, slower fall), so a switch
 * cross-fades one expression into the next. Time is absolute (ms), so callers
 * may update at any rate and a long pause simply decays further.
 */

export const EMOTIONS = ['joy', 'sad', 'angry', 'surprised', 'shy'] as const
export type Emotion = typeof EMOTIONS[number]
export type EmotionWeights = Record<Emotion, number>

export interface EmotionSample {
  emotion: Emotion
  /** Jev's confidence in the category, 0..1. */
  confidence: number
  /** How strongly the emotion shows, 0..1. */
  intensity: number
}

export type EmotionOffer = 'entered' | 'refreshed' | 'rejected'

export interface EmotionState {
  /** Feed a judge sample. `entered` means the shown emotion changed to it. */
  offer(sample: EmotionSample, now: number): EmotionOffer
  /** Advance to `now`; `holding` (e.g. while speaking) postpones decay. */
  update(now: number, holding?: boolean): EmotionWeights
  /** The emotion currently shown, or null for neutral. */
  readonly active: Emotion | null
  /** The level the active emotion is heading to, 0..1. */
  readonly target: number
  readonly weights: Readonly<EmotionWeights>
}

export const EMOTION_TUNING = {
  enter: 0.2,
  switchMargin: 0.15,
  exit: 0.05,
  holdMs: 6_000,
  halfLifeMs: 4_000,
  riseMs: 350,
  fallMs: 900,
} as const

const clamp01 = (value: number): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value)
}

export function createEmotionState(start = 0): EmotionState {
  const t = EMOTION_TUNING
  const weights = Object.fromEntries(EMOTIONS.map(emotion => [emotion, 0])) as EmotionWeights
  let active: Emotion | null = null
  let target = 0
  let heldUntil = start
  let last = start

  function update(now: number, holding = false): EmotionWeights {
    const dt = Math.max(0, now - last)
    if (holding && active)
      heldUntil = Math.max(heldUntil, now)
    const decayMs = now - Math.max(heldUntil, last)
    if (active && decayMs > 0)
      target *= 0.5 ** (decayMs / t.halfLifeMs)
    last = Math.max(last, now)
    if (active && target < t.exit) {
      active = null
      target = 0
    }
    for (const emotion of EMOTIONS) {
      const goal = emotion === active ? target : 0
      const tau = goal > weights[emotion] ? t.riseMs : t.fallMs
      weights[emotion] += (goal - weights[emotion]) * (1 - Math.exp(-dt / tau))
    }
    return weights
  }

  function offer(sample: EmotionSample, now: number): EmotionOffer {
    update(now)
    const strength = clamp01(sample.intensity) * clamp01(sample.confidence)
    // Compare with the current evidence level, not the eased weight: right after
    // an entry the weight still lags, and a weaker sample must not slip in.
    if (sample.emotion !== active && (strength < t.enter || strength < (active ? target : 0) + t.switchMargin))
      return 'rejected'
    const entered = sample.emotion !== active
    active = sample.emotion
    target = strength
    heldUntil = now + t.holdMs
    return entered ? 'entered' : 'refreshed'
  }

  return {
    offer,
    update,
    get active() { return active },
    get target() { return target },
    get weights() { return weights },
  }
}
