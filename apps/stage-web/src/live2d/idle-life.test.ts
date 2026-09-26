import { describe, expect, it } from 'vitest'

import { blinkOpenness, createIdleLife } from './idle-life'

/** Deterministic LCG in [0, 1). */
function seeded(seed = 1): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const EYES = ['ParamEyeLOpen', 'ParamEyeROpen']

function frames(options: { base?: Record<string, number>; gesture?: boolean; seconds: number; seed?: number }) {
  const source = createIdleLife({ eyeIds: EYES, isGesture: () => options.gesture ?? false, random: seeded(options.seed), priority: 20 })
  const base = options.base ?? {}
  const out: Map<string, number>[] = []
  for (let t = 0; t < options.seconds * 1000; t += 16)
    out.push(new Map(source.sample({ readBase: id => base[id] ?? 0, dtMs: 16 })!))
  return out
}

describe('idle life', () => {
  it('blink curve closes fully and reopens', () => {
    expect(blinkOpenness(0)).toBe(1)
    expect(blinkOpenness(100)).toBe(0)
    expect(blinkOpenness(1_000)).toBe(1)
  })

  it('blinks at irregular intervals of a few seconds', () => {
    const eyes = frames({ base: { ParamEyeLOpen: 1 }, seconds: 60 }).map(f => f.get('ParamEyeLOpen')!)
    const starts: number[] = []
    eyes.forEach((v, i) => { if (v < 0.5 && (i === 0 || eyes[i - 1] >= 0.5)) starts.push(i * 16) })
    expect(starts.length).toBeGreaterThanOrEqual(8)
    expect(starts.length).toBeLessThanOrEqual(30)
    const gaps = starts.slice(1).map((s, i) => s - starts[i])
    expect(new Set(gaps.map(g => Math.round(g / 100))).size).toBeGreaterThan(3)
  })

  it('replaces the baked Idle blink but keeps wider-than-open eyes', () => {
    const closed = frames({ base: { ParamEyeLOpen: 0 }, seconds: 1 }).map(f => f.get('ParamEyeLOpen')!)
    expect(Math.max(...closed)).toBe(1)
    const wide = frames({ base: { ParamEyeLOpen: 1.2 }, seconds: 1 }).map(f => f.get('ParamEyeLOpen')!)
    expect(Math.max(...wide)).toBeCloseTo(1.2)
  })

  it('hands the eyes to a gesture motion gradually', () => {
    const out = frames({ gesture: true, seconds: 10, base: { ParamEyeLOpen: 0 } })
    const eyes = out.map(f => f.get('ParamEyeLOpen'))
    // Eased over the hand-over instead of snapping to the gesture's closed eyes.
    expect(eyes[0]).toBeGreaterThan(0.9)
    expect(eyes[15]).toBeGreaterThan(0.4)
    expect(out.slice(40).every(f => !f.has('ParamEyeLOpen'))).toBe(true)
  })

  it('moves gaze, head and posture additively within subtle bounds', () => {
    const base = { ParamAngleX: 2, ParamEyeBallX: 0.1, ParamBodyAngleX: -3 }
    const out = frames({ base, seconds: 60, seed: 7 })
    const range = (id: string, b = 0) => {
      const values = out.map(f => f.get(id)! - b)
      return [Math.min(...values), Math.max(...values)]
    }
    const [gx0, gx1] = range('ParamEyeBallX', 0.1)
    expect(gx1 - gx0).toBeGreaterThan(0.2)
    expect(Math.max(Math.abs(gx0), Math.abs(gx1))).toBeLessThanOrEqual(0.55)
    const [hx0, hx1] = range('ParamAngleX', 2)
    expect(Math.max(Math.abs(hx0), Math.abs(hx1))).toBeLessThanOrEqual(7)
    const [bx0, bx1] = range('ParamBodyAngleX', -3)
    expect(bx1 - bx0).toBeGreaterThan(0.5)
    expect(Math.max(Math.abs(bx0), Math.abs(bx1))).toBeLessThanOrEqual(4)
  })

  it('smooths pointer gaze, yields the entire pose and wink to a gesture, then restores idle', () => {
    let pointer: { x: number; y: number } | undefined = { x: 1, y: -1 }
    let gesture = false
    const source = createIdleLife({ eyeIds: EYES, isGesture: () => gesture, pointer: () => pointer, priority: 20, random: seeded(7) })
    const base: Record<string, number> = { ParamAngleX: 3, ParamEyeLOpen: 0, ParamEyeROpen: 1 }
    const sample = () => source.sample({ readBase: id => base[id] ?? 0, dtMs: 16 })!
    const first = sample()
    expect(first.get('ParamEyeBallX')).toBeGreaterThan(0)
    expect(first.get('ParamEyeBallX')).toBeLessThan(0.3)
    let frame = first
    for (let i = 0; i < 60; i++) frame = sample()
    expect(frame.get('ParamEyeBallX')).toBeCloseTo(0.8)
    expect(frame.get('ParamEyeBallY')).toBeCloseTo(-0.65)
    expect(frame.get('ParamAngleX')).toBeGreaterThan(10)
    gesture = true
    for (let i = 0; i < 40; i++) frame = sample()
    expect(frame.has('ParamEyeLOpen')).toBe(false)
    expect(frame.has('ParamEyeROpen')).toBe(false)
    expect(frame.get('ParamEyeBallX')).toBe(0)
    expect(frame.get('ParamAngleX')).toBe(3)
    pointer = undefined
    gesture = false
    frame = sample()
    expect(frame.get('ParamEyeLOpen')).toBeGreaterThan(0)
    expect(frame.get('ParamEyeLOpen')).toBeLessThan(0.1)
    for (let i = 0; i < 90; i++) frame = sample()
    expect(Math.abs(frame.get('ParamEyeBallX')!)).toBeLessThan(0.6)
  })
})
