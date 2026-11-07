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

it('never recalls pending C candidates or Renderer-forged qualification, and rechecks C eligibility without manual invalidation',async()=>{
 const f=await fixture(),r=f.state.reflections[0]!,batch=f.state.batches[0]!
 batch.organization={version:1,settled:true,items:[{action:'ADD',reflectionId:r.id,status:'proposed-not-applied',reason:'review'}]}
 r.recallEligible=true
 const read=vi.fn(()=>structuredClone(f.state)),recall=createReflectionRecall(read)
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(0)
 batch.organization.items[0]!.status='applied';r.recallEligible=false
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(0)
 r.recallEligible=true
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(1)
 r.recallEligible=false
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(0)
 expect(read).toHaveBeenCalledTimes(4)
})

it('retrieves completed relevant understandings with typed origins and no internal identifiers', async () => {
  const f = await fixture()
  const result = await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(result.reason).toBe('selected'); expect(result.candidates).toHaveLength(1)
  const record = JSON.parse(result.candidates[0]!)
  expect(record).toMatchObject({ basis: 'mixed', kind: 'project-state', uncertainty: expect.any(String), sources: [
    expect.objectContaining({ role: 'user', sourceScope: 'stored-user-report', time: 'session-only', position: 1 }),
    expect.objectContaining({ role: 'assistant', sourceScope: 'stored-assistant-utterance', time: 'session-only', position: 2 }),
  ] })
  expect(record.formedAt).toBe(new Date(1).toISOString())
  expect(record.sources[0].sessionTime).toEqual({ createdAt: new Date(1).toISOString(), updatedAt: new Date(1).toISOString() })
  expect(result.candidates.join()).not.toMatch(/old-session|"id"|digest|sourceRefs/)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(f.read).toHaveBeenCalledTimes(2)
})

it('checks the Main erasure barrier before using a cached legacy index',async()=>{
 const f=await fixture();let blocked=false
 const recall=createReflectionRecall(()=>{if(blocked)throw new Error('erasure-pending');return structuredClone(f.state)})
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(1)
 blocked=true
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).reason).toBe('storage-error')
 blocked=false;f.state.reflections=[];f.state.batches=[]
 expect((await recall.retrieve(f.sessions,'current','纸舟旅行票根 PDF')).candidates).toHaveLength(0)
})

it('pins a snapshot before local hashing and observes only persisted updates on later turns', async () => {
  const f = await fixture()
  const current = f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  f.state.reflections[0]!.content = '用户报告纸舟旅行票根已经停止支持 PDF 导出。'
  f.save()
  const captured = await current
  expect(captured.candidates.join()).not.toContain('停止支持')
  if (!('select' in captured)) throw new Error('Expected a captured selector')
  expect(captured.select(() => true).join()).not.toContain('停止支持')
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
  expect(bounded.candidates).toHaveLength(0)
  expect(bounded.reason).toBe('candidate-budget')
  f.state.reflections = f.state.reflections.map(r => ({ ...r, content: '纸舟'.repeat(250) }))
  f.save()
  const smaller = await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根 PDF')
  expect(smaller.candidates).toHaveLength(1)
  expect(JSON.parse(smaller.candidates[0]!).content).toHaveLength(500)
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
it('allows literal identifiers only from hash-verified cited messages', async () => {
  const f = await fixture()
  const message = f.sessions[0]!.messages[0]!
  f.sessions[0]!.messages[0] = { ...message, content: '纸舟旅行票根货架 R8 使用传感器 E2，旧编号 R3。' }
  const ref = await sourceRef('old-session', 0, f.sessions[0]!.messages[0]!)
  f.state.reflections[0]!.sourceRefs = [ref]
  f.state.reflections[0]!.content = '用户报告纸舟旅行票根货架 R8 使用传感器 E2，旧编号 R3。'
  f.state.reflections[0]!.tags = ['纸舟', 'R8']
  f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根货架 R8')).candidates).toHaveLength(1)
  f.state.reflections[0]!.content += ' 参考 R99'
  f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根货架 R8')).candidates).toHaveLength(0)
  f.sessions[0]!.messages.push({ role: 'user', content: '未引用消息中有 R99' })
  f.save()
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根货架 R8')).candidates).toHaveLength(0)
  f.state.reflections[0]!.content = '用户报告纸舟旅行票根货架 R8。'
  f.save()
  f.sessions[0]!.messages[0] = { ...f.sessions[0]!.messages[0]!, content: '原文已变更' }
  expect((await f.recall.retrieve(f.sessions, 'current', '纸舟旅行票根货架 R8')).candidates).toHaveLength(0)
})
