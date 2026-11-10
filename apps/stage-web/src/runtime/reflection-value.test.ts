import { createOpenAICompatibleProvider, createUserTextStimulus, type ChatCompletionRequest, type ChatRuntimeDiagnostic } from '@aisling/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from '../../../../packages/core/src/context'
import { createAislingRuntime } from './aisling'
import { legacyRecallProvider } from '@aisling/core/legacy-recall'
import { recallForModel, retrieveRecall } from './memory-recall'
import { createReflectionRecall, REFLECTION_RECALL_LIMITS } from './reflection-recall'
import { sourceRef } from './reflection-formation'
import { createReflectionStore } from './reflection-store'
import { experienceSessions, experienceState } from './__tests__/fixtures/reflection-experiences'

// Deterministic evidence comparisons; wall-clock deadline behavior has its own fallback test.
beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(0) })
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const sessions = experienceSessions(), state = await experienceState(sessions)
  let raw = JSON.stringify(state)
  const read = vi.fn(() => createReflectionStore({ read: () => ({ ok: true, value: raw }), write: () => false }).read())
  const recall = createReflectionRecall(read)
  return { sessions, state, recall, read, save: () => { raw = JSON.stringify(state); recall.invalidate() } }
}

it('finds a cross-experience understanding through two concrete subject tags and kind intent, without requiring those subjects in its body', async () => {
  const f = await fixture()
  const result = await f.recall.retrieve(f.sessions, 'active', '练手碟和画画的经历有什么相似之处？')
  const pattern = result.candidates.map(c => JSON.parse(c)).find(r => r.kind === 'pattern')
  expect(result.reason).toBe('selected')
  expect(pattern).toBeDefined()
  expect(pattern.content).not.toMatch(/手碟|画画/)
  expect(pattern.tags).toEqual(expect.arrayContaining(['手碟', '画画']))
  expect(pattern.sources).toHaveLength(3)
  expect(pattern.sources.every((s: { role: string; time: { kind: string } }) => s.role === 'user' && s.time.kind === 'message-created')).toBe(true)
  expect(pattern.uncertainty).toContain('不代表稳定人格')
  expect(pattern.formedAt).toBe('2026-10-25T08:00:00.000Z')
  expect(pattern.sources[0].time.at).toBe('2026-09-01T08:00:00.000Z')
})

it('does not let a single repeated tag, generic prose, uncertainty or category intent alone supply relevance', async () => {
  const f = await fixture(), base = f.state.reflections[1]!
  f.state.reflections = [{ ...base, content: '整理厨房后收纳整齐。', tags: ['手碟', ' 手碟 ', '手碟'],
    uncertainty: '用户现在可能认为手碟和画画有共同模式，缩小任务更容易完成。' }]
  f.state.batches = [{ ...f.state.batches[1]!, reflectionIds: [base.id] }]; f.save()
  for (const query of ['手碟练习', '手碟和画画的共同模式', '缩小任务更容易完成', '用户现在可能是什么情况', '这些经历有什么共同模式']) {
    const result = await f.recall.retrieve(f.sessions, 'active', query)
    expect(result.candidates, query).toEqual([])
    expect(result.reason).toBe('no-match')
  }
  f.state.reflections[0]!.tags = ['共同', '模式', '经验']; f.save()
  expect((await f.recall.retrieve(f.sessions, 'active', '这些经历有什么共同模式')).candidates).toEqual([])
})

it('anchors a conceptual follow-up to recent user topics and does not borrow assistant guesses', async () => {
  const f = await fixture()
  const active = { ...f.sessions[0]!, id: 'active', messages: [
    { role: 'user' as const, content: '之前练手碟和画画各有哪些经历？' },
    { role: 'assistant' as const, content: '我猜你其实在问烹饪和登山。' },
  ] }
  const result = await f.recall.retrieve([...f.sessions, active], 'active', '这些经历有什么共同模式？')
  expect(result.candidates.some(c => JSON.parse(c).kind === 'pattern'), JSON.stringify(result.candidates.map(c => JSON.parse(c).kind))).toBe(true)
  expect((await f.recall.retrieve(f.sessions, 'active', '这些经历有什么共同模式？')).candidates).toEqual([])
  expect((await f.recall.retrieve([...f.sessions, active], 'active', '烹饪和登山有什么相似之处')).candidates).toEqual([])
})

it('keeps mutable states tied to user-source dates rather than the later formation date', async () => {
  const f = await fixture()
  const result = await f.recall.retrieve(f.sessions, 'active', '手碟购买状态后来有什么变化？')
  const states = result.candidates.map(c => JSON.parse(c)).filter(r => r.kind === 'project-state')
  expect(states).toHaveLength(2)
  expect(states.map(r => r.content).join()).toMatch(/尚未购买/)
  expect(states.map(r => r.content).join()).toMatch(/已经购买/)
  expect(states.map(r => r.sources[0].time.at).sort()).toEqual(['2026-09-02T08:00:00.000Z', '2026-10-02T08:00:00.000Z'])
  expect(states.every(r => r.formedAt === '2026-10-25T08:00:00.000Z')).toBe(true)
})

it('tries bounded next candidates after stale sources and hashes a shared source only once per turn', async () => {
  const f = await fixture(), base = f.state.reflections[0]!
  f.state.reflections = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `entry-${i}`,
    sourceRefs: i < 3 ? [{ ...base.sourceRefs[0]!, sessionId: `missing-${i}` }] : base.sourceRefs }))
  f.state.batches = [{ ...f.state.batches[0]!, reflectionIds: f.state.reflections.map(r => r.id) }]; f.save()
  const digest = vi.spyOn(crypto.subtle, 'digest')
  const result = await f.recall.retrieve(f.sessions, 'active', '手碟练习两分钟节奏')
  expect(result.candidates).toHaveLength(1)
  expect(result.selection.filter(d => d.eligible)).toHaveLength(2)
  expect(result.selection.some(d => d.reason === 'combination-value')).toBe(true)
  expect(digest).toHaveBeenCalledOnce()
  expect(f.read).toHaveBeenCalledOnce()
  expect(`[${result.candidates.join(',')}]`.length).toBeLessThanOrEqual(REFLECTION_RECALL_LIMITS.chars)
  expect(new TextEncoder().encode(`[${result.candidates.join(',')}]`).length).toBeLessThanOrEqual(REFLECTION_RECALL_LIMITS.bytes)
})

it('rejects legacy patterns supported only by one user report plus an assistant echo and degrades malformed reads safely', async () => {
  const f = await fixture(), base = f.state.reflections[1]!
  const assistantRef = await sourceRef(f.sessions[0]!.id, 1, f.sessions[0]!.messages[1]!)
  base.sourceRefs = [base.sourceRefs[0]!, assistantRef]
  f.state.reflections = [base]; f.state.batches = [{ ...f.state.batches[1]!, reflectionIds: [base.id] }]; f.save()
  expect((await f.recall.retrieve(f.sessions, 'active', '手碟和画画共同模式')).reason).toBe('invalid-source')
  const malformed = createReflectionRecall(() => ({ reflections: null } as never))
  expect((await malformed.retrieve(f.sessions, 'active', '手碟画画')).reason).toBe('storage-error')
})

it('delivers an old understanding beside a later raw correction and a current user update without changing their meanings', async () => {
  const f = await fixture(), old = f.state.reflections.find(r => r.id === 'purchase-planned')!
  f.state.reflections = [old]; f.state.batches = [{ ...f.state.batches[3]!, reflectionIds: [old.id] }]; f.save()
  const query = '手碟购买状态我补充一下：已经买到了，现在更想画画。之前是什么情况？'
  const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: '' }))
  const runtime = createAislingRuntime({ getChatProvider: () => ({ id: 'offline', complete }), getTools: () => [],
    getRecallEvidence: () => {
      const result = retrieveRecall(f.sessions, 'active', query)
      return result.evidence ? recallForModel(result.evidence).evidence : undefined
    }, getHistoryAddon: legacyRecallProvider(() => f.recall.retrieve(f.sessions, 'active', query)) })
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))
  expect(complete).toHaveBeenCalledOnce()
  const messages = complete.mock.calls[0]![0].messages
  const raw = messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  const reflection = messages.find(m => m.content?.startsWith('[Historical Aisling reflections]'))!.content!
  expect(raw).toContain('手碟已经购买并收到了')
  expect(raw).toContain('2026-10-02T08:00:00.000Z')
  expect(reflection).toContain('手碟尚未购买')
  expect(reflection).toContain('2026-09-02T08:00:00.000Z')
  expect(reflection).toContain('formedAt dates formation, not current validity')
  expect(reflection).toContain('Current explicit user statements and direct evidence take precedence')
  expect(messages.at(-1)!.content).toBe(query)
  runtime.dispose()
})

it('marks legacy source times unknown instead of using the reflection formation date as an event date', async () => {
  const f = await fixture(), base = f.state.reflections[0]!, session = f.sessions[0]!
  session.createdAt = 0; session.updatedAt = 0
  session.messages = session.messages.map(({ createdAt: _time, ...message }) => message)
  base.sourceRefs = [await sourceRef(session.id, 0, session.messages[0]!)]
  f.state.reflections = [base]; f.state.batches = [{ ...f.state.batches[0]!, reflectionIds: [base.id] }]; f.save()
  const result = await f.recall.retrieve(f.sessions, 'active', '手碟练习两分钟节奏')
  expect(result.candidates).toHaveLength(1)
  const projected = JSON.parse(result.candidates[0]!)
  expect(projected.sources[0].time).toBe('unknown')
  expect(projected.sources[0].sessionTime).toBeUndefined()
  expect(projected.formedAt).toBe('2026-10-25T08:00:00.000Z')
})

const tasks = [
  ['fact', '我之前的手碟练习完成过什么？'],
  ['state', '手碟购买状态和现在画画兴趣有什么变化？'],
  ['pattern', '练手碟和画画的经历有什么相似之处？'],
  ['transfer', '现在想写完整篇文章却没开始，手碟和画画经历的共同模式能怎么参考？'],
] as const

it.each(tasks)('compares actual A/B/C requests for %s with isolated sessions and identical mock-provider parameters', async (task, query) => {
  const f = await fixture(), wire: Array<{ messages: ChatCompletionRequest['messages']; model: string; temperature: number }> = []
  const provider = createOpenAICompatibleProvider({ model: 'offline-ablation', baseUrl: 'https://mock.invalid/v1', apiKey: 'synthetic', temperature: 0.2,
    fetchImpl: async (_url, init) => { wire.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }) } })
  const summaries = []
  for (const mode of ['A', 'B', 'C'] as const) {
    const active = { id: `eval-${task}-${mode}`, title: '', createdAt: 0, updatedAt: 0, messages: [] }
    const sessions = [...structuredClone(f.sessions), active], diagnostics: ChatRuntimeDiagnostic[] = []
    let retrievalReason = 'disabled', candidateCount = 0, rawRecords = 0
    const runtime = createAislingRuntime({ getChatProvider: () => provider, getTools: () => [], getUserTextEnableThinking: () => false,
      diagnostic: record => diagnostics.push(record),
      getRecallEvidence: () => {
        if (mode === 'B') return
        const result = retrieveRecall(sessions, active.id, query); rawRecords = result.records
        return result.evidence ? recallForModel(result.evidence).evidence : undefined
      }, getHistoryAddon: legacyRecallProvider(async () => {
        if (mode === 'A') return { candidates: [], durationMs: 0, reason: 'disabled' }
        const result = await f.recall.retrieve(sessions, active.id, query)
        retrievalReason = result.reason; candidateCount = result.candidates.length; return result
      }) })
    expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))).status).toBe('completed')
    const request = wire.at(-1)!, assembled = diagnostics.find(r => r.type === 'context-assembled')!
    expect(request).toMatchObject({ model: 'offline-ablation', temperature: 0.2, enable_thinking: false })
    expect(request.messages.at(-1)!.content).toBe(query)
    expect(request.messages.some(m => m.content?.startsWith('[Cross-session recall evidence]'))).toBe(mode !== 'B')
    expect(request.messages.some(m => m.content?.startsWith('[Historical Aisling reflections]'))).toBe(mode !== 'A')
    expect(assembled.reflectionCount).toBe(mode === 'A' ? 0 : candidateCount)
    const injected = (prefix: string) => {
      const block = request.messages.find(m => m.content?.startsWith(prefix))?.content
      return block ? JSON.parse(block.slice(block.lastIndexOf('\n') + 1)).length as number : 0
    }
    expect(injected('[Cross-session recall evidence]')).toBe(rawRecords)
    expect(injected('[Historical Aisling reflections]')).toBe(assembled.reflectionCount)
    expect(assembled.recallIncluded).toBe(mode !== 'B')
    if (mode !== 'A') {
      expect(retrievalReason).toBe('selected')
      expect(assembled.reflectionReason).toBe('injected')
      if (task === 'pattern' || task === 'transfer') {
        const block = request.messages.find(m => m.content?.startsWith('[Historical Aisling reflections]'))!.content!
        expect(block).toContain('"kind":"pattern"')
        expect(block).toContain('"time":{"kind":"message-created"')
      }
    }
    expect(request.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    expect(JSON.stringify(request)).not.toMatch(/handpan-first|sourceRefs|digest/)
    summaries.push({ mode, rawRecords, reflections: assembled.reflectionCount, reason: retrievalReason })
    runtime.dispose()
  }
  expect(wire).toHaveLength(3)
  const baseline = (messages: ChatCompletionRequest['messages']) => messages.filter(m => !m.content?.startsWith('[Cross-session recall evidence]')
    && !m.content?.startsWith('[Historical Aisling reflections]'))
  expect(baseline(wire[1]!.messages)).toEqual(baseline(wire[0]!.messages))
  expect(baseline(wire[2]!.messages)).toEqual(baseline(wire[0]!.messages))
  console.info('Mock A/B/C evidence delivery', task, JSON.stringify(summaries))
})
