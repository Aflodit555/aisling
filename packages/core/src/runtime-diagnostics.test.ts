import { describe, expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import { createCharacterRuntime, type ChatRuntimeDiagnostic } from './runtime'
import { createUserTextStimulus } from './stimulus'
import type { ChatCompletionRequest } from './provider'

const character = () => createCharacter({ id: 'a', name: 'A', persona: 'Private persona', capabilities: [] })

describe('opt-in chat request diagnostics', () => {
  it('records actual injection and each tool-round request without leaking content', async () => {
    const records: ChatRuntimeDiagnostic[] = [], requests: ChatCompletionRequest[] = []
    let time = 100
    const runtime = createCharacterRuntime({ character: character(), now: () => time,
      diagnostic: r => records.push(r), getSituationContext: () => 'Private understanding',
      getTools: () => [{ name: 'local', description: 'Mock', parameters: {}, run: async () => 'Private tool result' }],
      getChatProvider: () => ({ id: 'mock', complete: async request => {
        expect(request).not.toHaveProperty('onTiming')
        requests.push(structuredClone(request)); time += 25
        return requests.length === 1 ? { text: '', toolCalls: [{ id: 'call', name: 'local', arguments: '{}' }] } : { text: 'Private reply' }
      } }) })
    const turn = await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'Private user message' }))
    expect(turn.status).toBe('completed')
    expect(records[0]).toMatchObject({ type: 'p2-b-context', turnId: turn.id, injected: true, contextChars: 21 })
    const starts = records.filter(r => r.type === 'p2-b-request-start'), ends = records.filter(r => r.type === 'p2-b-request-end')
    expect(starts.map(r => r.requestId)).toEqual([`${turn.id}:0`, `${turn.id}:1`])
    expect(ends.map(r => r.durationMs)).toEqual([25, 25]); expect(ends.every(r => r.outcome === 'returned')).toBe(true)
    expect(JSON.stringify(records)).not.toContain('Private')
  })

  it('reports rejected context and provider failure separately from delivery', async () => {
    const records: ChatRuntimeDiagnostic[] = []
    const runtime = createCharacterRuntime({ character: character(), diagnostic: r => records.push(r),
      getSituationContext: () => 'x'.repeat(3001),
      getChatProvider: () => ({ id: 'mock', complete: async () => { throw new Error('Private upstream error') } }) })
    expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))).status).toBe('failed')
    expect(records[0]).toMatchObject({ injected: false, contextChars: 0, reason: 'context-limit' })
    expect(records.at(-1)).toMatchObject({ type: 'p2-b-request-end', outcome: 'failed' })
    expect(JSON.stringify(records)).not.toContain('Private'); expect(JSON.stringify(records)).not.toContain('delivered')
  })

  it('leaves model input and calls unchanged when disabled or the diagnostic sink throws', async () => {
    const inputs: string[] = []
    for (const diagnostic of [undefined, () => { throw new Error('sink unavailable') }]) {
      const complete = vi.fn(async (request: ChatCompletionRequest) => { inputs.push(JSON.stringify(request)); return { text: 'reply' } })
      const runtime = createCharacterRuntime({ character: character(), diagnostic,
        getSituationContext: () => 'Ready bounded context', getChatProvider: () => ({ id: 'mock', complete }) })
      expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))).status).toBe('completed')
      expect(complete).toHaveBeenCalledOnce()
    }
    expect(inputs[0]).toBe(inputs[1])
  })
})
