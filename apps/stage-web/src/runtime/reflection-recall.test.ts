import { expect, it, vi } from 'vitest'
import type { ConversationSession } from '../conversation/conversation-store'
import { createReflectionRecall, REFLECTION_RECALL_LIMITS } from './reflection-recall'
import { createReflectionStore, type ReflectionState } from './reflection-store'
import { sourceRef } from './reflection-formation'

async function fixture() {
  const sessions: ConversationSession[] = [{ id: 'old-session', title: 'old', createdAt: 1, updatedAt: 1,
    messages: [{ role: 'user', content: '纸舟旅行票根支持 PDF 导出。' }, { role: 'assistant', content: '纸舟导出是我猜的。' }] }]
  const refs = await Promise.all(sessions[0]!.messages.map((m, i) => sourceRef('old-session', i, m)))
  const state: ReflectionState = { version: 1, progress: [], batches: [{ id: 'batch', sessionId: 'old-session',
    sourceRefs: refs, units: 1, status: 'completed', attempts: 1, reflectionIds: ['reflection'] }], reflections: [
    { version: 1, id: 'reflection', content: '用户报告纸舟旅行票根支持 PDF 导出。', kind: 'project-state', basis: 'mixed',
      tags: ['纸舟', '旅行票根'], sourceRefs: refs, relatedReflectionIds: [], createdAt: 1, uncertainty: '仅依据历史报告，当前状态可能变化。' },
  ] }
  let raw = JSON.stringify(state)
  const read = vi.fn(() => createReflectionStore({ read: () => ({ ok: true, value: raw }), write: () => false }).read())
  const recall = createReflectionRecall(read)
  return { sessions, state, read, recall, save: () => { raw = JSON.stringify(state); recall.invalidate() } }
}

it('retrieves completed relevant understandings with typed origins and no internal identifiers', async () => {
  const f = await fixture()
  const result = await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(result.reason).toBe('selected'); expect(result.candidates).toHaveLength(1)
  const record = JSON.parse(result.candidates[0]!)
  expect(record).toMatchObject({ basis: 'mixed', kind: 'project-state', uncertainty: expect.any(String), sources: [
    { role: 'user', sourceScope: 'stored-user-report' }, { role: 'assistant', sourceScope: 'stored-assistant-utterance' },
  ] })
  expect(result.candidates.join()).not.toMatch(/old-session|"id"|digest|createdAt|sourceRefs/)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(f.read).toHaveBeenCalledTimes(1)
})

it('pins a snapshot before local hashing and observes only persisted updates on later turns', async () => {
  const f = await fixture()
  const current = f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  f.state.reflections[0]!.content = '用户报告纸舟旅行票根已经停止支持 PDF 导出。'
  f.save()
  expect((await current).candidates.join()).not.toContain('停止支持')
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).candidates.join()).toContain('停止支持')
  expect(f.read).toHaveBeenCalledTimes(2)
})

it('does not use pending/failed/empty/unrelated/invalid state and rechecks deleted or changed sources even with a cache', async () => {
  const f = await fixture()
  expect((await f.recall.retrieve(f.sessions, 'current', 'unrelated zebras')).reason).toBe('no-match')
  for (const status of ['pending', 'failed'] as const) {
    f.state.batches[0]!.status = status; f.save()
    expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).candidates).toEqual([])
  }
  f.state.batches[0]!.status = 'completed'; f.save()
  expect((await f.recall.retrieve([], 'current', '纸舟旅行票根 PDF')).reason).toBe('invalid-source')
  f.sessions[0]!.messages[0] = { role: 'user', content: '来源已被修改' }
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).reason).toBe('invalid-source')
  f.state.reflections[0]!.basis = 'broken' as never; f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).reason).toBe('storage-error')
  const broken = createReflectionRecall(() => { throw new Error('unavailable') })
  expect((await broken.retrieve([], 'current', '纸舟旅行票根 PDF')).reason).toBe('storage-error')
})

it('anchors vague followups only to user text, limits top K and drops whole over-budget candidates', async () => {
  const f = await fixture()
  const base = f.state.reflections[0]!
  f.state.reflections = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `reflection-${i}` }))
  f.state.batches[0]!.reflectionIds = f.state.reflections.map(r => r.id); f.save()
  const active: ConversationSession = { ...f.sessions[0]!, id: 'current', messages: [
    { role: 'user', content: '纸舟旅行票根 PDF 呢？' }, { role: 'assistant', content: 'unrelated zebras' },
  ] }
  const result = await f.recall.retrieve([...f.sessions, active], 'current', '还有呢')
  expect(result.candidates.length).toBeGreaterThan(0)
  expect(result.candidates.length).toBeLessThanOrEqual(REFLECTION_RECALL_LIMITS.topK)
  expect(`[${result.candidates.join(',')}]`.length).toBeLessThanOrEqual(REFLECTION_RECALL_LIMITS.chars)
  result.candidates.forEach(c => expect(JSON.parse(c).content).toBe(base.content))
  f.state.reflections = f.state.reflections.map(r => ({ ...r, content: '纸舟'.repeat(390), uncertainty: '可能'.repeat(140) }))
  f.save()
  const bounded = await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(bounded.candidates).toHaveLength(1)
  expect(JSON.parse(bounded.candidates[0]!).content).toHaveLength(780)
})

it('rejects persisted unsafe text and assistant-only facts while retaining assistant speech as an event', async () => {
  const f = await fixture()
  f.state.reflections[0]!.sourceRefs = [f.state.reflections[0]!.sourceRefs[1]!]; f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).reason).toBe('invalid-source')
  f.state.reflections[0]!.kind = 'event'; f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).candidates).toHaveLength(1)
  f.state.reflections[0]!.content += ' old-session E1'; f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')).candidates).toEqual([])
})
