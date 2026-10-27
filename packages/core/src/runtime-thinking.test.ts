import { expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import { createCharacterRuntime } from './runtime'
import { createAutonomousStimulus, createUserTextStimulus, createVisualStimulus } from './stimulus'
import type { ChatCompletionRequest } from './provider'

it('captures the user-text override once, preserves it across tool rounds, and leaves other turn kinds unchanged', async () => {
  const requests: ChatCompletionRequest[] = []
  const override = vi.fn<() => false | undefined>(() => false)
  const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
    getUserTextEnableThinking: override,
    getTools: () => [{ name: 'tool', description: '', parameters: {}, run: async () => 'result' }],
    getChatProvider: () => ({ id: 'mock', complete: async request => {
      requests.push(request)
      if (requests.length === 1) { override.mockReturnValue(undefined); return { text: '', toolCalls: [{ id: 'c', name: 'tool', arguments: '{}' }] } }
      return { text: 'ok' }
    } }) })
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))
  expect(override).toHaveBeenCalledOnce()
  expect(requests.slice(0, 2).map(r => r.enableThinking)).toEqual([false, false])
  override.mockReturnValue(false)
  await runtime.ingest(createVisualStimulus({ source: 'test', observation: 'screen' }))
  await runtime.ingest(createAutonomousStimulus({ candidate: { id: 'c', objectId: 'o', source: 'media', change: 'appeared',
    snapshot: { capturedAt: 1, targetHwnd: '1', sequence: 1 }, target: { app: 'p', title: 'song', artist: '' } } }))
  expect(override).toHaveBeenCalledOnce()
  for (const r of requests.slice(2)) expect(r).not.toHaveProperty('enableThinking')
  override.mockReturnValue(undefined)
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'back to default' }))
  expect(requests.at(-1)).not.toHaveProperty('enableThinking')
})
