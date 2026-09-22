import { describe, expect, it } from 'vitest'

import { createMouthController, type MouthControllerInput } from './mouth-controller'

function input(overrides: Partial<MouthControllerInput> = {}): MouthControllerInput {
  return { speaking: false, level: undefined, dtMs: 16, baseMouth: 0, ...overrides }
}

describe('mouth controller', () => {
  it('owns the mouth while speaking with a signal', () => {
    const controller = createMouthController()
    const frame = controller.update(input({ speaking: true, level: 0.25 }))
    expect(frame.ownsMouth).toBe(true)
    expect(frame.mouthOpen).toBeGreaterThan(0)
  })

  it('does not claim the mouth while speaking with no signal (browser speech)', () => {
    const controller = createMouthController()
    const frame = controller.update(input({ speaking: true, level: undefined }))
    expect(frame.ownsMouth).toBe(false)
  })

  it('cross-fades toward the native value during release', () => {
    const controller = createMouthController()
    controller.update(input({ speaking: true, level: 0.25 }))
    const active = controller.update(input({ speaking: true, level: 0.25 }))
    const last = active.mouthOpen

    const first = controller.update(input({ speaking: false, baseMouth: 0.8 }))
    expect(first.ownsMouth).toBe(true)
    expect(first.mouthOpen).toBeGreaterThan(last * 0.5)

    let late = first.mouthOpen
    for (let i = 0; i < 11; i++)
      late = controller.update(input({ speaking: false, baseMouth: 0.8 })).mouthOpen
    expect(late).toBeGreaterThan(last)
    expect(late).toBeLessThan(0.8)
  })

  it('moves to handoff after release and then releases ownership', () => {
    const controller = createMouthController()
    controller.update(input({ speaking: true, level: 0.25 }))

    let owns = true
    let sawHandoff = false
    for (let i = 0; i < 60; i++) {
      const frame = controller.update(input({ speaking: false, baseMouth: 0 }))
      if (frame.ownsMouth && frame.mouthOpen === 0)
        sawHandoff = true
      owns = frame.ownsMouth
    }

    expect(sawHandoff).toBe(true)
    expect(owns).toBe(false)
  })

  it('re-claims the mouth when new speech starts during release/handoff', () => {
    const controller = createMouthController()
    controller.update(input({ speaking: true, level: 0.25 }))
    controller.update(input({ speaking: false, baseMouth: 0 }))

    const frame = controller.update(input({ speaking: true, level: 0.25 }))
    expect(frame.ownsMouth).toBe(true)
    expect(frame.mouthOpen).toBeGreaterThan(0)
  })

  it('never claims when there was never a signal', () => {
    const controller = createMouthController()
    for (let i = 0; i < 10; i++)
      controller.update(input({ speaking: true, level: undefined }))
    expect(controller.update(input({ speaking: false })).ownsMouth).toBe(false)
  })

  it('reset() returns to idle and releases ownership', () => {
    const controller = createMouthController()
    controller.update(input({ speaking: true, level: 0.25 }))
    controller.reset()
    expect(controller.update(input({ speaking: false })).ownsMouth).toBe(false)
  })
})
