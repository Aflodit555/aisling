import { describe, expect, it } from 'vitest'

import {
  normalizeCharacterDisplayTransform,
  fitStageCharacter,
  fitDesktopCharacter,
  CHARACTER_DISPLAY_LIMITS,
  DESKTOP_ENTRANCE_OVERSHOOT,
} from './presentation'

describe('presentation settings', () => {
  it('defaults invalid persisted values and clamps valid numbers', () => {
    expect(normalizeCharacterDisplayTransform({ scale: 99, offsetX: Number.NaN, offsetY: -999 }))
      .toEqual({ scale: 1.5, offsetX: 0, offsetY: -999 })
  })
})

describe('Stage virtual taskbar', () => {
  const geometry = {
    centerX: 480,
    body: { x: 120, y: 160, width: 600, height: 1200 },
    envelope: { x: 80, y: -218, width: 680, height: 1578 },
  }

  it('keeps the minimum display unchanged and allows full-body lift up to 150%', () => {
    for (const [width, height] of [[520, 700], [400, 300], [900, 1200], [180, 800]]) {
      const layout = { width, height, ...geometry }
      const standing = fitStageCharacter(layout, { scale: CHARACTER_DISPLAY_LIMITS.scale.min, offsetX: 999, offsetY: 0 })
      expect(standing.y + (geometry.body.y + geometry.body.height) * standing.scale).toBeCloseTo(height)
      const headroom = geometry.body.y - geometry.envelope.y + geometry.body.height * 0.06
      const previousScale = Math.min(width / Math.max(geometry.body.width * 1.15, geometry.envelope.width), height * 0.9 / (geometry.body.height + headroom))
      expect(standing.scale).toBeCloseTo(previousScale)
      const previousTop = height - geometry.body.height * previousScale
      const minimumLift = fitStageCharacter(layout, { scale: CHARACTER_DISPLAY_LIMITS.scale.min, offsetX: 0, offsetY: -9999 })
      expect(minimumLift.transform.offsetY).toBeCloseTo(-Math.min(height * 0.18, previousTop - headroom * previousScale))
      for (const scale of [0.1, 1, 1.4, 2, 99]) {
        for (const offsetY of [-9999, -20, 0, 9999]) {
          const fitted = fitStageCharacter(layout, { scale, offsetX: 999, offsetY })
          const bodyTop = fitted.y + geometry.body.y * fitted.scale
          expect((height - bodyTop) / (geometry.body.height * fitted.scale)).toBeGreaterThanOrEqual(0.5 - 1e-8)
          expect(fitted.transform.offsetX).toBe(0)
          expect(fitted.transform.offsetY).toBeLessThanOrEqual(0)
          expect(fitted.x + geometry.centerX * fitted.scale).toBeCloseTo(width / 2)
          expect(fitted.limits.scale.max).toBe(1.5)
          expect(fitted.limits.offset.min).toBeLessThan(0)
        }
      }
      const lifted = fitStageCharacter(layout, { scale: 1.5, offsetX: 0, offsetY: -9999 })
      const oldMaximum = fitStageCharacter(layout, { scale: 1.25, offsetX: 0, offsetY: 0 })
      expect(lifted.scale).toBeCloseTo(oldMaximum.scale * 1.2)
      expect(lifted.y + (geometry.body.y + geometry.body.height) * lifted.scale).toBeCloseTo(height)
    }
  })

  it('reclamps restored settings on resize while keeping manual zoom separate from auto-fit', () => {
    const input = { scale: 1, offsetX: 40, offsetY: -999 }
    const tall = fitStageCharacter({ width: 600, height: 900, ...geometry }, input)
    const short = fitStageCharacter({ width: 600, height: 300, ...geometry }, tall.transform)
    expect(short.transform.scale).toBe(tall.transform.scale)
    expect(short.scale).toBeLessThan(tall.scale)
    expect(short.transform.offsetY).toBeGreaterThan(tall.transform.offsetY)
    expect(fitStageCharacter({ width: 600, height: 300, ...geometry }, short.transform).transform).toEqual(short.transform)
  })

  it('inherits actual Stage size and taskbar offset, reserving effects and entrance space', () => {
    const stage = { width: 520, height: 700, ...geometry }
    for (const scale of [CHARACTER_DISPLAY_LIMITS.scale.min, 1, 1.25, 1.5]) {
      for (const offsetY of [0, -9999]) {
        const input = { scale, offsetX: 0, offsetY }
        const fitted = fitStageCharacter(stage, input)
        const initial = fitDesktopCharacter({ width: 360, height: 460 }, stage, input)
        const desktop = fitDesktopCharacter({ width: initial.windowWidth, height: initial.windowHeight }, stage, input)
        expect(desktop.scale).toBe(fitted.scale)
        expect(desktop.transform).toEqual(fitted.transform)
        expect(desktop.y - desktop.windowHeight).toBeCloseTo(fitted.y - stage.height)
        expect(desktop.x + geometry.centerX * desktop.scale).toBeCloseTo(desktop.windowWidth / 2)
        expect(desktop.y + geometry.envelope.y * desktop.scale).toBeGreaterThanOrEqual(DESKTOP_ENTRANCE_OVERSHOOT)
        expect(desktop.canvasHeight).toBeGreaterThanOrEqual(desktop.windowHeight + DESKTOP_ENTRANCE_OVERSHOOT)
        expect(desktop.canvasHeight).toBeGreaterThanOrEqual(desktop.y + (geometry.envelope.y + geometry.envelope.height) * desktop.scale)
      }
    }
  })
})
