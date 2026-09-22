import { describe, expect, it } from 'vitest'

import {
  applyCharacterDisplayTransform,
  fitLive2DModel,
  normalizeCharacterDisplayTransform,
} from './presentation'

describe('fitLive2DModel', () => {
  it('fits either model axis without changing its aspect ratio', () => {
    const portrait = fitLive2DModel({ width: 400, height: 800 }, { width: 1000, height: 2000 })
    const landscape = fitLive2DModel({ width: 800, height: 400 }, { width: 1000, height: 2000 })

    expect(portrait).toMatchObject({ x: 200, y: 400 })
    expect(portrait.scale).toBeCloseTo(0.368)
    expect(landscape).toMatchObject({ x: 400, y: 200 })
    expect(landscape.scale).toBeCloseTo(0.184)
  })

  it('applies user calibration to a fresh auto-fit result', () => {
    const portrait = applyCharacterDisplayTransform(
      fitLive2DModel({ width: 400, height: 800 }, { width: 1000, height: 2000 }),
      { scale: 1.25, offsetX: 40, offsetY: -30 },
    )
    const resized = applyCharacterDisplayTransform(
      fitLive2DModel({ width: 800, height: 400 }, { width: 1000, height: 2000 }),
      { scale: 1.25, offsetX: 40, offsetY: -30 },
    )

    expect(portrait).toMatchObject({ x: 240, y: 370 })
    expect(portrait.scale).toBeCloseTo(0.46)
    expect(resized).toMatchObject({ x: 440, y: 170 })
    expect(resized.scale).toBeCloseTo(0.23)
  })

  it('defaults invalid persisted values and clamps valid numbers', () => {
    expect(normalizeCharacterDisplayTransform({ scale: 99, offsetX: Number.NaN, offsetY: -999 }))
      .toEqual({ scale: 1.5, offsetX: 0, offsetY: -240 })
  })
})
