import { expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import { createCharacterRuntime } from './runtime'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from './context'
import { createAutonomousStimulus, createUserTextStimulus, createVisualStimulus } from './stimulus'
import type { ChatCompletionRequest } from './provider'

it('keeps baseline requests identical on absent/failed/oversized recall; never calls recall for autonomous/visual', async () => {
  const complete = vi.fn(async (_r: ChatCompletionRequest) => ({ text: '' }))
  const recall = vi.fn<() => string | undefined>(() => undefined)
  const character = createCharacter({ id: 'a', name: 'A', persona: 'Original persona', capabilities: [] })
  const make = (enabled: boolean) => createCharacterRuntime({ character, getChatProvider: () => ({ id: 'mock', complete }),
    ...(enabled ? { getRecallEvidence: recall } : {}) })
  const user = createUserTextStimulus({ source: 'test', text: 'recall a project' })
  await make(false).ingest(user); const baseline = complete.mock.calls.at(-1)![0]
  await make(true).ingest(user); expect(complete.mock.calls.at(-1)![0]).toEqual(baseline)
  recall.mockImplementationOnce(() => { throw new Error('read error') })
  await make(true).ingest(user); expect(complete.mock.calls.at(-1)![0]).toEqual(baseline)
  recall.mockReturnValueOnce('x'.repeat(6001))
  await make(true).ingest(user); expect(complete.mock.calls.at(-1)![0]).toEqual(baseline)
  recall.mockReturnValue('other-session-secret-marker')
  const count = recall.mock.calls.length
  const runtime = make(true)
  await runtime.ingest(createAutonomousStimulus({ candidate: { id: 'c', objectId: 'o', source: 'media', change: 'appeared',
    snapshot: { capturedAt: 1, targetHwnd: '1', sequence: 1 }, target: { app: 'p', title: 'song', artist: '' } } }))
  await runtime.ingest(createVisualStimulus({ source: 'test', observation: 'screen' }))
  expect(recall).toHaveBeenCalledTimes(count)
  expect(JSON.stringify(complete.mock.calls.slice(-2))).not.toContain('other-session-secret-marker')
})

it('uses spare budget without replacing current history or retaining evidence, including provider failure', async () => {
  const history = [{ role: 'user' as const, content: 'current history '.repeat(100) }, { role: 'assistant' as const, content: 'ok' }]
  const complete = vi.fn(async (_r: ChatCompletionRequest) => ({ text: '' }))
  let evidence = 'quoted history'
  const character = createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] })
  const make = (text: string, enabled: boolean) => {
    const runtime = createCharacterRuntime({ character, history, getChatProvider: () => ({ id: 'mock', complete }),
      ...(enabled ? { getRecallEvidence: () => evidence } : {}) })
    return { runtime, user: createUserTextStimulus({ source: 'test', text }) }
  }
  for (const text of ['question', 'q'.repeat(13000)]) {
    const base = make(text, false); await base.runtime.ingest(base.user)
    const baseline = complete.mock.calls.at(-1)![0]
    const enabled = make(text, true); await enabled.runtime.ingest(enabled.user)
    const request = complete.mock.calls.at(-1)![0]
    expect(request.messages.filter(m => !m.content?.startsWith('[Cross-session recall evidence]'))).toEqual(baseline.messages)
    expect(request.messages.reduce((s, m) => s + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    expect(JSON.stringify(enabled.runtime.history)).not.toContain('quoted history')
  }
  evidence = 'q'.repeat(6000)
  const full = make('q'.repeat(13000), true); await full.runtime.ingest(full.user)
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Cross-session recall evidence]')
  const failed = make('question', true)
  complete.mockRejectedValueOnce(new Error('offline'))
  expect((await failed.runtime.ingest(failed.user)).status).toBe('failed')
  expect(failed.runtime.history).toEqual(history)
})

it('repacks by relevance priority and preserves chronological presentation when spare context is limited', async () => {
  const evidence = JSON.stringify([2, 1, 3].map(i => ({ conversation: `C${i}`, content: `quote-${i} ${'x'.repeat(1700)}` })))
  const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: '' }))
  const runtime = createCharacterRuntime({
    character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
    history: [{ role: 'user', content: 'h'.repeat(3500) }],
    getChatProvider: () => ({ id: 'offline', complete }), getRecallEvidence: () => evidence,
    getReflectionContext: () => ({ candidates: [JSON.stringify({ content: 'old understanding' })], durationMs: 0, reason: 'selected' }),
  })
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'u'.repeat(4000) }))
  const request = complete.mock.calls[0]![0]
  const block = request.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  const records = JSON.parse(block.slice(block.lastIndexOf('\n') + 1))
  expect(records.map((r: { conversation: string }) => r.conversation)).toEqual(['C1'])
  expect(request.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
})
