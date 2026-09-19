import { describe, expect, it } from 'vitest'

import { createCharacter } from './character'
import type { ChatProvider } from './provider'
import { createCharacterRuntime } from './runtime'
import { createUserTextStimulus } from './stimulus'

describe('runtime provider swap', () => {
  it('resolves the chat provider at turn time and hot-swaps it without recreating the runtime', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })

    let provider: ChatProvider = { id: 'first', async complete() { return { text: 'from-first' } } }
    const runtime = createCharacterRuntime({
      character,
      createId: () => 't',
      getChatProvider: () => provider,
    })

    await expect(runtime.ingest(createUserTextStimulus({ source: 'web', text: 'x' })))
      .resolves.toMatchObject({ status: 'completed', output: { text: 'from-first' } })

    provider = { id: 'second', async complete() { return { text: 'from-second' } } }
    await expect(runtime.ingest(createUserTextStimulus({ source: 'web', text: 'y' })))
      .resolves.toMatchObject({ status: 'completed', output: { text: 'from-second' } })
  })

  it('fails the turn when no chat provider is available', async () => {
    const character = createCharacter({ id: 'a', name: 'A', persona: 'p', capabilities: [] })
    const runtime = createCharacterRuntime({
      character,
      createId: () => 't',
      getChatProvider: () => undefined,
    })

    await expect(runtime.ingest(createUserTextStimulus({ source: 'web', text: 'x' })))
      .resolves.toMatchObject({ status: 'failed' })
  })
})
