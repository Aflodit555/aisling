import { describe, expect, it, vi } from 'vitest'

import { createCharacter } from './character'
import type { ChatProvider } from './provider'
import { createCharacterRuntime } from './runtime'
import { createUserTextStimulus } from './stimulus'
import { estimateMessageTokens } from './context'

const provider: ChatProvider = {
  id: 'stub',
  async complete() {
    return { text: 'ok' }
  },
}

describe('runtime history window', () => {
  it('slides by tokens without deleting the full session history', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const complete = vi.fn(async (_request: import('./provider').ChatCompletionRequest) => ({ text: 'ok' }))
    const runtime = createCharacterRuntime({
      character,
      createId: () => 't',
      getChatProvider: () => ({ id: 'capture', complete }),
      historyTokenBudget: estimateMessageTokens({ role: 'user', content: 'two' }) + estimateMessageTokens({ role: 'assistant', content: 'ok' }),
    })

    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'one' }))
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'two' }))
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'three' }))
    expect(runtime.history.length).toBe(6)
    expect(complete.mock.calls[2]![0].messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'two' }, { role: 'assistant', content: 'ok' },
    ])
    expect(complete.mock.calls[2]![0].messages).not.toContainEqual({ role: 'user', content: 'one' })
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
