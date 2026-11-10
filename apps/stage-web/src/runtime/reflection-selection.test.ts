import { createUserTextStimulus, type ChatCompletionRequest, type ChatRuntimeDiagnostic } from '@aisling/core'
import { expect, it, vi } from 'vitest'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from '../../../../packages/core/src/context'
import { createAislingRuntime } from './aisling'
import { legacyRecallProvider } from '@aisling/core/legacy-recall'
import { createReflectionRecall, selectReflectionCandidates, type ReflectionSelectionCandidate } from './reflection-recall'
import { createReflectionStore, type ReflectionState } from './reflection-store'
import { selectionFixture } from './__tests__/fixtures/recall-selection'
import { recallForModel, retrieveRecall } from './memory-recall'

const questions = [
  ['comparison', '练手碟和画画这几次，有没有什么相似的地方？'],
  ['transfer', '我想写一篇完整的文章，但是迟迟没有开始。你怎么看？'],
  ['boundary', '这次我把任务缩小了，最后还是没有完成。你觉得这和以前的情况矛盾吗？'],
] as const
function reader(state: ReflectionState) {
  const raw = JSON.stringify(state)
  return () => createReflectionStore({ read: () => ({ ok: true, value: raw }), write: () => { throw new Error('Test is read-only') } }).read()
}
const contents = (candidates: readonly string[]) => candidates.map(c => JSON.parse(c).content as string)

it.each([false, true])('selects complementary evidence for all three questions, timed=%s', async timed => {
  const f = await selectionFixture(timed)
  for (const [task, question] of questions) {
    const recall = createReflectionRecall(reader(f.state)), result = await recall.retrieve(f.sessions, 'active', question)
    const selected = contents(result.candidates)
    expect(selected).toContain(f.state.reflections[1]!.content)
    expect(selected).toContain(f.state.reflections[2]!.content)
    expect(selected).not.toContain(f.state.reflections[0]!.content)
    expect(`[${result.candidates.join(',')}]`.length).toBeLessThanOrEqual(1500)
    expect(new TextEncoder().encode(`[${result.candidates.join(',')}]`).length).toBeLessThanOrEqual(4500)
    expect((await recall.retrieve(f.sessions, 'active', question)).candidates).toEqual(result.candidates)
    const requests: ChatCompletionRequest[] = [], diagnostics: ChatRuntimeDiagnostic[] = []
    const runtime = createAislingRuntime({ getTools: () => [], getHistoryAddon: legacyRecallProvider(() => result),
      diagnostic: record => diagnostics.push(record), getChatProvider: () => ({ id: 'offline', complete: async request => {
        requests.push(request); return { text: '' }
      } }) })
    await runtime.ingest(createUserTextStimulus({ source: 'test', text: question }))
    const block = requests[0]!.messages.find(m => m.content?.startsWith('[Historical Aisling reflections]'))!.content!
    expect(JSON.parse(block.slice(block.lastIndexOf('\n') + 1)).map((r: { content: string }) => r.content)).toEqual(selected)
    expect(diagnostics.find(d => d.type === 'context-assembled')?.reflectionSelection?.every(d => !('reflectionId' in d))).toBe(true)
    expect(requests[0]!.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    runtime.dispose()
    if (timed && task === 'transfer') {
      expect(result.selection.filter(d => d.eligible).map(d => d.chars).sort()).toEqual([1019, 457, 738].sort())
      expect(`[${result.candidates.join(',')}]`.length).toBe(1479)
    }
    console.info('Production combination selection', { timed, task,
      selected: selected.map(content => f.state.reflections.find(r => r.content === content)!.id),
      chars: `[${result.candidates.join(',')}]`.length, bytes: new TextEncoder().encode(`[${result.candidates.join(',')}]`).length })
  }
})

it('keeps the directly answering event for a concrete fact question', async () => {
  const f = await selectionFixture(true)
  const result = await createReflectionRecall(reader(f.state)).retrieve(f.sessions, 'active', '画画任务中，我后来画了什么杯子，完成了吗？')
  expect(contents(result.candidates)).toContain(f.state.reflections[2]!.content)
  expect(result.selection.find(d => d.reflectionId === 'drawing-event')?.order).toBe(1)
})

it('rejects missing and changed sources rather than binding similar new sessions', async () => {
  const f = await selectionFixture(true), recall = createReflectionRecall(reader(f.state))
  const sessions = f.sessions.filter(s => s.id === 'source-3')
  sessions.push({ ...f.sessions[0]!, id: 'new-similar-source' })
  const result = await recall.retrieve(sessions, 'active', questions[1][1])
  expect(contents(result.candidates)).toEqual([f.state.reflections[2]!.content])
  expect(result.selection.filter(d => d.kind === 'pattern').every(d => d.reason === 'invalid-source')).toBe(true)
  f.sessions[0]!.messages[0] = { ...f.sessions[0]!.messages[0]!, content: '来源变更。' }
  const changed = await recall.retrieve(f.sessions, 'active', questions[1][1])
  expect(changed.selection.filter(d => d.kind === 'pattern').every(d => d.reason === 'invalid-source')).toBe(true)
  expect((await recall.retrieve([], 'active', questions[1][1])).candidates).toEqual([])
  expect((await recall.retrieve(f.sessions, 'active', 'unrelated zebras')).reason).toBe('no-match')
})

function candidate(json: string, score: number, kind: ReflectionSelectionCandidate['kind'] = 'event', userReports = 1): ReflectionSelectionCandidate {
  return { json, score, kind, userReports, sources: new Set([json]), textTerms: new Set([json]),
    topics: new Set(['goal', 'practice', 'task']) }
}
it('optimizes the actual bounded cost, avoids repeated evidence and does not unconditionally prefer patterns', () => {
  const event = candidate(JSON.stringify({ content: 'x'.repeat(950) }), 10)
  const a = candidate(JSON.stringify({ content: 'a'.repeat(650) }), 7)
  const b = candidate(JSON.stringify({ content: 'b'.repeat(650) }), 7)
  expect(selectReflectionCandidates([event, a, b], false)).toEqual([a, b])
  const duplicate = { ...a }
  expect(selectReflectionCandidates([a, duplicate], false)).toEqual([a])
  const pattern = candidate(JSON.stringify({ content: 'p'.repeat(950) }), 2, 'pattern', 3)
  expect(selectReflectionCandidates([event, pattern], false)).toEqual([event])
  expect(selectReflectionCandidates([event, pattern], true)).toEqual([pattern])
  expect(selectReflectionCandidates([event, { ...pattern, userReports: 12, topics: new Set(['one-topic']) }], true)).toEqual([event])
  expect(selectReflectionCandidates([a, b], false, () => false)).toEqual([])
  expect(selectReflectionCandidates([], true)).toEqual([])
  const unicode = candidate(JSON.stringify({ content: '🙂'.repeat(700) }), 20)
  const chinese = candidate(JSON.stringify({ content: '中'.repeat(1490) }), 20)
  const bounded = selectReflectionCandidates([unicode, chinese], false)
  expect(bounded).toEqual([unicode])
  expect(`[${bounded.map(c => c.json).join(',')}]`.length).toBeLessThanOrEqual(1500)
  expect(new TextEncoder().encode(`[${bounded.map(c => c.json).join(',')}]`).length).toBeLessThanOrEqual(4500)
})

it('reselects from the same verified snapshot under the actual Runtime budget without replacing session history', async () => {
  const f = await selectionFixture(true), recall = createReflectionRecall(reader(f.state))
  const context = await recall.retrieve(f.sessions, 'active', questions[1][1])
  if (!('select' in context)) throw new Error('Expected a verified selection snapshot')
  const read = vi.spyOn(crypto.subtle, 'digest')
  const constrained = context.select!(items => items.length === 0 || items.every(item => item.length < 800))
  expect(contents(constrained)).not.toContain(f.state.reflections[1]!.content)
  expect(context.selection.find(d => d.reflectionId === 'cross-pattern')?.reason).toBe('context-budget')
  expect(read).not.toHaveBeenCalled(); read.mockRestore()
  const requests: ChatCompletionRequest[] = [], diagnostics: ChatRuntimeDiagnostic[] = []
  const runtime = createAislingRuntime({ history: [{ role: 'user', content: 'h'.repeat(3500) }], getTools: () => [],
    getChatProvider: () => ({ id: 'offline', complete: async request => { requests.push(request); return { text: '' } } }),
    getHistoryAddon: legacyRecallProvider(() => context), diagnostic: record => diagnostics.push(record) })
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'u'.repeat(8500) }))
  const request = requests[0]!, diagnostic = diagnostics.find(d => d.type === 'context-assembled')!
  expect(request.messages.some(m => m.content === 'h'.repeat(3500))).toBe(true)
  expect(request.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
  const block = request.messages.find(m => m.content?.startsWith('[Historical Aisling reflections]'))?.content
  const injected = block ? JSON.parse(block.slice(block.lastIndexOf('\n') + 1)) : []
  expect(injected.length).toBe(diagnostic.reflectionCount)
  expect(injected.map((r: { content: string }) => r.content)).toEqual(context.selection.filter(d => d.reason === 'selected')
    .sort((a, b) => a.order! - b.order!).map(d => f.state.reflections.find(r => r.id === d.reflectionId)!.content))
  expect(diagnostic.reflectionSelection?.some(d => d.reason === 'context-budget')).toBe(true)
  runtime.dispose()
})

it('bounds combination work and retains complete uncertainty', async () => {
  const six = Array.from({ length: 6 }, (_, i) => candidate(JSON.stringify({ content: `distinct ${i}` }), i + 1))
  let calls = 0
  const chosen = selectReflectionCandidates(six, false, () => { calls++; return true })
  expect(calls).toBe(41)
  expect(chosen).toHaveLength(3)
  const f = await selectionFixture(true)
  f.state.reflections[1]!.uncertainty = '仅基于有限报告；这次也可能不适用，不能据此保证完成。'
  const result = await createReflectionRecall(reader(f.state)).retrieve(f.sessions, 'active', questions[2][1])
  const pattern = result.candidates.map(c => JSON.parse(c)).find(r => r.kind === 'pattern')
  expect(pattern.uncertainty).toBe(f.state.reflections[1]!.uncertainty)
})

it.each(questions)('preserves raw Recall, mode gates and budgets for %s with the exact three summaries', async (_task, question) => {
  const f = await selectionFixture(true)
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    const raw = retrieveRecall(f.sessions, 'active', question)
    expect(raw.evidence).toBeDefined()
    const evidence = recallForModel(raw.evidence!).evidence
    const requests: ChatCompletionRequest[] = []
    for (const mode of ['A', 'B', 'C']) {
      const recall = createReflectionRecall(reader(f.state))
      const runtime = createAislingRuntime({ getTools: () => [],
        getChatProvider: () => ({ id: 'same-offline-provider', complete: async request => { requests.push(request); return { text: '' } } }),
        getRecallEvidence: () => mode === 'B' ? undefined : evidence,
        getHistoryAddon: legacyRecallProvider(() => mode === 'A' ? { candidates: [], durationMs: 0, reason: 'disabled' }
          : recall.retrieve(f.sessions, 'active', question)) })
      expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: question }))).status).toBe('completed')
      const messages = requests.at(-1)!.messages
      expect(messages.some(m => m.content?.startsWith('[Cross-session recall evidence]'))).toBe(mode !== 'B')
      expect(messages.some(m => m.content?.startsWith('[Historical Aisling reflections]'))).toBe(mode !== 'A')
      expect(messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
      runtime.dispose()
    }
    const block = (request: ChatCompletionRequest) => request.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content
    expect(block(requests[2]!)).toEqual(block(requests[0]!))
    expect(requests).toHaveLength(3)
  }
  finally { clock.mockRestore() }
})
