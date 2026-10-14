import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AutonomousStimulus, DesktopActivitySnapshot } from '@aisling/core'
import { createAutonomousController, createAutonomousState, type DesktopDiagnosticRecord, type DesktopJudgeRequest } from './autonomous'

const track = (title = 'A') => ({ app: 'player', title, artist: 'Artist' })
function harness(diagnostics = false) {
  let time = 1000, busy = false, ready = true, probability = 0.9, history = false
  let context: DesktopActivitySnapshot = { capturedAt: time, sequence: 1, targetHwnd: '123',
    focus: { app: 'chrome', title: 'Article', text: 'Current article' }, idleSeconds: 0, media: [], mic: [], headphones: '' }
  const state = createAutonomousState(), logs: DesktopDiagnosticRecord[] = []
  const read = vi.fn(async () => ({ enabled: true, available: true, context }))
  const judge = vi.fn(async (_request: DesktopJudgeRequest) => ({ context, scores: { shouldInterrupt: probability } }))
  const trigger = vi.fn((_stimulus: AutonomousStimulus) => {})
  const controller = createAutonomousController({ state, readDesktop: read, judgeDesktop: judge, trigger, now: () => time,
    isBusy: () => busy, isReady: () => ready, getCooldownMs: () => 30_000, getReplyHistoryEnabled: () => history,
    diagnostic: diagnostics ? record => logs.push(record) : undefined })
  controller.setEnabled(true)
  async function tick(at: number, patch: Partial<DesktopActivitySnapshot> = {}) {
    time = at; context = { ...context, ...patch, capturedAt: at, sequence: context.sequence! + 1 }
    context = { ...context, textFingerprint: createHash('sha256').update(context.focus.text.replace(/\s+/g, ' ').trim()).digest('hex') }
    await controller.tick()
  }
  return { state, logs, read, judge, trigger, controller, tick, context: () => context,
    finish: (success = true) => controller.completed(trigger.mock.calls.at(-1)![0], success, success ? 'Delivered reply.' : undefined),
    busy: (value: boolean) => { busy = value }, ready: (value: boolean) => { ready = value }, probability: (value: number) => { probability = value }, history: (value: boolean) => { history = value } }
}

describe('candidate-based autonomous controller', () => {
  it('does not rejudge the same song for lyrics, duplicate sessions, ambiguity, order or dropout', async () => {
    const h = harness()
    await h.tick(1000, { focus: { app: 'player', title: 'A', text: 'Lyric 1' }, media: [track()] })
    await h.tick(3000); h.finish()
    for (let at = 5000; at < 30000; at += 2000)
      await h.tick(at, { focus: { app: 'player', title: 'A', text: `Lyric ${at}` }, idleSeconds: at / 1000 })
    await h.tick(31000, { media: [track(), track('B')] })
    await h.tick(33000, { media: [track('B'), track()] })
    await h.tick(35000, { media: [] })
    await h.tick(37000, { media: [track()] })
    await h.tick(39000, { media: [track(), track()] })
    expect(h.judge).toHaveBeenCalledOnce(); expect(h.trigger).toHaveBeenCalledOnce()
  })
  it.each([0.64, 0.65])('preserves the exact interrupt boundary at %s', async score => {
    const h = harness(); h.probability(score); await h.tick(1000)
    expect(h.trigger).toHaveBeenCalledTimes(score >= 0.65 ? 1 : 0)
  })
  it('keeps a static article silent through idle growth and a window round trip', async () => {
    const h = harness(); await h.tick(1000); h.finish()
    const first = h.trigger.mock.calls[0]![0].candidate
    for (let at = 3000; at < 90000; at += 2000) await h.tick(at, { idleSeconds: at / 1000 })
    await h.tick(91000, { focus: { app: 'qq', title: 'QQ', text: 'Conversation' } })
    h.finish()
    await h.tick(93000, { focus: { app: 'chrome', title: 'Article', text: 'Current article' } })
    expect(h.trigger).toHaveBeenCalledTimes(2)
    expect(h.judge).toHaveBeenCalledTimes(2)
    expect(h.state.observations.find(record => record.candidateId === first.id)?.status).toBe('handled')
    expect(h.state.decisions.at(-1)?.reason).toBe('duplicate')
  })
  it('recognizes real new text in the same window with the same object and a new candidate', async () => {
    const h = harness(); await h.tick(1000); h.finish()
    const first = h.trigger.mock.calls[0]![0].candidate
    await h.tick(31000, { focus: { app: 'chrome', title: 'Article', text: 'A different article' } })
    expect(h.state.decisions.at(-1)?.reason).toBe('foreground-stabilizing')
    await h.tick(33000)
    const next = h.trigger.mock.calls[1]![0].candidate
    expect(next.objectId).toBe(first.objectId); expect(next.id).not.toBe(first.id); expect(next.change).toBe('content-changed')
  })
  it.each([false, true])('does not reuse a high cached revision after returning to a replied-to page (history=%s)', async history => {
    const h = harness(true); h.history(history)
    await h.tick(1000); h.finish()
    const page = { app: 'chrome', title: 'Article', text: 'Current article variation' }
    await h.tick(3000, { focus: page }); await h.tick(5000)
    const pending = h.state.observations.at(-1)!
    expect(pending.judgment?.scores.shouldInterrupt).toBe(0.9)
    expect(h.state.decisions.at(-1)?.reason).toBe('cooldown')
    h.probability(0.2)
    await h.tick(7000, { focus: { app: 'qq', title: 'QQ', text: 'Conversation' } })
    await h.tick(33000, { focus: page }); await h.tick(35000)
    expect(pending.status).toBe('superseded'); expect(pending.judgment).toBeUndefined()
    expect(h.trigger).toHaveBeenCalledOnce(); expect(h.judge).toHaveBeenCalledTimes(3)
    expect(h.state.decisions.at(-1)?.reason).toBe('foreground-superseded')
    expect(h.logs.at(-1)).toMatchObject({ type: 'gate', reason: 'foreground-superseded', candidateId: pending.candidateId })
    h.probability(0.9)
    await h.tick(37000, { focus: { app: 'chrome', title: 'New webpage', text: 'New page body' } })
    await h.tick(39000)
    expect(h.trigger).toHaveBeenCalledTimes(2)
    expect(h.trigger.mock.calls[1]![0].candidate.target).toMatchObject({ title: 'New webpage', text: 'New page body' })
  })
  it('absorbs revisions sampled during generation, but permits later stable content', async () => {
    const h = harness()
    await h.tick(1000); h.busy(true)
    await h.tick(3000, { focus: { app: 'chrome', title: 'Article', text: 'Article variation' } })
    await h.tick(5000)
    h.finish(); h.busy(false)
    await h.tick(35000)
    expect(h.trigger).toHaveBeenCalledOnce(); expect(h.judge).toHaveBeenCalledOnce()
    await h.tick(37000, { focus: { app: 'chrome', title: 'Article', text: 'Later scrolled section' } })
    await h.tick(39000)
    expect(h.trigger).toHaveBeenCalledTimes(2)
  })
  it('discards an in-flight revision judgment if another successful delivery supersedes it', async () => {
    const h = harness(true)
    await h.tick(1000)
    const original = h.trigger.mock.calls[0]![0]
    h.busy(true)
    await h.tick(3000, { focus: { app: 'chrome', title: 'Article', text: 'Article variation' } })
    await h.tick(5000)
    const pending = h.state.observations.at(-1)!
    h.busy(false)
    let finish!: (result: Awaited<ReturnType<typeof h.judge>>) => void
    h.judge.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const judging = h.tick(33000)
    await vi.waitFor(() => expect(h.judge).toHaveBeenCalledTimes(2))
    h.controller.completed(original, true, 'Original article comment.')
    finish({ context: h.context(), scores: { shouldInterrupt: 0.9 } })
    await judging
    expect(pending.status).toBe('superseded'); expect(pending.judgment).toBeUndefined()
    expect(h.trigger).toHaveBeenCalledOnce()
    expect(h.logs.some(log => log.type === 'judge-discarded' && log.reason === 'foreground-superseded')).toBe(true)
  })
  it('does not turn a declined article into a new judgment merely by returning from another window', async () => {
    const h = harness(); h.probability(0.2)
    await h.tick(1000)
    await h.tick(3000, { focus: { app: 'qq', title: 'QQ', text: 'Conversation' } })
    h.probability(0.9)
    await h.tick(5000, { focus: { app: 'chrome', title: 'Article', text: 'Current article' } })
    expect(h.judge).toHaveBeenCalledTimes(2)
    expect(h.trigger).not.toHaveBeenCalled()
    expect(h.state.decisions.at(-1)?.reason).toBe('below-threshold')
  })
  it('binds background B to B even with stale A lyrics, without making the article a new opportunity', async () => {
    const h = harness(); await h.tick(1000, { media: [track()] }); h.finish()
    await h.tick(3000)
    await h.tick(31000)
    expect(h.trigger.mock.calls.at(-1)![0].candidate).toMatchObject({ source: 'media', target: { title: 'A' } })
    h.finish()
    await h.tick(61000, { media: [track('B')] })
    await h.tick(63000)
    const next = h.trigger.mock.calls.at(-1)![0]
    expect(next.candidate).toMatchObject({ source: 'media', target: { title: 'B' } })
    expect(h.context().focus.text).toBe('Current article')
    expect(h.state.observations.filter(record => record.source === 'foreground')).toHaveLength(1)
    expect(h.judge.mock.calls.at(-1)![0].candidate.target).toEqual(next.candidate.target)
  })
  it('does not request equivalent judgments for growing idle but retains one idle opening after a decline', async () => {
    const h = harness(); h.probability(0.2)
    for (let at = 1000; at < 60000; at += 2000) await h.tick(at, { idleSeconds: at / 1000 })
    expect(h.judge).toHaveBeenCalledOnce(); expect(h.trigger).not.toHaveBeenCalled()
    h.probability(0.9); await h.tick(61000, { idleSeconds: 60 })
    expect(h.trigger.mock.calls[0]![0].candidate.change).toBe('idle')
    expect(h.judge).toHaveBeenCalledTimes(2)
  })
  it.each(['quiet', 'busy', 'not-ready', 'below-threshold', 'cooldown'] as const)('preserves the %s gate', async reason => {
    const h = harness()
    if (reason === 'quiet') h.controller.setPreference('quiet', 'command')
    if (reason === 'busy') h.busy(true)
    if (reason === 'not-ready') h.ready(false)
    if (reason === 'below-threshold') h.probability(0.64)
    if (reason === 'cooldown') { await h.tick(1000); h.finish() }
    await h.tick(3000, reason === 'cooldown' ? { focus: { app: 'chrome', title: 'Article', text: 'New text' } } : {})
    if (reason === 'cooldown') await h.tick(5000)
    expect(h.state.decisions.at(-1)?.reason).toBe(reason)
    expect(h.trigger).toHaveBeenCalledTimes(reason === 'cooldown' ? 1 : 0)
    if (reason === 'quiet') expect(h.read).not.toHaveBeenCalled()
  })
  it('does not mark failed output handled and retries after cooldown with the same target', async () => {
    const h = harness(); await h.tick(1000); h.finish(false)
    const candidate = h.trigger.mock.calls[0]![0].candidate
    await h.tick(31000)
    expect(h.trigger).toHaveBeenCalledTimes(2)
    expect(h.trigger.mock.calls[1]![0].candidate.id).toBe(candidate.id)
    expect(h.state.observations[0]?.deliveredAt).toBeNull()
    expect(h.judge).toHaveBeenCalledOnce()
  })
  it('discards a media judgment when the before-Chat freshness read finds another track', async () => {
    const h = harness(true)
    await h.tick(1000, { focus: { app: 'player', title: 'A', text: 'Lyric A' }, media: [track()] })
    const original = h.judge.getMockImplementation()!
    h.judge.mockImplementationOnce(async request => {
      const result = await original(request)
      h.read.mockResolvedValueOnce({ enabled: true, available: true, context: { ...result.context, media: [track('B')] } })
      return result
    })
    await h.tick(3000)
    expect(h.trigger).not.toHaveBeenCalled()
    expect(h.state.decisions.at(-1)?.reason).toBe('media-stale')
    expect(h.logs.some(log => log.type === 'judge-discarded' && log.reason === 'media-stale')).toBe(true)
  })
  it('rechecks busy after an asynchronous judgment instead of starting a concurrent reply', async () => {
    const h = harness()
    const original = h.judge.getMockImplementation()!
    h.judge.mockImplementationOnce(async request => { const result = await original(request); h.busy(true); return result })
    await h.tick(1000)
    expect(h.trigger).not.toHaveBeenCalled()
    expect(h.state.decisions.at(-1)?.reason).toBe('busy')
  })
  it.each([false, true])('keeps calls identical with diagnostic enabled=%s and retains cached judgment mapping', async enabled => {
    const h = harness(enabled); await h.tick(1000); h.finish(false); await h.tick(31000)
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.judge).toHaveBeenCalledOnce(); expect(h.trigger).toHaveBeenCalledTimes(2)
    if (!enabled) { expect(h.logs).toEqual([]); expect(h.judge.mock.calls[0]![0]).not.toHaveProperty('diagnostic'); return }
    const request = h.logs.find(log => log.type === 'judge-requested')!, cached = h.logs.find(log => log.type === 'judge-cached')!
    expect(cached.judgmentId).toBe(request.judgmentId); expect(cached.judgmentSampleId).toBe(request.sampleId)
    h.controller.recordOutputDiagnostic(h.trigger.mock.calls[1]![0], 'delivery', { delivered: true, text: 'Reply.' })
    expect(h.logs.at(-1)).toMatchObject({ judgmentId: request.judgmentId, candidateId: request.candidateId, replyTarget: 'unknown', intendedTarget: 'foreground' })
    expect(JSON.stringify(h.logs)).not.toMatch(/Current article|Delivered reply\.|Reply\./)
  })
  it('quiet or OFF invalidates an in-flight judgment, and pending does not capture twice', async () => {
    for (const mode of ['quiet', 'off']) {
      const h = harness(); let finish!: (result: Awaited<ReturnType<typeof h.judge>>) => void
      h.judge.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const pending = h.tick(1000)
      await vi.waitFor(() => expect(h.judge).toHaveBeenCalledOnce())
      await h.controller.tick(); expect(h.state.decisions.at(-1)?.reason).toBe('pending')
      if (mode === 'quiet') h.controller.setPreference('quiet', 'command'); else h.controller.setEnabled(false)
      finish({ context: h.context(), scores: { shouldInterrupt: 0.9 } }); await pending
      expect(h.trigger).not.toHaveBeenCalled(); expect(h.read).toHaveBeenCalledOnce()
      expect(h.state.decisions.at(-1)?.reason).toBe('invalidated')
    }
  })
  it('captures Jev failure and missing foreground evidence without a made-up candidate', async () => {
    const h = harness(true); h.judge.mockRejectedValueOnce(new Error('Model failed'))
    await h.tick(1000); expect(h.state.error).toBe('Model failed'); expect(h.trigger).not.toHaveBeenCalled()
    await h.tick(3000, { focus: { app: 'chrome', title: 'Article', text: '' } })
    expect(h.state.decisions.at(-1)?.reason).toBe('foreground-unavailable')
    expect(h.judge).toHaveBeenCalledOnce()
  })
})
