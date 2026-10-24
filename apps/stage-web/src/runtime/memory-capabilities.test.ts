import { expect, it } from 'vitest'
import type { ConversationSession } from '../conversation/conversation-store'
import { recallForModel, retrieveRecall, RECALL_LIMITS } from './memory-recall'
import corpus from './__tests__/fixtures/recall-history.json'

const session = (id: string, contents: string[], updatedAt = 999): ConversationSession => ({ id, title: '', createdAt: 999, updatedAt,
  messages: contents.map(content => ({ role: 'user', content })) })
const project = (sessions: ConversationSession[], query: string) => {
  const result = retrieveRecall(sessions, 'new', query)
  return { result, records: JSON.parse(recallForModel(result.evidence!).evidence) as Array<{
    conversation: string; content: string; position: number; sourceScope: string; autonomousBasis?: unknown
  }> }
}

it('keeps dated updates, later problems and corrections without treating ranking or session timestamps as event order', () => {
  const sessions = [
    session('release', ['2026-04-02: Lantern parser stable release shipped.'], 9_999_999),
    session('problem', ['2026-04-05: Lantern parser stable release has a new crash.'], 1),
    session('experiment', ['2026-03-01: Lantern parser is experimental.', 'Lantern parser is production ready.',
      'Correction: Lantern parser is still experimental; the earlier readiness claim was wrong.'], 99),
  ]
  const query = 'Lantern parser experimental release status'
  const { result, records } = project(sessions, query)
  expect(result.sessionIds).toHaveLength(3)
  for (const s of sessions) {
    const visible = records.filter(r => r.conversation === records.find(r => r.content === s.messages[0]!.content)!.conversation)
    expect(visible.map(r => r.content)).toEqual(s.messages.map(m => m.content))
    expect(visible.map(r => r.position)).toEqual(s.messages.map((_, i) => i + 1))
  }
  expect(JSON.stringify(records)).not.toMatch(/updatedAt|createdAt|9999999|messageTime|eventTime/)
  expect(project(sessions.map(s => ({ ...s, updatedAt: 0 })), query).records).toEqual(records)
})

it('retains contradictory and undated reports verbatim, without manufacturing a resolution or time', () => {
  const { records } = project([
    session('a', ['Lantern parser is stable today.']), session('b', ['Lantern parser is not stable today.']),
  ], 'Lantern parser stable')
  expect(records.map(r => r.content).sort()).toEqual(['Lantern parser is not stable today.', 'Lantern parser is stable today.'])
  expect(records.every(r => r.sourceScope === 'stored-user-report' && !r.autonomousBasis)).toBe(true)
})

it('retrieves both PDF and OCR histories across the rename with the existing Top-5 limit', () => {
  const sessions: ConversationSession[] = corpus.sessions.map(s => session(s.session_id, s.messages.map(m => m.content)))
  const result = retrieveRecall(sessions, 'new', '纸航的 PDF 导出与 OCR 各自经历了什么状态变化？')
  expect(result.sessionIds).toEqual(expect.arrayContaining(['H04', 'H07', 'H15', 'H21']))
  expect(result.sessionIds.length).toBeLessThanOrEqual(RECALL_LIMITS.topK)
  expect(result.packingOmittedSessionIds).toEqual([])
})

it('keeps exact Latin subject matches competitive with incidental Chinese character matches', () => {
  const sessions = [session('topic', ['Beacon Zeta 仍在试验。']),
    ...Array.from({ length: 6 }, (_, i) => session(`noise${i}`, ['最近状态发生变化，你问各自经历了什么。']))]
  expect(retrieveRecall(sessions, 'new', 'Beacon Zeta 各自经历了什么状态变化？').sessionIds).toContain('topic')
  expect(retrieveRecall(sessions, 'new', 'wholly unrelated quasar').evidence).toBeUndefined()
})

it('reports packing loss separately and never separates a correction from its session to fit the budget', () => {
  const oversized = session('large', Array.from({ length: 10 }, (_, i) => `Lantern parser report ${i}: ${'状态'.repeat(150)}`))
  oversized.messages.push({ role: 'user', content: 'Correction: Lantern parser is not stable.' })
  const result = retrieveRecall([oversized, session('small', ['Lantern parser status is unknown.'])], 'new', 'Lantern parser status')
  expect(result.rankedSessionIds).toContain('large')
  expect(result.packingOmittedSessionIds).toContain('large')
  expect(result.sessionIds).toEqual(['small'])
  expect(result.evidence).not.toContain('Lantern parser report')
  const onlyLarge = retrieveRecall([oversized], 'new', 'Lantern parser status')
  expect(onlyLarge.evidence).toBeUndefined()
  expect(onlyLarge.packingOmittedSessionIds).toEqual(['large'])
})

it('bounds the projected bytes as well as the storage projection and retains source positions across gaps', () => {
  const old = session('short', ['Lantern parser initial report.', 'password: excluded', 'Lantern parser corrected report.'])
  const { result, records } = project([old], 'Lantern parser')
  expect(records.map(r => r.position)).toEqual([1, 3])
  expect(new TextEncoder().encode(recallForModel(result.evidence!).evidence).length).toBeLessThanOrEqual(RECALL_LIMITS.bytes)
  expect(result.evidence).not.toContain('password')
})
