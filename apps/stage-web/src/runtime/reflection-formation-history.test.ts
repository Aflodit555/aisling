import type { ChatCompletionRequest, ChatCompletionResult } from '@aisling/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReflectionFormation, FORMATION_LIMITS, formationRequest, parseReflections, sourceRef } from './reflection-formation'
import { experienceSessions } from './__tests__/fixtures/reflection-experiences'

type Record = { label: string; conversation: string; role: string; content: string; scope: string; sourceScope: string;
  position: number; time: string | { at: string }; sessionTime?: unknown }
const payload = (request: ChatCompletionRequest) => JSON.parse(request.messages[1]!.content!) as { evidence: Record[] }
const queues: ReturnType<typeof createReflectionFormation>[] = []
beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(0) })
afterEach(() => { queues.splice(0).forEach(q => q.dispose()); vi.restoreAllMocks() })
const pattern = { content: '有限几次尝试中，缩小目标后更容易开始并完成。', kind: 'pattern', basis: 'mixed',
  tags: ['手碟', '画画', '任务规模'], related: [], uncertainty: '仅据有限报告，不能作为稳定人格特征。' }

async function fixture(complete: (request: ChatCompletionRequest) => Promise<ChatCompletionResult>, currentIndex = 2) {
  const sessions = experienceSessions(), current = sessions.splice(currentIndex, 1)[0]!, messages = current.messages
  current.messages = []; sessions.push(current)
  let raw: string | null = null
  const provider = vi.fn(complete)
  const queue = createReflectionFormation({ storage: { read: () => ({ ok: true, value: raw }), write: value => { raw = value; return true } },
    getSessions: () => sessions, getProvider: () => ({ id: 'offline-formation', complete: provider }) })
  queues.push(queue)
  await queue.setEnabled(true)
  const deliver = async () => { current.messages = messages; await queue.delivered(current.id, [0, 1]); await queue.flush(current.id) }
  return { sessions, current, queue, provider, deliver, raw: () => raw }
}

it('gives one background request cross-session evidence and persists its source mapping without re-registering history', async () => {
  const f = await fixture(async request => {
    const records = payload(request).evidence
    const current = records.find(r => r.scope === 'current-batch' && r.role === 'user')!
    const earlier = records.find(r => r.scope === 'related-history' && r.role === 'user' && r.content.includes('缩小'))!
    expect(earlier).toBeDefined()
    return { text: JSON.stringify({ reflections: [{ ...pattern, sources: [earlier.label, current.label] }] }) }
  })
  await f.deliver()
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  expect(f.provider).toHaveBeenCalledOnce()
  const request = f.provider.mock.calls[0]![0], records = payload(request).evidence
  expect(new Set(records.map(r => r.conversation)).size).toBeGreaterThan(1)
  expect(records.length).toBeLessThanOrEqual(FORMATION_LIMITS.sources)
  expect(new TextEncoder().encode(JSON.stringify(records)).length).toBeLessThanOrEqual(FORMATION_LIMITS.evidenceBytes)
  expect(new TextEncoder().encode(request.messages.map(m => m.content).join('')).length).toBeLessThanOrEqual(FORMATION_LIMITS.inputBytes)
  expect(records.filter(r => r.scope === 'current-batch').map(r => r.position)).toEqual([1, 2])
  expect(JSON.parse(request.messages[1]!.content!).currentBatchSources).toEqual(records.filter(r => r.scope === 'current-batch').map(r => r.label))
  expect(JSON.parse(request.messages[1]!.content!).relatedPatternSources).toEqual(records.filter(r => r.scope === 'related-history').map(r => r.label))
  expect(request.messages[0]!.content).toContain('This applies to EVERY kind, including event and project-state')
  expect(request.messages[0]!.content).toContain('For all non-pattern kinds, use only currentBatchSources')
  expect(request.messages[0]!.content).toContain('Co-occurrence does not establish causation')
  expect(records.some(r => r.content.includes('正在考虑购买手碟'))).toBe(false)
  expect(records.find(r => r.content.includes('天生缺乏自律'))).toMatchObject({ role: 'assistant', sourceScope: 'stored-assistant-utterance' })
  expect(records.every(r => typeof r.time === 'object')).toBe(true)
  expect(JSON.stringify(request)).not.toMatch(/handpan-first|handpan-second|messageIndex|digest|sourceRefs/)
  const state = f.queue.inspect(), batch = state.batches[0]!, reflection = state.reflections[0]!
  expect(batch).toMatchObject({ sessionId: f.current.id, units: 1, attempts: 1 })
  expect(batch.sourceRefs).toHaveLength(2)
  expect(batch.sourceRefs.every(ref => ref.sessionId === f.current.id)).toBe(true)
  expect(new Set(reflection.sourceRefs.map(ref => ref.sessionId)).size).toBe(2)
  for (const ref of reflection.sourceRefs) {
    const message = f.sessions.find(s => s.id === ref.sessionId)!.messages[ref.messageIndex]!
    expect(await sourceRef(ref.sessionId, ref.messageIndex, message)).toEqual(ref)
  }
  expect(JSON.parse(f.raw()!).reflections).toEqual(state.reflections)
  await f.queue.delivered(f.current.id, [0, 1]); await f.queue.flush()
  await new Promise(resolve => setTimeout(resolve, 15))
  expect(f.provider).toHaveBeenCalledOnce()
  expect(f.queue.inspect().batches).toHaveLength(1)
})

it('rejects a valid current pattern plus a history-only state without salvaging partial output', async () => {
  const f = await fixture(async request => {
    const records = payload(request).evidence
    const current = records.find(r => r.scope === 'current-batch' && r.role === 'user')!
    const old = records.find(r => r.scope === 'related-history' && r.role === 'user')!
    return { text: JSON.stringify({ reflections: [
      { ...pattern, sources: [current.label, old.label] },
      { content: old.content, kind: 'project-state', basis: 'direct', tags: ['手碟'], sources: [old.label], related: [] },
    ] }) }
  })
  f.queue.setDiagnosticsEnabled(true)
  await f.deliver()
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('failed'))
  expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'reference-label', field: 'sources',
    reason: 'current-batch-source-required', reflectionIndex: 1 })
  expect(f.queue.inspect().reflections).toEqual([])
  expect(JSON.parse(f.raw()!).reflections).toEqual([])
  expect(f.provider).toHaveBeenCalledOnce()
})

it.each([2, 4])('preserves original speech, times and changing interests/purchase status for batch %i', async index => {
  const f = await fixture(async request => {
    const current = payload(request).evidence.find(r => r.scope === 'current-batch' && r.role === 'user')!
    return { text: JSON.stringify({ reflections: [{ content: current.content, kind: 'project-state', basis: 'direct',
      tags: ['手碟', '画画'], sources: [current.label], related: [] }] }) }
  }, index)
  await f.deliver(); await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  const records = payload(f.provider.mock.calls[0]![0]).evidence
  expect(records.find(r => r.scope === 'current-batch' && r.role === 'user')).toMatchObject({
    content: f.current.messages[0]!.content, time: { at: new Date(f.current.messages[0]!.createdAt!).toISOString() },
  })
  if (index === 4) expect(records.every(r => r.scope === 'current-batch')).toBe(true)
  else expect(records.some(r => r.scope === 'related-history' && r.content.includes('想练手碟'))).toBe(true)
  const policy = f.provider.mock.calls[0]![0].messages[0]!.content!
  expect(policy).toContain('consideration, plans and completed actions')
  expect(policy).toContain('New interests do not erase past ones')
  expect(policy).toContain('not external facts')
})

it('permits zero reflections, preserves useful-event guidance and falls back when the bounded history scan cannot finish', async () => {
  const f = await fixture(async () => ({ text: '{"reflections":[]}' }))
  f.sessions.unshift({ id: 'oversized-history', title: '', createdAt: 0, updatedAt: 0,
    messages: [{ role: 'user', content: 'x'.repeat(250_001) }] })
  await f.deliver(); await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  const request = f.provider.mock.calls[0]![0]
  expect(payload(request).evidence.every(r => r.scope === 'current-batch')).toBe(true)
  expect(f.queue.inspect().reflections).toEqual([])
  expect(request.messages[0]!.content).toContain('retain the concrete attempt and outcome')
  expect(request.messages[0]!.content).toContain('insufficient evidence')
  expect(f.provider).toHaveBeenCalledOnce()
})

it('checks optional historical sources again before commit and rejects edits made during formation', async () => {
  let finish!: (output: ChatCompletionResult) => void
  const f = await fixture(() => new Promise(resolve => { finish = resolve }))
  await f.deliver(); await vi.waitFor(() => expect(f.provider).toHaveBeenCalledOnce())
  const records = payload(f.provider.mock.calls[0]![0]).evidence
  const earlier = records.find(r => r.scope === 'related-history' && r.role === 'user')!
  const original = f.sessions.find(s => s.messages.some(m => m.content === earlier.content))!
  original.messages[earlier.position - 1] = { role: 'user', content: '来源已修改。' }
  const current = records.find(r => r.scope === 'current-batch' && r.role === 'user')!
  finish({ text: JSON.stringify({ reflections: [{ ...pattern, sources: [current.label, earlier.label] }] }) })
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('source-changed'))
  expect(f.queue.inspect().reflections).toEqual([])
})

it('falls back to the current batch when the historical scan deadline is reached', async () => {
  const f = await fixture(async () => ({ text: '{"reflections":[]}' }))
  vi.mocked(performance.now).mockReturnValueOnce(0).mockReturnValue(31)
  await f.deliver(); await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  expect(payload(f.provider.mock.calls[0]![0]).evidence.every(r => r.scope === 'current-batch')).toBe(true)
  expect(f.provider).toHaveBeenCalledOnce()
})

it('keeps a full current batch intact rather than adding history beyond the existing source cap', async () => {
  const f = await fixture(async () => ({ text: '{"reflections":[]}' }))
  f.current.messages = Array.from({ length: FORMATION_LIMITS.sources }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user',
    content: `手碟画画目标缩小后完成练习，第${i}条报告。`, createdAt: f.current.createdAt + i }))
  await f.queue.delivered(f.current.id, f.current.messages.map((_, i) => i)); await f.queue.flush()
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  const records = payload(f.provider.mock.calls[0]![0]).evidence
  expect(records).toHaveLength(FORMATION_LIMITS.sources)
  expect(records.every(r => r.scope === 'current-batch')).toBe(true)
  expect(f.provider).toHaveBeenCalledOnce()
})

it('requires distinct user reports for patterns and a current source for every new reflection', async () => {
  const sessions = experienceSessions(), message = sessions[0]!.messages[0]!, assistant = sessions[0]!.messages[1]!
  const current = { ref: await sourceRef(sessions[0]!.id, 0, message), message }
  const echo = { ref: await sourceRef(sessions[0]!.id, 1, assistant), message: assistant }
  expect(() => parseReflections(JSON.stringify({ reflections: [{ ...pattern, sources: ['E1', 'E2'] }] }), [current, echo], [])).toThrow('invalid-output')
  expect(() => parseReflections(JSON.stringify({ reflections: [{ ...pattern, sources: ['E1', 'E2'] }] }), [current, { ...current }], [])).toThrow('invalid-output')
  const old = { ...current, scope: 'related-history' as const }
  expect(() => parseReflections(JSON.stringify({ reflections: [{ ...pattern, kind: 'event', sources: ['E1'] }] }), [old], [])).toThrow('invalid-output')
  const oldMessage = sessions[2]!.messages[0]!
  const oldDrawing = { ref: await sourceRef(sessions[2]!.id, 0, oldMessage), message: oldMessage, scope: 'related-history' as const }
  let failure: unknown
  try { parseReflections(JSON.stringify({ reflections: [{ ...pattern, sources: ['E1', 'E2'] }] }), [old, oldDrawing, current], []) }
  catch (error) { failure = error }
  expect(failure).toMatchObject({ message: 'invalid-output', detail: { field: 'sources', reason: 'current-batch-source-required' } })
  const event = parseReflections(JSON.stringify({ reflections: [{ ...pattern, kind: 'event', sources: ['E1'] }] }), [current], [])
  expect(event[0]!.sourceRefs).toEqual([current.ref])
  expect(parseReflections('{"reflections":[]}', [current], [])).toEqual([])
  expect(formationRequest([current, echo], []).messages[0]!.content).toMatch(/never promote one event plus an assistant echo/i)
})
