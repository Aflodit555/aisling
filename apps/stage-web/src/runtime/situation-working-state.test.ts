import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutonomousStimulus, createUserTextStimulus, createOpenAICompatibleProvider, type DesktopActivitySnapshot } from '@aisling/core'
import { createAutonomousController, createAutonomousState, type DesktopJudgeRequest } from './autonomous'
import type { DesktopDiagnosticRecord } from './autonomous'
import { situationEnableThinking } from './provider-factory'
import { createSituationWorkingState, providerSituationExecutor, SITUATION_LIMITS, situationRequest,
  validateSituationUpdate, isSituationCorrection, type SituationInput, type SituationUpdate } from './situation-working-state'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function frame(text = 'Paper says main context is accessible.', title = 'Paper', hwnd = '123'): DesktopActivitySnapshot {
  return { capturedAt: Date.now(), targetHwnd: hwnd, sequence: Date.now(), textFingerprint: hash(text),
    focus: { app: 'browser', title, text }, idleSeconds: 0, media: [], mic: [], headphones: '' }
}
function reply(input: SituationInput): SituationUpdate {
  const e = input.incoming.at(-1) ?? input.evidence[0]!
  return { scope: input.scope, baseRevision: input.baseRevision, covered: input.incoming.map(e => e.id),
    claims: e ? [{ kind: 'fact', text: `${e.kind} reports: ${e.text.slice(0, 180)}`,
      evidence: [{ id: e.id, version: e.version, quote: e.text.slice(0, 180) }] }] : input.previous?.claims ?? [],
    retracted: [], unknowns: ['Actual user attention is unknown.'] }
}
const user = () => createUserTextStimulus({ source: 'web', text: '解释当前页面的进展' })
function candidate(s: DesktopActivitySnapshot) {
  return createAutonomousStimulus({ candidate: { id: 'c', objectId: 'o', source: 'foreground', change: 'appeared',
    snapshot: s, target: s.focus } })
}
const flushPromises = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('bounded asynchronous situation working state (offline)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000) })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['https://api.ppio.com/openai', 'qwen/qwen3.8-flash', false],
    ['https://api.ppio.com/openai/v1/', 'qwen/qwen3.8-flash', false],
    ['https://api.ppio.com/openai', 'other-model', undefined],
    ['https://other.invalid/openai', 'qwen/qwen3.8-flash', undefined],
    ['https://api.ppio.com.evil.invalid/openai', 'qwen/qwen3.8-flash', undefined],
    ['https://api.ppio.com/other', 'qwen/qwen3.8-flash', undefined],
    ['https://api.ppio.com/openai?token=mock', 'qwen/qwen3.8-flash', undefined],
    ['http://api.ppio.com/openai', 'qwen/qwen3.8-flash', undefined],
    ['invalid-url', 'qwen/qwen3.8-flash', undefined],
  ] as const)('limits non-thinking policy to the explicit PPIO route (%s, %s)', (baseUrl, model, expected) => {
    expect(situationEnableThinking({ providerType: 'openai-compatible', baseUrl, model })).toBe(expected)
  })

  it.each([true, false])('isolates A overrides with or without a streaming provider (stream=%s)', async stream => {
    const bodies: Record<string, unknown>[] = []
    const config = { providerType: 'openai-compatible' as const, baseUrl: 'https://api.ppio.com/openai', model: 'qwen/qwen3.8-flash' }
    const provider = createOpenAICompatibleProvider({ ...config, apiKey: 'MOCK_ONLY', temperature: 1.2, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init!.body as string); bodies.push(body)
      const text = body.max_completion_tokens ? JSON.stringify(reply(JSON.parse(body.messages[1].content))) : 'Ordinary B reply'
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { headers: { 'Content-Type': 'application/json' } })
    } })
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => stream ? provider : { ...provider, stream: undefined },
      { getEnableThinking: () => situationEnableThinking(config) }) })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(s.status.revision).toBe(1)
    expect(bodies[0]).toMatchObject({ stream, enable_thinking: false, max_completion_tokens: 800, temperature: 0.2 })
    expect(bodies[0]).not.toHaveProperty('extra_body'); expect(bodies[0]).not.toHaveProperty('max_tokens')
    await provider.stream!({ messages: [{ role: 'user', content: 'Ordinary user message' }] }, () => {})
    expect(bodies[1]).toEqual({ model: config.model, messages: [{ role: 'user', content: 'Ordinary user message' }], stream: true, temperature: 1.2 })
    s.setEnabled(false); s.observe(frame('Another snapshot')); await vi.advanceTimersByTimeAsync(20_000)
    expect(bodies).toHaveLength(2); s.dispose()
  })

  it('starts the first snapshot at 1.5s and records arrival-to-commit without leaking content', async () => {
    const records: DesktopDiagnosticRecord[] = []
    const execute = vi.fn(async (i: SituationInput) => { await new Promise(resolve => setTimeout(resolve, 2500)); return reply(i) })
    const s = createSituationWorkingState({ execute, diagnostic: r => records.push(r) })
    s.setEnabled(true); const original = frame('Public first observation')
    const snapshot = { ...original, focus: { ...original.focus } }; s.observe(snapshot)
    snapshot.focus.text = 'Mutation after capture'
    await vi.advanceTimersByTimeAsync(1499); expect(execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![0].incoming[0]!.text).toBe('Public first observation')
    expect(s.status.revision).toBe(0)
    await vi.advanceTimersByTimeAsync(2500)
    expect(s.status.revision).toBe(1)
    expect(records.find(r => r.type === 'p2-a-update-start')).toMatchObject({ queueDelayMs: 1500, firstReceivedAt: 100_000, scheduledAt: 100_000 })
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ snapshotToCommitMs: 4000, latestSnapshotToCommitMs: 4000, usable: true })
    expect(JSON.stringify(records)).not.toContain('Public first observation'); s.dispose()
  })

  it('coalesces continuous scrolling without a sliding deadline or request storm, even via flush', async () => {
    const starts: number[] = []
    const execute = vi.fn(async (i: SituationInput) => { starts.push(Date.now()); return reply(i) })
    const s = createSituationWorkingState({ execute }); s.setEnabled(true)
    for (let n = 0; n < 40; n++) {
      s.observe(frame(`Scroll ${n}`))
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(starts.length).toBe(3)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(SITUATION_LIMITS.minIntervalMs)
    expect(execute.mock.calls[1]![0].incoming).toHaveLength(6)
    expect(s.status.omissions).toBeGreaterThan(0)
    await s.flush(); expect(starts.length).toBe(3)
    await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs); expect(starts.length).toBe(4)
    const last = frame('Scroll 39'); s.observe(last)
    for (let n = 0; n < 10; n++) { await vi.advanceTimersByTimeAsync(2000); s.observe(frame('Scroll 39')) }
    expect(starts.length).toBe(4); s.dispose()
  })

  it('exposes the limit: 3s execution with a new version every 2s makes history but no safe B context', async () => {
    const records: DesktopDiagnosticRecord[] = []
    const s = createSituationWorkingState({ diagnostic: r => records.push(r), execute: async i => {
      await new Promise(resolve => setTimeout(resolve, 3000)); return reply(i)
    } })
    s.setEnabled(true); s.observe(frame('Page 0'))
    for (let n = 1; n <= 6; n++) { await vi.advanceTimersByTimeAsync(2000); s.observe(frame(`Page ${n}`)) }
    const commits = records.filter(r => r.type === 'p2-a-update-end' && r.committed)
    expect(commits.length).toBeGreaterThan(0)
    expect(commits.every(r => r.usable === false)).toBe(true)
    expect(s.snapshot()).toBeDefined(); expect(s.contextFor(user())).toBeUndefined()
    s.dispose()
  })

  it('does not parse or commit a partial stream; cancellation rejects a late complete result', async () => {
    let finish!: (v: { text: string }) => void, captured!: SituationInput
    const complete = vi.fn(async () => ({ text: '' }))
    const stream = vi.fn((r: import('@aisling/core').ChatCompletionRequest, onText: (text: string) => void) => {
      captured = JSON.parse(r.messages[1]!.content!) as SituationInput
      onText('{"scope":')
      return new Promise<{ text: string }>(resolve => { finish = resolve })
    })
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => ({ id: 'mock', complete, stream })) })
    s.setEnabled(true); s.observe(frame()); const running = s.flush()
    expect(s.status.revision).toBe(0); expect(s.contextFor(user())).toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    finish({ text: JSON.stringify(reply(captured)) }); await running
    expect(s.status.revision).toBe(0); expect(complete).not.toHaveBeenCalled(); expect(stream).toHaveBeenCalledOnce()
    s.dispose()
  })

  it('collects actual SSE fragments and commits only the complete validated understanding', async () => {
    let input!: SituationInput, feed!: ReadableStreamDefaultController<Uint8Array>
    const records: DesktopDiagnosticRecord[] = [], encoder = new TextEncoder()
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'MOCK_ONLY', model: 'mock',
      fetchImpl: async (_url, init) => {
        input = JSON.parse(JSON.parse(init!.body as string).messages[1].content)
        const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
      } })
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => provider), diagnostic: r => records.push(r) })
    s.setEnabled(true); s.observe(frame()); const running = s.flush(); await flushPromises()
    const json = JSON.stringify(reply(input)), cut = Math.floor(json.length / 2)
    const chunk = (text: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
    feed.enqueue(chunk(json.slice(0, cut))); await flushPromises()
    expect(s.status.revision).toBe(0); expect(s.contextFor(user())).toBeUndefined()
    expect(records.some(r => r.event === 'first-text')).toBe(true)
    expect(records.some(r => r.event === 'model-json-start')).toBe(false)
    feed.enqueue(chunk(json.slice(cut))); feed.close(); await running
    expect(s.status.revision).toBe(1); expect(s.contextFor(user())).toContain('main context')
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ committed: true, usable: true })
    s.dispose()
  })

  it('cancels oversized streaming output before parsing or committing it', async () => {
    const cancel = vi.fn(), records: DesktopDiagnosticRecord[] = []
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: {
        content: 'x'.repeat(SITUATION_LIMITS.outputChars + 1),
      } }] })}\n\n`))
    }, cancel })
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'MOCK_ONLY', model: 'mock',
      fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) })
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => provider), diagnostic: r => records.push(r) })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(cancel).toHaveBeenCalledOnce(); expect(s.status.revision).toBe(0)
    expect(records.some(r => r.event === 'model-json-start')).toBe(false)
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ outcome: 'validation-rejected', committed: false })
    s.dispose()
  })

  it('retains an oversized input batch without retrying it alone, then recovers with fresh bounded evidence', async () => {
    const complete = vi.fn(async (request: import('@aisling/core').ChatCompletionRequest) => ({
      text: JSON.stringify(reply(JSON.parse(request.messages[1]!.content!))),
    }))
    const records: DesktopDiagnosticRecord[] = []
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => ({ id: 'mock', complete })), diagnostic: r => records.push(r) })
    s.setEnabled(true)
    for (let n = 0; n < 6; n++) { s.observe(frame(`${n}${'"'.repeat(1999)}`)); vi.setSystemTime(Date.now() + 1) }
    await s.flush()
    expect(complete).not.toHaveBeenCalled(); expect(s.status.pending).toBe(6)
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ outcome: 'failed', reason: 'input-limit' })
    await vi.advanceTimersByTimeAsync(4000); await s.flush()
    expect(s.status.calls).toBe(1); expect(complete).not.toHaveBeenCalled()
    for (let n = 0; n < 6; n++) { s.observe(frame(`New short evidence ${n}`)); vi.setSystemTime(Date.now() + 1) }
    await s.flush()
    expect(complete).toHaveBeenCalledOnce(); expect(s.status.revision).toBe(1)
    expect(s.contextFor(user())).toContain('New short evidence 5')
    s.setEnabled(false)
    expect(s.status.omissions).toBe(0); expect(s.status.truncations).toBe(0)
    s.dispose()
  })

  it('reproduces reasoning-only + length as empty JSON failure without a state commit or content leak', async () => {
    const records: DesktopDiagnosticRecord[] = []
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'MOCK_ONLY', model: 'mock',
      fetchImpl: async () => new Response('data: {"choices":[{"delta":{"reasoning_content":"Private reasoning only","content":null}}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) })
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => provider), diagnostic: r => records.push(r) })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(records.some(r => r.event === 'first-text')).toBe(false)
    expect(records.find(r => r.event === 'result-ready')).toMatchObject({ contentChars: 0, reasoningChars: 22, finishReason: 'length' })
    expect(records.find(r => r.event === 'model-json-failed')).toMatchObject({ contentChars: 0, jsonParseFailure: 'empty-content' })
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ outcome: 'validation-rejected', committed: false })
    expect(s.status.revision).toBe(0); expect(s.contextFor(user())).toBeUndefined()
    expect(JSON.stringify(records)).not.toContain('Private reasoning only'); s.dispose()
  })

  it.each([
    ['', 'empty-content'], [' \n\t', 'whitespace-only'], ['```json\n{}\n```', 'markdown-fence'],
    ['Here is the JSON: {}', 'non-json-prefix'], ['{"claims":', 'json-syntax'],
  ])('classifies rejected model JSON without extracting or repairing it (%s)', async (text, jsonParseFailure) => {
    for (const enabled of [false, true]) {
      const records: DesktopDiagnosticRecord[] = [], complete = vi.fn(async () => ({ text }))
      const s = createSituationWorkingState({ execute: providerSituationExecutor(() => ({ id: 'mock', complete })), diagnostic: enabled ? r => records.push(r) : undefined })
      s.setEnabled(true); s.observe(frame()); await s.flush()
      expect(s.status.revision).toBe(0); expect(s.snapshot()).toBeUndefined(); expect(complete).toHaveBeenCalledOnce()
      if (enabled) expect(records.find(r => r.event === 'model-json-failed')).toMatchObject({ contentChars: text.length, jsonParseFailure })
      else expect(records).toEqual([])
      s.dispose()
    }
  })

  it.each(['failure', 'timeout'] as const)('resumes V2 queued while V1 ends in %s, without another offer', async outcome => {
    const jobs: { input: SituationInput; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
    const execute = vi.fn((input: SituationInput, signal: AbortSignal) => new Promise((resolve, reject) => {
      jobs.push({ input, resolve, reject })
      signal.addEventListener('abort', () => reject(new Error('Mock abort')), { once: true })
    }))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame('V1'))
    const first = s.flush()
    await vi.advanceTimersByTimeAsync(1000); s.observe(frame('V2'))
    if (outcome === 'timeout') {
      await vi.advanceTimersByTimeAsync(13_999); expect(execute).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
    }
    else jobs[0]!.reject(new Error('Mock request failure'))
    await first; await vi.advanceTimersByTimeAsync(outcome === 'timeout' ? 1 : 9000)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(jobs[1]!.input.incoming.map(e => e.text)).toEqual(['V1', 'V2'])
    jobs[1]!.resolve(reply(jobs[1]!.input)); await flushPromises()
    expect(s.status.revision).toBe(1); expect(s.contextFor(user())).toContain('V2')
    await vi.advanceTimersByTimeAsync(10_000); expect(execute).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('does not retry the same failed batch on repeated fresh captures of the same version', async () => {
    const execute = vi.fn(async () => { throw new Error('Mock failure') })
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame('V1')); await s.flush()
    for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(2000); s.observe(frame('V1')) }
    expect(execute).toHaveBeenCalledOnce(); expect(s.status.pending).toBe(1); s.dispose()
  })

  it('fresh evidence on every failed attempt still respects the eight-call budget and one task', async () => {
    let active = 0, maxActive = 0, offered = 1
    let s: ReturnType<typeof createSituationWorkingState>
    const execute = vi.fn(async () => {
      active++; maxActive = Math.max(maxActive, active)
      vi.setSystemTime(Date.now() + 1); s.observe(frame(`V${++offered}`))
      active--; throw new Error('Mock failure')
    })
    s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame('V1')); await s.flush()
    await vi.advanceTimersByTimeAsync(50_100)
    expect(execute).toHaveBeenCalledTimes(8); expect(maxActive).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000); expect(execute).toHaveBeenCalledTimes(8)
    s.dispose()
  })

  it.each(['scope', 'invalid'] as const)('keeps %s cancellation and late-commit rejection after recovery changes', async kind => {
    let finish!: (v: unknown) => void, input!: SituationInput
    const execute = vi.fn((i: SituationInput) => { input = i; return new Promise(resolve => { finish = resolve }) })
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame()); const first = s.flush()
    vi.setSystemTime(Date.now() + 1)
    s.observe(kind === 'scope' ? frame('Other document', 'Other title', '456') : frame(''))
    finish(reply(input)); await first
    expect(s.snapshot()).toBeUndefined(); expect(s.status.revision).toBe(0)
    expect(s.status.pending).toBe(kind === 'scope' ? 1 : 0)
    s.dispose()
  })

  it('traces committed A updates and scoped selections without adding metadata to context or A input', async () => {
    const records: DesktopDiagnosticRecord[] = [], inputs: string[] = [], contexts: (string | undefined)[] = []
    for (const diagnostic of [undefined, (r: DesktopDiagnosticRecord) => { records.push(r) }]) {
      const s = createSituationWorkingState({ diagnostic, execute: async i => { inputs.push(JSON.stringify(i)); return reply(i) } })
      s.setEnabled(true); s.observe(frame()); await s.flush()
      contexts.push(s.contextFor(user(), selection => {
        expect(selection).toMatchObject({ reason: 'injected', revision: 1, scopeMatched: true })
      })); s.dispose()
    }
    expect(inputs[0]).toBe(inputs[1]); expect(contexts[0]).toBe(contexts[1])
    const start = records.find(r => r.type === 'p2-a-update-start')!, end = records.find(r => r.type === 'p2-a-update-end')!
    expect(start).toMatchObject({ previousRevision: 0, batchCount: 1, observationCount: 1 })
    expect(end).toMatchObject({ updateId: start.updateId, outcome: 'updated', committed: true, executorReturned: true, revision: 1, usable: true })
    expect(JSON.stringify(records)).not.toContain('Paper says')
    expect(JSON.stringify(records)).not.toContain('browser')
  })

  it('records a returned but rejected output as validation-rejected, never updated', async () => {
    const records: DesktopDiagnosticRecord[] = []
    const s = createSituationWorkingState({ diagnostic: r => records.push(r), execute: async () => ({ invalid: true }) })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ outcome: 'validation-rejected', executorReturned: true, committed: false })
    expect(s.status.revision).toBe(0); s.dispose()
  })

  it('emits a timeout even when A hangs, and does not attribute a late result after reset', async () => {
    const records: DesktopDiagnosticRecord[] = []
    let finish!: (v: unknown) => void, input!: SituationInput
    const s = createSituationWorkingState({ diagnostic: r => records.push(r), execute: i => { input = i; return new Promise(resolve => { finish = resolve }) } })
    s.setEnabled(true); s.observe(frame()); const running = s.flush()
    expect(s.contextFor(user(), selection => expect(selection.reason).toBe('no-ready-state'))).toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(records.find(r => r.type === 'p2-a-update-end')).toMatchObject({ outcome: 'timeout', durationMs: 15_000, settled: false, committed: false })
    s.reset(); finish(reply(input)); await running
    expect(records.filter(r => r.type === 'p2-a-update-end')).toHaveLength(1)
    expect(s.contextFor(user(), selection => expect(selection.reason).toBe('session-invalidated'))).toBeUndefined()
    expect(s.status.revision).toBe(0); s.dispose()
  })

  it('records the first real rejection and tolerates selection/diagnostic sink failures', async () => {
    const s = createSituationWorkingState({ diagnostic: () => { throw new Error('sink') }, execute: async i => reply(i) })
    s.contextFor(user(), selection => expect(selection.reason).toBe('feature-disabled'))
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(s.contextFor(user(), () => { throw new Error('selection sink') })).toBeTruthy()
    s.contextFor(createUserTextStimulus({ source: 'test', text: 'Unrelated chat' }), selection => expect(selection).toMatchObject({ reason: 'target-mismatch', statePresent: true }))
    vi.setSystemTime(Date.now() + 1); s.observe(frame('New evidence'))
    s.contextFor(user(), selection => expect(selection.reason).toBe('evidence-pending'))
    s.dispose()
  })

  it('only admits explicitly scoped reports/corrections, not questions or unrelated statements', () => {
    expect(isSituationCorrection('当前页面不是在讲上下文吗？')).toBe(false)
    expect(isSituationCorrection('Actually, my unrelated plan has changed.')).toBe(false)
    expect(isSituationCorrection('补充当前页面：这是作者的假设。')).toBe(true)
    expect(isSituationCorrection('Correction for this page: the earlier claim was mistaken.')).toBe(true)
  })

  it('stays off by default; batches versions rather than calling every poll', async () => {
    const execute = vi.fn(async (i: SituationInput) => reply(i)), s = createSituationWorkingState({ execute })
    s.observe(frame()); await s.flush(); expect(execute).not.toHaveBeenCalled()
    s.setEnabled(true)
    for (let n = 0; n < 5; n++) { s.observe(frame()); await vi.advanceTimersByTimeAsync(2000) }
    expect(execute).toHaveBeenCalledOnce(); expect(s.status.revision).toBe(1)
    expect(s.contextFor(user())).toContain('main context')
    s.dispose()
  })

  it('updates while Jev declines, without changing the fast input', async () => {
    const execute = vi.fn(async (i: SituationInput) => reply(i)), s = createSituationWorkingState({ execute })
    s.setEnabled(true)
    let snapshot = frame()
    const trigger = vi.fn(), judge = vi.fn(async (_request: DesktopJudgeRequest) => ({ context: snapshot, scores: { shouldInterrupt: 0.1 } }))
    const state = createAutonomousState()
    const controller = createAutonomousController({ state, onSnapshot: s.observe,
      readDesktop: async () => ({ enabled: true, available: true, context: snapshot }), judgeDesktop: judge,
      trigger, isBusy: () => false, isReady: () => true, getCooldownMs: () => 30_000 })
    controller.setEnabled(true)
    await controller.tick()
    await vi.advanceTimersByTimeAsync(10_000)
    snapshot = frame(); await controller.tick()
    expect(trigger).not.toHaveBeenCalled(); expect(judge).toHaveBeenCalledOnce()
    expect(Object.keys(judge.mock.calls[0]![0] ?? {})).not.toContain('situation')
    expect(s.status.revision).toBe(1)
    s.dispose()
  })

  it('starts after three versions, never blocks a fast turn while A hangs', async () => {
    const execute = vi.fn((_i: SituationInput, _signal: AbortSignal) => new Promise(() => {}))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true)
    for (const text of ['first', 'second', 'third']) { s.observe(frame(text)); vi.setSystemTime(Date.now() + 1) }
    await vi.advanceTimersByTimeAsync(0); expect(execute).toHaveBeenCalledOnce()
    const trigger = vi.fn(), snapshot = frame('fourth'), state = createAutonomousState()
    const controller = createAutonomousController({ state, onSnapshot: s.observe,
      readDesktop: async () => ({ enabled: true, available: true, context: snapshot }),
      judgeDesktop: async () => ({ context: snapshot, scores: { shouldInterrupt: 0.9 } }),
      trigger, isBusy: () => false, isReady: () => true, getCooldownMs: () => 30_000 })
    controller.setEnabled(true); await controller.tick()
    expect(trigger).toHaveBeenCalledOnce(); expect(s.contextFor(user())).toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(s.status.lastEvent).toBe('timeout'); expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![1].aborted).toBe(true)
    // Ignoring cancellation must not create a second physical request, even after toggling.
    s.setEnabled(false); s.setEnabled(true); s.observe(frame('new')); await s.flush()
    expect(execute).toHaveBeenCalledOnce(); s.dispose()
  })

  it('feeds previous knowledge and raw evidence into correction, replacing and retracting it', async () => {
    const execute = vi.fn(async (i: SituationInput) => {
      const result = reply(i)
      const e = i.incoming[0]!
      result.retracted = i.previous?.claims.map(c => ({ text: c.text,
        evidence: [{ id: e.id, version: e.version, quote: e.text.slice(0, 240) }] })) ?? []
      return result
    })
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame()); await s.flush()
    s.feedback('纠正当前页面：实际是外部上下文。', s.currentScope())
    expect(s.contextFor(user())).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs)
    expect(execute.mock.calls[1]![0].previous?.claims).toHaveLength(1)
    expect(execute.mock.calls[1]![0].evidence[0]!.text).toContain('main context')
    expect(s.snapshot()?.retracted).toHaveLength(1)
    expect(s.contextFor(user())).toContain('user-report')
    expect(s.contextFor(user())).toContain('外部上下文')
    s.dispose()
  })

  it('commits intermediate progress but hides it until newer observations are incorporated', async () => {
    let finish!: (v: unknown) => void
    const execute = vi.fn((i: SituationInput) => new Promise(resolve => { finish = resolve }))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame('first'))
    const running = s.flush(); await flushPromises()
    vi.setSystemTime(Date.now() + 1); s.observe(frame('second'))
    finish(reply(execute.mock.calls[0]![0])); await running
    expect(s.status.revision).toBe(1); expect(s.contextFor(user())).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs)
    const next = s.flush(); await flushPromises()
    expect(execute.mock.calls[1]![0].previous?.claims[0]!.text).toContain('first')
    finish(reply(execute.mock.calls[1]![0])); await next
    expect(s.contextFor(user())).toContain('second'); s.dispose()
  })

  it('rejects cross-window, cross-session, late, expired and out-of-order results', async () => {
    let finish!: (v: unknown) => void
    const execute = vi.fn((i: SituationInput) => new Promise(resolve => { finish = resolve }))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); const original = frame()
    s.observe(original); const oldToken = s.currentScope(); const running = s.flush()
    vi.setSystemTime(Date.now() + 1); s.observe(frame('Different paper', 'Other', '456'))
    finish(reply(execute.mock.calls[0]![0])); await running
    expect(s.snapshot()).toBeUndefined(); expect(s.contextFor(candidate(original))).toBeUndefined()
    s.reset(); vi.setSystemTime(Date.now() + 1); s.observe(frame())
    const count = s.status.pending; s.feedback('old correction', oldToken)
    expect(s.status.pending).toBe(count)
    s.observe(original); expect(s.status.lastEvent).toBe('out-of-order-observation')
    await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs)
    const pending = s.flush(); finish(reply(execute.mock.calls.at(-1)![0])); await pending
    expect(s.contextFor(candidate(frame('Different paper', 'Other', '456')))).toBeUndefined()
    expect(s.contextFor(createUserTextStimulus({ source: 'web', text: 'New unrelated topic' }))).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.ttlMs + 1)
    expect(s.contextFor(user())).toBeUndefined(); s.dispose()
  })

  it('failure preserves old state but never re-exposes knowledge contradicted by an unprocessed correction', async () => {
    const execute = vi.fn(async (i: SituationInput) => reply(i))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true); s.observe(frame()); await s.flush()
    const old = s.snapshot()
    execute.mockRejectedValueOnce(new Error('offline'))
    s.feedback('纠正当前页面：不是这个定义。', s.currentScope()); await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs)
    expect(s.snapshot()).toEqual(old); expect(s.contextFor(user())).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000); expect(execute).toHaveBeenCalledTimes(2)
    s.feedback('当前页面应为另一定义。', s.currentScope()); await s.flush()
    expect(execute.mock.calls.at(-1)![0].incoming.some(e => e.text.includes('不是这个定义'))).toBe(true)
    expect(s.status.revision).toBe(2); s.dispose()
  })

  it('rejects self-speech or any unsupported source as external claim or retraction evidence', () => {
    for (const kind of ['self-speech', 'tool-result']) {
      const e = { id: 'f1', kind, scope: 'scope', version: hash('speech'), at: Date.now(), receivedAt: Date.now(),
        text: 'User approved', truncated: false, source: { app: 'browser', title: 'Paper', targetHwnd: '123', sequence: 1 } }
      const input = { scope: 'scope', baseRevision: 0, previous: null, evidence: [], incoming: [e], omissions: 0 } as unknown as SituationInput
      const update = reply(input)
      expect(() => validateSituationUpdate(update, input)).toThrow('situation-invalid-evidence')
      input.previous = update
      expect(() => validateSituationUpdate({ ...update, claims: [], retracted: [{ text: update.claims[0]!.text,
        evidence: update.claims[0]!.evidence }] }, input)).toThrow('situation-invalid-retraction-evidence')
    }
  })

  it('bounds pending input and calls; exposes truncation and omissions; OFF clears everything usable', async () => {
    const execute = vi.fn(async (i: SituationInput) => reply(i))
    const s = createSituationWorkingState({ execute }); s.setEnabled(true)
    for (let n = 0; n < 10; n++) { s.observe(frame(String(n).repeat(2000))); vi.setSystemTime(Date.now() + 1) }
    expect(s.status.pending).toBe(6); expect(s.status.omissions).toBe(4); expect(s.status.truncations).toBe(10)
    await s.flush()
    for (let n = 0; n < 10; n++) { vi.setSystemTime(Date.now() + 1); s.observe(frame(`version ${n}`)); await vi.advanceTimersByTimeAsync(SITUATION_LIMITS.minIntervalMs) }
    expect(execute).toHaveBeenCalledTimes(8)
    expect(s.status.lastEvent).toBe('call-budget-exhausted')
    s.setEnabled(false)
    expect(s.snapshot()).toBeUndefined(); expect(s.status.pending).toBe(0)
    expect(s.contextFor(user())).toBeUndefined(); s.dispose()
  })

  it('validates evidence versions, coverage, schema, output and state lengths', async () => {
    let input!: SituationInput
    const s = createSituationWorkingState({ execute: async i => { input = i; return reply(i) } })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    for (const mutate of [
      (v: SituationUpdate) => { v.baseRevision++ },
      (v: SituationUpdate) => { v.scope = 'other' },
      (v: SituationUpdate) => { v.covered = [] },
      (v: SituationUpdate) => { v.claims[0]!.evidence[0]!.version = 'wrong' },
      (v: SituationUpdate) => { v.claims[0]!.evidence[0]!.quote = 'not in evidence' },
      (v: SituationUpdate) => { v.unknowns = ['x'.repeat(201)] },
      (v: SituationUpdate) => { v.retracted = [{ text: 'invented prior claim', evidence: [] }] },
    ]) { const v = reply(input); mutate(v); expect(() => validateSituationUpdate(v, input)).toThrow() }
    expect(() => situationRequest({ ...input, omissions: 0, evidence: Array(100).fill(input.incoming[0]) })).toThrow('input-limit')
    s.dispose()
  })

  it('uses the real ChatProvider port with no tools and explicit cancellation/output limits', async () => {
    const complete = vi.fn(async (r: import('@aisling/core').ChatCompletionRequest) => ({ text: JSON.stringify(reply(JSON.parse(r.messages[1]!.content!))) }))
    const s = createSituationWorkingState({ execute: providerSituationExecutor(() => ({ id: 'existing-provider', complete })) })
    s.setEnabled(true); s.observe(frame()); await s.flush()
    expect(complete.mock.calls[0]![0]).toMatchObject({ maxOutputTokens: 800, temperature: 0.2, signal: expect.any(AbortSignal) })
    expect(complete.mock.calls[0]![0].tools).toBeUndefined(); expect(s.status.revision).toBe(1); s.dispose()
  })

  it('correlates actual HTTP and model JSON phases to the A update only when diagnostics are on', async () => {
    for (const enabled of [false, true]) {
      const records: DesktopDiagnosticRecord[] = [], bodies: string[] = []
      const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid/v1', apiKey: 'MOCK_ONLY', model: 'fixture',
        fetchImpl: async (_url, init) => {
          bodies.push(init!.body as string)
          const input = JSON.parse(JSON.parse(init!.body as string).messages[1].content) as SituationInput
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(input)) } }] }), { headers: { 'Content-Type': 'application/json' } })
        } })
      const s = createSituationWorkingState({ execute: providerSituationExecutor(() => provider), diagnostic: enabled ? r => records.push(r) : undefined })
      s.setEnabled(true); s.observe(frame()); await s.flush()
      expect(s.status.revision).toBe(1); expect(bodies).toHaveLength(1)
      expect(JSON.parse(bodies[0]!).stream).toBe(true); expect(JSON.parse(bodies[0]!).max_completion_tokens).toBe(800)
      if (enabled) {
        const start = records.find(r => r.type === 'p2-a-update-start')!
        const phases = records.filter(r => r.type === 'p2-a-http')
        expect(phases.every(r => r.updateId === start.updateId && r.scopeId === start.scopeId)).toBe(true)
        expect(phases.map(r => r.event)).toEqual(['provider-enter', 'fetch-start', 'headers-received', 'response-json-start', 'response-json-end', 'first-text', 'result-ready', 'model-json-start', 'model-json-end'])
        expect(JSON.stringify(phases)).not.toContain('Paper says')
      }
      else expect(records).toEqual([])
      s.dispose()
    }
  })
})
