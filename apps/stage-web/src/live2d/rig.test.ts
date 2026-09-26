import type { Live2DModel } from 'pixi-live2d-display/cubism4'

import { describe, expect, it, vi } from 'vitest'

import { createRig } from './rig'

function modelStub() {
  const state = {
    currentPriority: 1,
    reservePriority: 0,
    reservedGroup: undefined as string | undefined,
    reservedIndex: undefined as number | undefined,
    setReserved(group: string | undefined, index: number | undefined, priority: number) {
      this.reservedGroup = group
      this.reservedIndex = index
      this.reservePriority = priority
    },
  }
  const setIsLoop = vi.fn()
  const loadMotion = vi.fn(async (_group: string, _index: number) => ({ setIsLoop }))
  const motion = vi.fn(async (_group: string, _index: number, priority: number) => {
    state.currentPriority = priority
    return true
  })
  const internalModel = {
    settings: {
      motions: {
        Idle: [{ File: 'motions/idle.motion3.json' }],
        '': Array.from({ length: 6 }, (_, index) => ({ File: `motions/gesture_${index}.motion3.json` })),
      },
      hitAreas: [{ Id: 'Head', Name: '' }, { Id: 'Body', Name: '' }],
      getEyeBlinkParameters: () => ['Left', 'Right'],
      getLipSyncParameters: () => ['Mouth'],
    },
    getDrawableIndex: (id: string) => id === 'Head' ? 0 : 1,
    hitAreas: {},
    motionManager: { groups: { idle: 'Idle' }, loadMotion, state, destroyed: false },
  }
  return { model: { internalModel, motion } as unknown as Live2DModel, internalModel, state, motion, loadMotion, setIsLoop }
}

describe('gesture coordination', () => {
  it('plays all six gestures once before refilling, preserves unnamed hit areas, and leaves idle looping alone', async () => {
    const stub = modelStub()
    const rig = await createRig(stub.model, () => 0)
    expect(stub.loadMotion).toHaveBeenCalledTimes(6)
    expect(stub.loadMotion.mock.calls.every(([group]) => group !== 'Idle')).toBe(true)
    expect(stub.setIsLoop.mock.calls).toEqual(Array.from({ length: 6 }, () => [false]))
    expect(Object.keys(stub.internalModel.hitAreas)).toEqual(['Head', 'Body'])
    for (let i = 0; i < 7; i++) {
      stub.state.currentPriority = 1 // the native engine has returned to idle
      expect(await rig.playRandomMotion()).toBe(true)
    }
    const picked = stub.motion.mock.calls.map(([, index]) => index)
    expect(new Set(picked.slice(0, 6)).size).toBe(6)
    expect(picked[6]).not.toBe(picked[5])
  })

  it('blocks repeated clicks, lets emotion interrupt a click, and reports the engine result', async () => {
    const stub = modelStub()
    const rig = await createRig(stub.model)
    expect(await rig.playMotion('gesture_0')).toBe(true)
    expect(await rig.playRandomMotion()).toBe(false)
    expect(await rig.playMotion('gesture_1', 'emotion')).toBe(true)
    expect(stub.motion.mock.calls.map(([, , priority]) => priority)).toEqual([2, 3])
    expect(await rig.playMotion('gesture_2', 'emotion')).toBe(false)
    stub.state.currentPriority = 1
    stub.motion.mockResolvedValueOnce(false)
    expect(await rig.playMotion('gesture_2')).toBe(false)
    expect(rig.isGesture()).toBe(false)
    expect(await rig.playMotion('absent')).toBe(false)
  })

  it('yields layers during startup and recovers after a rejected playback', async () => {
    const stub = modelStub()
    const rig = await createRig(stub.model)
    let finish!: (started: boolean) => void
    stub.motion.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = rig.playMotion('gesture_0')
    expect(rig.isGesture()).toBe(true)
    expect(await rig.playRandomMotion()).toBe(false)
    stub.state.setReserved('', 0, 2)
    finish(false)
    expect(await request).toBe(false)
    expect(rig.isGesture()).toBe(false)
    expect(await rig.playRandomMotion()).toBe(true)
  })
})
