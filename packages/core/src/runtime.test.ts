import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import { createMockChatProvider } from './providers/mock-chat-provider'
import { createCharacterRuntime } from './runtime'
import { createUserTextStimulus } from './stimulus'

function makeRuntime() {
  const provider = createMockChatProvider()
  const character = createCharacter({
    id: 'aisling',
    name: 'Aisling',
    persona: 'Aisling is a calm, curious companion.',
    capabilities: [{ kind: 'chat', provider }],
  })
  const runtime = createCharacterRuntime({
    character,
    now: () => 1000,
    createId: (() => {
      let counter = 0
      return () => `turn-${++counter}`
    })(),
  })
  return { provider, runtime }
}

describe('character runtime minimal loop', () => {
  it('turns a web user-text stimulus into a character text output via the chat provider', async () => {
    const { runtime } = makeRuntime()
    const events: string[] = []
    runtime.onEvent(event => events.push(event.type))

    const turn = await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Hello' }))

    expect(turn.status).toBe('completed')
    expect(turn.output).toEqual({ kind: 'text', text: 'I\'m here. (mock) You said: “Hello”' })
    expect(runtime.history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'I\'m here. (mock) You said: “Hello”' },
    ])
    expect(events).toEqual([
      'stimulus:received',
      'turn:started',
      'character:engaged',
      'capability:selected',
      'provider:called',
      'output:produced',
      'turn:completed',
    ])
  })

  it('reports a failed turn when the character has no chat capability', async () => {
    const character = createCharacter({
      id: 'mute',
      name: 'Mute',
      persona: '',
      capabilities: [],
    })
    const runtime = createCharacterRuntime({ character, createId: () => 't' })

    const turn = await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Hi' }))

    expect(turn.status).toBe('failed')
    expect(turn.error).toContain('no chat capability')
  })

  it('keeps the conversation context across turns', async () => {
    const { runtime } = makeRuntime()

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'First' }))
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Second' }))

    expect(runtime.history.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })
})
