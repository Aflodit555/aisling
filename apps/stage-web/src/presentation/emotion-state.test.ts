import { describe, expect, it } from 'vitest'

import { createEmotionState, EMOTION_TUNING, type EmotionSample } from './emotion-state'

const sample = (emotion: EmotionSample['emotion'], intensity: number, confidence = 1): EmotionSample =>
  ({ emotion, intensity, confidence })

function run(state: ReturnType<typeof createEmotionState>, from: number, to: number, step = 16, holding = false): void {
  for (let now = from; now <= to; now += step)
    state.update(now, holding)
}

describe('emotion state', () => {
  it('starts neutral and ignores evidence below the enter threshold', () => {
    const state = createEmotionState()
    expect(state.offer(sample('joy', 0.4, 0.4), 0)).toBe('rejected') // 0.16 < enter
    expect(state.active).toBeNull()
    expect(state.offer(sample('joy', 0.5, 0.5), 0)).toBe('entered') // 0.25
    expect(state.active).toBe('joy')
    expect(state.target).toBeCloseTo(0.25)
  })

  it('eases the shown weight toward the evidence instead of jumping', () => {
    const state = createEmotionState()
    state.offer(sample('sad', 0.8), 0)
    expect(state.update(16).sad).toBeLessThan(0.1)
    run(state, 32, 2_000)
    expect(state.weights.sad).toBeCloseTo(0.8, 2)
  })

  it('keeps the current emotion unless another beats it by the switch margin', () => {
    const state = createEmotionState()
    state.offer(sample('joy', 0.6), 0)
    run(state, 16, 2_000)
    expect(state.offer(sample('angry', 0.7), 2_000)).toBe('rejected') // 0.7 < 0.6 + margin
    expect(state.active).toBe('joy')
    expect(state.offer(sample('angry', 0.8), 2_000)).toBe('entered')
    expect(state.active).toBe('angry')
  })

  it('a weaker sample right after an entry cannot take over while the weight still rises', () => {
    const state = createEmotionState()
    expect(state.offer(sample('shy', 0.6), 0)).toBe('entered')
    expect(state.offer(sample('angry', 0.4), 50)).toBe('rejected')
    expect(state.active).toBe('shy')
  })

  it('cross-fades: the outgoing emotion falls while the incoming one rises', () => {
    const state = createEmotionState()
    state.offer(sample('joy', 0.5), 0)
    run(state, 16, 2_000)
    state.offer(sample('surprised', 0.9), 2_000)
    state.update(2_200)
    expect(state.weights.joy).toBeGreaterThan(0.1)
    expect(state.weights.surprised).toBeGreaterThan(0.1)
    run(state, 2_216, 5_000)
    expect(state.weights.joy).toBeLessThan(0.02)
    expect(state.weights.surprised).toBeCloseTo(0.9, 2)
  })

  it('holds, then decays and returns to neutral on its own', () => {
    const state = createEmotionState()
    state.offer(sample('shy', 0.8), 0)
    run(state, 16, EMOTION_TUNING.holdMs)
    expect(state.target).toBe(0.8)
    run(state, EMOTION_TUNING.holdMs + 16, EMOTION_TUNING.holdMs + EMOTION_TUNING.halfLifeMs)
    expect(state.target).toBeCloseTo(0.4, 2)
    run(state, EMOTION_TUNING.holdMs + EMOTION_TUNING.halfLifeMs + 16, 40_000)
    expect(state.active).toBeNull()
    expect(state.weights.shy).toBeLessThan(0.01)
  })

  it('does not decay while holding (speaking) and decays after', () => {
    const state = createEmotionState()
    state.offer(sample('joy', 0.8), 0)
    run(state, 16, 20_000, 16, true)
    expect(state.target).toBe(0.8)
    run(state, 20_016, 24_000)
    expect(state.target).toBeCloseTo(0.4, 2)
  })

  it('refreshing the same emotion resets the hold and follows the new level', () => {
    const state = createEmotionState()
    state.offer(sample('sad', 0.9), 0)
    run(state, 16, 9_000)
    expect(state.offer(sample('sad', 0.5), 9_000)).toBe('refreshed')
    expect(state.target).toBe(0.5)
    run(state, 9_016, 9_000 + EMOTION_TUNING.holdMs)
    expect(state.target).toBe(0.5)
  })

  it('a long pause decays in one step (absolute time)', () => {
    const state = createEmotionState()
    state.offer(sample('angry', 1), 0)
    state.update(120_000)
    expect(state.active).toBeNull()
  })

  it('clamps malformed evidence', () => {
    const state = createEmotionState()
    expect(state.offer(sample('joy', Number.NaN), 0)).toBe('rejected')
    expect(state.offer(sample('joy', 3, 3), 0)).toBe('entered')
    expect(state.target).toBe(1)
  })

  it('a calm reply ends the hold the same way whatever label Jev picked', () => {
    for (const label of ['joy', 'sad'] as const) {
      const state = createEmotionState()
      state.offer(sample('joy', 0.8), 0)
      run(state, 16, 2_000)
      expect(state.offer(sample(label, 0), 2_000)).toBe('rejected')
      expect(state.active).toBe('joy')
      run(state, 2_016, 2_000 + EMOTION_TUNING.halfLifeMs)
      expect(state.target).toBeCloseTo(0.4, 2)
    }
  })

  it('a rejected newer reply is not held by speaking, and a full-strength one always switches', () => {
    const state = createEmotionState()
    state.offer(sample('joy', 0.9), 0)
    run(state, 16, 1_000, 16, true)
    expect(state.offer(sample('sad', 0.8), 1_000)).toBe('rejected') // 0.8 < 0.9 + margin
    run(state, 1_016, 1_000 + EMOTION_TUNING.halfLifeMs, 16, true) // speaking the new reply
    expect(state.target).toBeCloseTo(0.45, 2)
    expect(state.offer(sample('angry', 1), 5_000)).toBe('entered')
    const high = createEmotionState()
    high.offer(sample('joy', 1), 0)
    expect(high.offer(sample('sad', 1), 100)).toBe('entered')
  })
})
