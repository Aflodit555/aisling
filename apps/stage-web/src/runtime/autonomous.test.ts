import { describe, expect, it, vi } from 'vitest'
import { AUTONOMOUS_COOLDOWN_MS, createAutonomousController, createAutonomousState, type DesktopObservation } from './autonomous'

function setup() {
  let time = 0
  let busy = false
  let ready = true
  const state = createAutonomousState()
  const readDesktop = vi.fn(async (): Promise<DesktopObservation> => ({
    activity: { app: 'Code', title: 'main.ts' }, idleSeconds: time / 1000, available: true,
  }))
  const trigger = vi.fn()
  const controller = createAutonomousController({
    state, readDesktop, trigger, now: () => time, isBusy: () => busy, isReady: () => ready,
  })
  return { state, readDesktop, trigger, controller,
    time: (next: number) => { time = next }, busy: (next: boolean) => { busy = next }, ready: (next: boolean) => { ready = next } }
}

describe('autonomous deterministic gate', () => {
  it('does not poll or infer while disabled; polls below threshold without producing stimuli', async () => {
    const h = setup()
    h.time(100_000)
    await h.controller.tick()
    expect(h.readDesktop).not.toHaveBeenCalled()
    h.controller.setEnabled(true)
    h.time(150_000)
    await h.controller.tick()
    expect(h.state.latestActivity.app).toBe('Code')
    expect(h.trigger).not.toHaveBeenCalled()
    h.time(190_000)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
    expect(h.trigger.mock.calls[0]![0]).toMatchObject({ kind: 'autonomous', silenceSeconds: 90 })
  })

  it('keeps human silence unchanged after output and enforces cooldown after a slow response', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    h.time(90_000)
    await h.controller.tick()
    h.busy(true)
    h.time(400_000)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
    h.busy(false)
    h.controller.completed()
    await h.controller.tick()
    expect(h.state.silenceSeconds).toBe(400)
    expect(h.trigger).toHaveBeenCalledOnce()
    h.time(400_000 + AUTONOMOUS_COOLDOWN_MS)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledTimes(2)
  })

  it.each(['human', 'disable', 'threshold'] as const)('cancels a pending observation on %s and never blocks human input', async (action) => {
    const h = setup()
    h.controller.setEnabled(true)
    h.time(90_000)
    let resolve!: (result: DesktopObservation) => void
    h.readDesktop.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = h.controller.tick()
    await h.controller.tick()
    expect(h.readDesktop).toHaveBeenCalledOnce()
    if (action === 'human') h.controller.noteHumanInteraction()
    if (action === 'disable') h.controller.setEnabled(false)
    if (action === 'threshold') h.controller.setThreshold(120)
    resolve({ activity: { app: 'Code' }, idleSeconds: 90, available: true })
    await pending
    expect(h.trigger).not.toHaveBeenCalled()
    expect(h.state.pending).toBe(false)
  })

  it('defers to desktop input, ongoing cognition/vision/speech and unavailable providers', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    h.time(90_000)
    h.readDesktop.mockResolvedValueOnce({ activity: { app: 'Code' }, idleSeconds: 2, available: true })
    await h.controller.tick()
    expect(h.state.silenceSeconds).toBe(2)
    expect(h.trigger).not.toHaveBeenCalled()
    h.time(190_000)
    h.busy(true)
    await h.controller.tick()
    h.busy(false)
    h.ready(false)
    await h.controller.tick()
    expect(h.trigger).not.toHaveBeenCalled()
    h.ready(true)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
  })

  it('does not infer from failed reads, retries without stale activity, and clamps invalid thresholds', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    h.time(90_000)
    h.readDesktop.mockRejectedValueOnce(new Error('IPC failed'))
    await h.controller.tick()
    expect(h.state.error).toBe('IPC failed')
    h.readDesktop.mockResolvedValueOnce({ activity: {}, idleSeconds: 90, available: false })
    await h.controller.tick()
    expect(h.trigger).not.toHaveBeenCalled()
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
    h.controller.setThreshold(NaN)
    expect(h.state.thresholdSeconds).toBe(90)
    h.controller.setThreshold(-1)
    expect(h.state.thresholdSeconds).toBe(10)
  })
})
