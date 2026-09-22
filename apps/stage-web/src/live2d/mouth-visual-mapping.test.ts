import { describe, expect, it } from 'vitest'

import { DEFAULT_MOUTH_VISUAL_MAPPING, mapMouthOpenness } from './mouth-visual-mapping'

describe('mouth visual mapping', () => {
  it('maps input 0 to output 0', () => {
    expect(mapMouthOpenness(0)).toBe(0)
  })

  it('visibly lifts a small level without overblowing it', () => {
    const out = mapMouthOpenness(0.1)
    expect(out).toBeGreaterThan(0.1)
    expect(out).toBeLessThan(0.5)
  })

  it('clearly enhances a mid level below the ceiling', () => {
    const out = mapMouthOpenness(0.5)
    expect(out).toBeGreaterThan(0.5)
    expect(out).toBeLessThan(DEFAULT_MOUTH_VISUAL_MAPPING.max)
  })

  it('does not exceed the model max for input 1', () => {
    expect(mapMouthOpenness(1)).toBeLessThanOrEqual(DEFAULT_MOUTH_VISUAL_MAPPING.max)
  })

  it('is monotonically increasing across 0..1', () => {
    let previous = -1
    for (let i = 0; i <= 100; i++) {
      const out = mapMouthOpenness(i / 100)
      expect(out).toBeGreaterThanOrEqual(previous)
      previous = out
    }
  })

  it('handles non-finite input safely', () => {
    expect(mapMouthOpenness(Number.NaN)).toBe(0)
    expect(mapMouthOpenness(Number.POSITIVE_INFINITY)).toBe(0)
    expect(mapMouthOpenness(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('clamps out-of-range input before mapping', () => {
    expect(mapMouthOpenness(-1)).toBe(0)
    expect(mapMouthOpenness(5)).toBeLessThanOrEqual(DEFAULT_MOUTH_VISUAL_MAPPING.max)
  })
})
