import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import type { ChatProvider } from './provider'
import { createCharacterRuntime } from './runtime'
import { createUserTextStimulus } from './stimulus'

const provider: ChatProvider = {
  id: 'stub',
  async complete() {
    return { text: 'ok' }
  },
}

describe('runtime history window', () => {
  it('caps the model context to maxHistoryMessages', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({
      character,
      createId: () => 't',
      getChatProvider: () => provider,
      maxHistoryMessages: 2,
    })

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'one' }))
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'two' }))

    expect(runtime.history.length).toBe(2)
    expect(runtime.history[0]).toEqual({ role: 'user', content: 'two' })
    expect(runtime.history[1]).toEqual({ role: 'assistant', content: 'ok' })
  })

  it('seeds from restored history', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({
      character,
      createId: () => 't',
      getChatProvider: () => provider,
      history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    })

    expect(runtime.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('resetHistory replaces the context (per-session isolation)', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({ character, createId: () => 't', getChatProvider: () => provider })

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'A1' }))
    runtime.resetHistory([{ role: 'user', content: 'B1' }, { role: 'assistant', content: 'B2' }])

    expect(runtime.history).toEqual([
      { role: 'user', content: 'B1' },
      { role: 'assistant', content: 'B2' },
    ])
  })
})
