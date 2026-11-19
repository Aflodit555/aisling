import { expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import { createCharacterRuntime, type CharacterRuntimeOptions } from './runtime'
import { createUserTextStimulus } from './stimulus'
import type { ChatCompletionRequest, ChatCompletionResult } from './provider'
const candidate = JSON.stringify({ content: 'Stored paperboat export report', kind: 'project-state', basis: 'direct' })
const evidence = JSON.stringify([{ conversation: 'C1', role: 'user', content: 'paperboat old report' }])
const stimulus = () => createUserTextStimulus({ source: 'test', text: 'paperboat export is now cancelled.' })
function fixture(extra: Partial<CharacterRuntimeOptions> = {}) {
 const complete = vi.fn(async (_r: ChatCompletionRequest): Promise<ChatCompletionResult> => ({ text: 'ok' }))
 const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: 'unchanged', capabilities: [] }),
  getChatProvider: () => ({ id: 'mock', complete }), ...extra })
 return { runtime, complete }
}

it.each([true, false])('packs v2 Notes as user-role data and reuses the same snapshot across tools (valid=%s)', async valid => {
  let current = true
  const select = vi.fn(() => [candidate])
  const getNoteContext = vi.fn(async () => ({ current: async () => current, select }))
  const getHistoryAddon = vi.fn(() => ({ candidates: [candidate], durationMs: 0, reason: 'selected' }))
  const f = fixture({ getNoteContext, ...{ getHistoryAddon }, getRecallEvidence: () => evidence,
    history: [{ role: 'user', content: 'current-session-history' }],
    getTools: () => [{ name: 'search', description: 'search', parameters: {}, run: async () => { current = valid; return 'result' } }],
  })
  f.complete.mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'call', name: 'search', arguments: '{}' }] })
  await f.runtime.ingest(stimulus())
  const [first, second] = f.complete.mock.calls.map(([request]) => request.messages)
  const note = first!.find(m => m.content?.startsWith('[Note recall evidence]'))
  expect(note?.role).toBe('user')
  expect(first!.some(m => m.content === 'current-session-history')).toBe(true)
  expect(second!.find(m => m.content?.startsWith('[Note recall evidence]'))).toEqual(valid ? note : undefined)
  expect(first!.find(m => m.content?.startsWith('[Cross-session recall evidence]')))
    .toEqual(second!.find(m => m.content?.startsWith('[Cross-session recall evidence]')))
  expect(getNoteContext).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledOnce()
  expect(getHistoryAddon).not.toHaveBeenCalled()
})
