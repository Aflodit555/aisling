import { describe, expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import type { ChatCompletionRequest } from './provider'
import type { DesktopCandidate } from './stimulus'
import { createCharacterRuntime } from './runtime'
import { createAutonomousStimulus, createUserTextStimulus } from './stimulus'

describe('autonomous runtime observation', () => {
  it('uses only the candidate in an autonomous prompt and persists only the assistant output', async () => {
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'Take a small break from that file?' }))
    const history = [{ role: 'user' as const, content: 'I am working on Aisling.' }]
    const runtime = createCharacterRuntime({
      character: createCharacter({ id: 'aisling', name: 'Aisling', persona: 'Be warm.', capabilities: [] }),
      getChatProvider: () => ({ id: 'test', complete }),
      history,
    })
    const eventTypes: string[] = []
    runtime.onEvent(event => eventTypes.push(event.type))
    const turn = await runtime.ingest(createAutonomousStimulus({
      candidate: { id: 'candidate', objectId: 'object', source: 'foreground', change: 'appeared',
        snapshot: { capturedAt: 1, targetHwnd: '123', sequence: 1 }, target: { app: 'Code', title: 'main.ts - project_Aisling', text: 'createCharacterRuntime' } },
    }))
    const request = complete.mock.calls[0]![0]
    expect(request.messages.filter(message => message.role === 'user')).toEqual([])
    expect(request.messages.at(-1)).toEqual({ role: 'system', content: expect.stringContaining('not a user message') })
    expect(request.messages.at(-2)!.content).toContain('main.ts - project_Aisling')
    expect(runtime.history).toEqual([...history, { role: 'assistant', content: turn.output!.text }])
    expect(eventTypes).toContain('output:produced')
    expect(eventTypes).toContain('turn:completed')

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Thanks!' }))
    expect(complete.mock.calls[1]![0].messages.some(message => message.content?.includes('Desktop-triggered'))).toBe(false)
    expect(runtime.history.at(-2)).toEqual({ role: 'user', content: 'Thanks!' })
  })

  it('does not persist empty autonomous output or desktop context on failure', async () => {
    const complete = vi.fn().mockResolvedValueOnce({ text: '  ' }).mockRejectedValueOnce(new Error('offline'))
    const runtime = createCharacterRuntime({
      character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
      getChatProvider: () => ({ id: 'test', complete }),
    })
    const stimulus = createAutonomousStimulus({
      candidate: { id: 'c', objectId: 'o', source: 'foreground', change: 'appeared', snapshot: { capturedAt: 1, targetHwnd: '123', sequence: 1 }, target: { app: 'Code', title: 'File', text: 'Code text' } },
    })
    expect((await runtime.ingest(stimulus)).status).toBe('completed')
    expect((await runtime.ingest(stimulus)).status).toBe('failed')
    expect(runtime.history).toEqual([])
  })
  it('targets B without previous A conversation, retaining normal chat history', async () => {
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'B reply.' }))
    const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: 'Same persona.', capabilities: [] }),
      history: [{ role: 'user', content: 'Old song A discussion' }], getChatProvider: () => ({ id: 'mock', complete }) })
    const candidate: DesktopCandidate = { id: 'b', objectId: 'track-b', source: 'media', change: 'track-changed',
      snapshot: { capturedAt: 1, targetHwnd: '123', sequence: 1 }, target: { app: 'player', title: 'B', artist: 'Artist' } }
    await runtime.ingest(createAutonomousStimulus({ candidate }))
    const prompt = complete.mock.calls[0]![0].messages.map(message => message.content).join('\n')
    expect(prompt).toContain('"title":"B"'); expect(prompt).not.toContain('Old song A')
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'A normal question' }))
    expect(JSON.stringify(complete.mock.calls[1]![0])).toContain('Old song A discussion')
  })
})
