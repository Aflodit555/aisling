import { describe, expect, it, vi } from 'vitest'
import { createAutonomousController, createAutonomousState, type DesktopObserverStatus } from './autonomous'

const context = (title = 'main.ts'): NonNullable<DesktopObserverStatus['context']> => ({
  idleSeconds: 0,
  focus: { app: 'Code', title, text: 'const answer = 42' },
  media: [], mic: [], headphones: '',
})

function setup() {
  let time = 0
  let busy = false
  let ready = true
  let cooldownMs = 30_000
  const state = createAutonomousState()
  const readDesktop = vi.fn(async () => ({ enabled: true, available: true, context: context() }))
  const judgeDesktop = vi.fn(async () => ({
    context: context(), scores: { shouldInterrupt: 0.9 },
  }))
  const trigger = vi.fn()
  const controller = createAutonomousController({
    state, readDesktop, judgeDesktop, trigger, now: () => time, isBusy: () => busy, isReady: () => ready,
    getCooldownMs: () => cooldownMs,
  })
  return { state, readDesktop, judgeDesktop, trigger, controller,
    time: (next: number) => { time = next }, busy: (next: boolean) => { busy = next }, ready: (next: boolean) => { ready = next },
    cooldown: (next: number) => { cooldownMs = next } }
}

describe('desktop awareness gate', () => {
  it.each(['mic', 'idle', 'text'] as const)('rejudges when only %s changes after a negative decision', async (field) => {
    const h = setup()
    const initial = { ...context(), focus: { ...context().focus, text: 'x'.repeat(600) + 'old' } }
    h.readDesktop.mockResolvedValue({ enabled: true, available: true, context: initial })
    h.judgeDesktop.mockResolvedValue({ context: initial, scores: { shouldInterrupt: 0.1 } })
    h.controller.setEnabled(true)
    await h.controller.tick()
    const changed = {
      ...initial,
      mic: field === 'mic' ? ['Teams'] : initial.mic,
      idleSeconds: field === 'idle' ? 120 : initial.idleSeconds,
      focus: { ...initial.focus, text: field === 'text' ? 'x'.repeat(600) + 'new' : initial.focus.text },
    }
    h.readDesktop.mockResolvedValue({ enabled: true, available: true, context: changed })
    h.judgeDesktop.mockResolvedValue({ context: changed, scores: { shouldInterrupt: 0.9 } })
    await h.controller.tick()
    expect(h.judgeDesktop).toHaveBeenCalledTimes(2)
    expect(h.trigger).toHaveBeenCalledOnce()
  })

  it('surfaces judge errors, releases pending and retries unchanged context', async () => {
    const h = setup()
    h.judgeDesktop.mockRejectedValueOnce(new Error('judge timeout'))
    h.controller.setEnabled(true)
    await h.controller.tick()
    expect(h.state.error).toBe('judge timeout')
    expect(h.state.pending).toBe(false)
    expect(h.trigger).not.toHaveBeenCalled()
    await h.controller.tick()
    expect(h.state.error).toBe('')
    expect(h.trigger).toHaveBeenCalledOnce()
  })

  it('does nothing while off, then judges changed content and triggers once', async () => {
    const h = setup()
    await h.controller.tick()
    expect(h.readDesktop).not.toHaveBeenCalled()
    h.controller.setEnabled(true)
    await h.controller.tick()
    expect(h.judgeDesktop).toHaveBeenCalledOnce()
    expect(h.trigger).toHaveBeenCalledOnce()
    await h.controller.tick()
    expect(h.judgeDesktop).toHaveBeenCalledOnce()
    expect(h.trigger).toHaveBeenCalledOnce()
  })

  it('applies a changed 15s cooldown immediately to a new context', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    await h.controller.tick()
    h.time(1_000)
    h.controller.completed()
    h.readDesktop.mockResolvedValue({ enabled: true, available: true, context: context('next.ts') })
    h.judgeDesktop.mockResolvedValue({ context: context('next.ts'), scores: { shouldInterrupt: 0.9 } })
    h.time(15_999)
    h.cooldown(15_000)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
    h.time(16_000)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledTimes(2)
  })

  it.each([[0.65, true], [0.64, false]])('gates should_interrupt=%s at the existing 0.65 threshold', async (shouldInterrupt, allowed) => {
    const h = setup()
    h.judgeDesktop.mockResolvedValue({ context: context(), scores: { shouldInterrupt } })
    h.controller.setEnabled(true)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('defers while the existing runtime is busy or unavailable', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    h.busy(true)
    await h.controller.tick()
    expect(h.trigger).not.toHaveBeenCalled()
    h.busy(false)
    h.ready(false)
    await h.controller.tick()
    expect(h.trigger).not.toHaveBeenCalled()
    h.ready(true)
    await h.controller.tick()
    expect(h.trigger).toHaveBeenCalledOnce()
  })

  it('invalidates an in-flight judge immediately when disabled', async () => {
    const h = setup()
    h.controller.setEnabled(true)
    let resolve!: () => void
    h.judgeDesktop.mockImplementationOnce(() => new Promise(done => { resolve = () => done({
      context: context(), scores: { shouldInterrupt: 1 },
    }) }))
    const pending = h.controller.tick()
    await vi.waitFor(() => expect(h.judgeDesktop).toHaveBeenCalled())
    h.controller.setEnabled(false)
    resolve()
    await pending
    expect(h.trigger).not.toHaveBeenCalled()
    expect(h.state.enabled).toBe(false)
  })
})
