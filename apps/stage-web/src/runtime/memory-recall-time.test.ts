import { createUserTextStimulus, type ChatCompletionRequest, type ConversationMessage } from '@aisling/core'
import { expect, it, vi } from 'vitest'
import type { ConversationSession } from '../conversation/conversation-store'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from '../../../../packages/core/src/context'
import { createAislingRuntime } from './aisling'
import { recallForModel, RECALL_LIMITS, retrieveRecall } from './memory-recall'

const early = Date.parse('2026-09-01T08:00:00Z')
const later = Date.parse('2026-10-01T08:00:00Z')
const session = (id: string, messages: ConversationMessage[], createdAt = 0, updatedAt = createdAt): ConversationSession =>
  ({ id, title: '', createdAt, updatedAt, messages })
const report = (content: string, createdAt?: number): ConversationMessage => ({ role: 'user', content, createdAt })
type Evidence = { label: string; conversation: string; position: number; content: string; role: string; sourceScope: string;
  time: string | { kind: string; at: string }; sessionTime?: { createdAt?: string; updatedAt?: string } }

function recall(sessions: ConversationSession[], query: string) {
  const result = retrieveRecall(sessions, 'active', query)
  expect(result.evidence).toBeDefined()
  const projected = recallForModel(result.evidence!)
  for (const evidence of [result.evidence!, projected.evidence]) {
    expect(evidence.length).toBeLessThanOrEqual(RECALL_LIMITS.chars)
    expect(new TextEncoder().encode(evidence).length).toBeLessThanOrEqual(RECALL_LIMITS.bytes)
  }
  return { result, projected, records: JSON.parse(projected.evidence) as Evidence[] }
}

// User-supplied change scenarios: these test evidence delivery, not a model's semantic accuracy.
it.each([
  ['兴趣变化', '我现在更想练手碟还是画画', '我想练手碟，手碟是我最近想练的乐器。', '手碟先暂时放下，现在更想画画。'],
  ['状态更新', '购买手碟', '手碟还没购买，正在了解手碟。', '手碟已经购买，今天收到了。'],
  ['计划与事实', '购买手碟', '我在考虑购买手碟，还没决定。', '我计划下个月购买手碟，现在还没有买。'],
])('delivers both periods of %s with speech times and the interpretation policy', async (_name, query, past, current) => {
  const old = session('old', [report(past, early)])
  const recent = session('recent', [report(current, later)])
  const { records, projected } = recall([recent, old], query)
  expect(records.map(r => r.content)).toEqual([past, current])
  expect(records.map(r => r.time)).toEqual([
    { kind: 'message-created', at: new Date(early).toISOString() },
    { kind: 'message-created', at: new Date(later).toISOString() },
  ])
  const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: '' }))
  const runtime = createAislingRuntime({ getChatProvider: () => ({ id: 'offline', complete }), getTools: () => [],
    getRecallEvidence: () => projected.evidence })
  expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))).status).toBe('completed')
  expect(complete).toHaveBeenCalledOnce()
  const request = complete.mock.calls[0]![0]
  const block = request.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  for (const principle of ['past state, current state, future plans', 'Plans or consideration never establish completion',
    'Later explicit user updates or corrections', 'New interests do not erase past interests', 'Mention frequency does not determine',
    'assistant guesses never count as user confirmation', 'insufficient, ambiguous or conflicting evidence']) expect(block).toContain(principle)
  expect(block).toContain(past); expect(block).toContain(current)
  expect(request.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
  runtime.dispose()
})

it('keeps same-session positions and user corrections even with tied or reversed clock readings', () => {
  const messages: ConversationMessage[] = [report('手碟还没买，我考虑购买手碟。', later),
    { role: 'assistant', content: '看来你已经买好手碟了。', createdAt: later },
    report('不是，手碟还没购买，现在只是计划。', early)]
  const { records } = recall([session('old', messages)], '购买手碟')
  expect(records.map(r => r.content)).toEqual(messages.map(m => m.content))
  expect(records.map(r => r.position)).toEqual([1, 2, 3])
  expect(records.map(r => r.sourceScope)).toEqual(['stored-user-report', 'stored-assistant-utterance', 'stored-user-report'])
})

it('exposes later direct user updates without upgrading earlier assistant guesses to user facts', () => {
  const guess = { role: 'assistant' as const, content: '你应该已经购买手碟了。', createdAt: early }
  const correction = report('没有购买手碟，我还在考虑购买。', later)
  const { records } = recall([session('a', [correction]), session('z', [guess])], '购买手碟')
  expect(records.map(r => r.content)).toEqual([guess.content, correction.content])
  expect(records.map(r => [r.role, r.sourceScope])).toEqual([
    ['assistant', 'stored-assistant-utterance'], ['user', 'stored-user-report'],
  ])
})

it('uses disjoint session ranges only as coarse time and keeps unknown message times explicit', () => {
  const older = session('z', [report('手碟还没购买。')], early, early + 1000)
  const newer = session('a', [report('手碟已经购买。')], later, later + 1000)
  const { records } = recall([newer, older], '手碟购买')
  expect(records.map(r => r.content)).toEqual([older.messages[0]!.content, newer.messages[0]!.content])
  expect(records.every(r => r.time === 'session-only')).toBe(true)
  expect(records.map(r => r.sessionTime)).toEqual([early, later].map(t => ({
    createdAt: new Date(t).toISOString(), updatedAt: new Date(t + 1000).toISOString(),
  })))
})

it.each(['unknown', 'equal', 'overlap', 'invalid'] as const)('retains relevance order when cross-session times are %s', mode => {
  const first = session('a', [report('购买手碟还在考虑。')])
  const second = session('z', [report('购买手碟已经完成。')])
  if (mode === 'equal') {
    first.messages[0] = report(first.messages[0]!.content!, early)
    second.messages[0] = report(second.messages[0]!.content!, early)
  }
  if (mode === 'overlap') {
    first.createdAt = early + 100; first.updatedAt = later
    second.createdAt = early; second.updatedAt = later
  }
  if (mode === 'invalid') {
    first.createdAt = Number.NaN; first.updatedAt = Number.POSITIVE_INFINITY
    second.createdAt = -1; second.updatedAt = 9e15
  }
  const { result, records, projected } = recall([first, second], '购买手碟')
  expect(projected.sources.map(s => s.sessionId)).toEqual(result.sessionIds)
  expect(records.map(r => r.label)).toEqual(['E1', 'E2'])
  if (mode === 'unknown' || mode === 'invalid') {
    expect(records.every(r => r.time === 'unknown' && !r.sessionTime)).toBe(true)
  }
})

it('reuses an existing autonomous delivery timestamp without dating the depicted event', () => {
  const { records } = recall([session('old', [{ role: 'assistant', content: '手碟练习视频看起来不错。',
    autonomousContext: { deliveredAt: later, observedAt: early, source: 'foreground', change: 'appeared',
      app: 'Browser', title: '手碟旧视频' } }])], '手碟练习')
  expect(records[0]!.time).toEqual({ kind: 'utterance-delivered', at: new Date(later).toISOString() })
})

it('keeps the selected quotations and relevance priority while reordering their presentation', () => {
  const sessions = [session('strong', [report('手碟购买 手碟购买 手碟购买 手碟购买已完成。', later)]),
    session('past', [report('手碟还没购买。', early)]), session('unrelated', [report('这个周末天气不错。', later + 1000)])]
  const timed = recall(sessions, '手碟购买')
  const untimed = recall(sessions.map(s => ({ ...s, messages: s.messages.map(({ createdAt: _time, ...m }) => m) })), '手碟购买')
  expect(timed.result.rankedSessionIds).toEqual(untimed.result.rankedSessionIds)
  expect(timed.result.sessionIds).toEqual(untimed.result.sessionIds)
  expect(timed.records.map(r => r.content)).toEqual([sessions[1]!.messages[0]!.content, sessions[0]!.messages[0]!.content])
  expect(timed.records.map(r => r.conversation)).toEqual(['C2', 'C1'])
  expect(timed.result.sessionIds).not.toContain('unrelated')
})
