import { describe, expect, it } from 'vitest'

import { createMouthSignal } from './mouth-signal'

describe('mouth signal', () => {
  it('holds through a short silence window during speech instead of zeroing', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 30; i++)
      signal.update(0.25, true, 16)
    expect(signal.level).toBeGreaterThan(0.9)

    // 128 ms of silence is shorter than the 160 ms hold.
    for (let i = 0; i < 8; i++)
      signal.update(0, true, 16)
    expect(signal.level).toBeGreaterThan(0.2)
  })

  it('closes smoothly once silence exceeds the hold', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 30; i++)
      signal.update(0.25, true, 16)
    const opened = signal.level

    const closing: number[] = []
    for (let i = 0; i < 40; i++)
      closing.push(signal.update(0, true, 16))
    for (let i = 1; i < closing.length; i++)
      expect(closing[i]!).toBeLessThanOrEqual(closing[i - 1]! + 1e-9)

    expect(signal.level).toBeLessThan(opened)

    for (let i = 0; i < 200; i++)
      signal.update(0, true, 16)
    expect(signal.level).toBe(0)
  })

  it('applies the output floor while speech is active', () => {
    const signal = createMouthSignal()
    // Weak but voiced: envelope 0.04 sits above silenceFloor (0.02) but below outputFloor (0.06).
    for (let i = 0; i < 60; i++)
      signal.update(0.01, true, 16)
    expect(signal.level).toBeGreaterThanOrEqual(0.05)
    expect(signal.level).toBeLessThan(0.1)
  })

  it('returns to zero once speaking is false', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 30; i++)
      signal.update(0.25, true, 16)
    for (let i = 0; i < 200; i++)
      signal.update(0, false, 16)
    expect(signal.level).toBe(0)
  })

  it('opens faster (attack) than it closes (release)', () => {
    const signal = createMouthSignal()
    const rise = signal.update(1, true, 16)
    for (let i = 0; i < 30; i++)
      signal.update(1, true, 16)
    const before = signal.level
    const after = signal.update(0, false, 16)
    expect(rise).toBeGreaterThan(before - after)
  })

  it('behaves consistently across different frame sizes', () => {
    const sixteen = createMouthSignal()
    const thirtyTwo = createMouthSignal()

    sixteen.update(0.25, true, 16)
    sixteen.update(0.25, true, 16)
    thirtyTwo.update(0.25, true, 32)

    expect(sixteen.level).toBeCloseTo(thirtyTwo.level)
  })

  it('reset() returns the level to zero, is idempotent, and leaves a fresh signal', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 30; i++)
      signal.update(0.25, true, 16)
    signal.reset()
    expect(signal.level).toBe(0)
    signal.reset()
    expect(signal.level).toBe(0)
    expect(signal.update(0.25, true, 16)).toBeGreaterThan(0)
  })

  it('holds the current level on undefined/non-finite samples instead of a 0 spike', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 30; i++)
      signal.update(0.25, true, 16)
    const held = signal.level

    expect(signal.update(undefined, true, 16)).toBeCloseTo(held)
    expect(signal.update(Number.NaN, true, 16)).toBeCloseTo(held)
    expect(signal.update(Number.POSITIVE_INFINITY, true, 16)).toBeCloseTo(held)
  })

  it('clamps output to 0..1', () => {
    const signal = createMouthSignal()
    for (let i = 0; i < 100; i++) {
      const value = signal.update(10, true, 16)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})
