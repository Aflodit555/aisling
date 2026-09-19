import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import type { ChatMessage, ChatProvider } from './provider'
import { createCharacterRuntime } from './runtime'
import { createVisualStimulus } from './stimulus'

describe('runtime visual stimulus', () => {
  it('frames the observation as context and replies', async () => {
    let captured: readonly ChatMessage[] = []
    const provider: ChatProvider = {
      id: 'stub',
      async complete(request) {
        captured = request.messages
        return { text: 'I see a cat on a windowsill' }
      },
    }
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({ character, createId: () => 't', getChatProvider: () => provider })

    const turn = await runtime.ingest(createVisualStimulus({
      source: 'web',
      observation: 'a cat on a windowsill',
      caption: 'what do you see?',
    }))

    expect(turn.status).toBe('completed')
    expect(turn.output).toEqual({ kind: 'text', text: 'I see a cat on a windowsill' })
    expect(captured.some(message =>
      message.role === 'system' && message.content?.includes('[Visual observation] a cat on a windowsill'),
    )).toBe(true)
    expect(captured.some(message => message.role === 'user' && message.content === 'what do you see?')).toBe(true)
  })

  it('fails the turn when no chat provider is configured', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({ character, createId: () => 't', getChatProvider: () => undefined })

    const turn = await runtime.ingest(createVisualStimulus({ source: 'web', observation: 'x' }))

    expect(turn.status).toBe('failed')
  })
})
