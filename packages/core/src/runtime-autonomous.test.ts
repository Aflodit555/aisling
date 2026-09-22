import { describe, expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import type { ChatCompletionRequest } from './provider'
import { createCharacterRuntime } from './runtime'
import { createAutonomousStimulus, createUserTextStimulus } from './stimulus'

describe('autonomous runtime observation', () => {
  it('uses recent context and ephemeral system metadata, persisting only the assistant output', async () => {
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
      activity: {
        idleSeconds: 3,
        focus: { app: 'Code', title: 'main.ts - project_Aisling', text: 'createCharacterRuntime' },
        media: [], mic: [], headphones: '',
      },
    }))
    const request = complete.mock.calls[0]![0]
    expect(request.messages.filter(message => message.role === 'user')).toEqual(history)
    expect(request.messages.at(-1)).toEqual({ role: 'system', content: expect.stringContaining('not a user message') })
    expect(request.messages.at(-1)!.content).toContain('main.ts - project_Aisling')
    expect(runtime.history).toEqual([...history, { role: 'assistant', content: turn.output!.text }])
    expect(eventTypes).toContain('output:produced')
    expect(eventTypes).toContain('turn:completed')

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Thanks!' }))
    expect(complete.mock.calls[1]![0].messages.some(message => message.content?.includes('Autonomous observation'))).toBe(false)
    expect(runtime.history.at(-2)).toEqual({ role: 'user', content: 'Thanks!' })
  })

  it('does not persist empty autonomous output or desktop context on failure', async () => {
    const complete = vi.fn().mockResolvedValueOnce({ text: '  ' }).mockRejectedValueOnce(new Error('offline'))
    const runtime = createCharacterRuntime({
      character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
      getChatProvider: () => ({ id: 'test', complete }),
    })
    const stimulus = createAutonomousStimulus({
      activity: { idleSeconds: 0, focus: { app: 'Code', title: '', text: '' }, media: [], mic: [], headphones: '' },
    })
    expect((await runtime.ingest(stimulus)).status).toBe('completed')
    expect((await runtime.ingest(stimulus)).status).toBe('failed')
    expect(runtime.history).toEqual([])
  })
})
