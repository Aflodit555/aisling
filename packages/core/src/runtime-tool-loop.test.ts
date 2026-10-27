import { expect, it, vi } from 'vitest'
import { createCharacter } from './character'
import { createCharacterRuntime, type ChatRuntimeDiagnostic } from './runtime'
import { createOpenAICompatibleProvider } from './providers/openai-compatible-provider'
import { createUserTextStimulus } from './stimulus'

function setup(replies: number, recall = false, streaming = false, failTool = false) {
  const requests: Array<{ messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: Array<{ id: string }> }> }> = []
  const diagnostic: ChatRuntimeDiagnostic[] = []
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://offline.invalid', apiKey: 'test', model: 'test',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      const round = requests.length
      const message = round <= replies ? { content: null, tool_calls: [{ id: `call_${round}`, type: 'function',
        function: { name: 'search', arguments: '{"query":"private query"}' } }] } : { content: 'final answer' }
      if (streaming) {
        const delta = { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map(c => ({ ...c, index: 0 })) } : {}) }
        return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return Response.json({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })
    } })
  const run = vi.fn(async () => { if (failTool) throw new Error('private tool error'); return 'private search result' })
  const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: 'original', capabilities: [] }),
    getChatProvider: () => provider, getTools: () => [{ name: 'search', description: 'search', parameters: {}, run }],
    ...(recall ? { getRecallEvidence: () => '[{"content":"prior quotation"}]' } : {}), diagnostic: r => diagnostic.push(r) })
  return { runtime, run, requests, diagnostic }
}

it.each([false, true])('allows four tool rounds and their final answer with recall=%s', async recall => {
  const f = setup(4, recall, true)
  const turn = await f.runtime.ingest(createUserTextStimulus({ source: 'test', text: 'ordinary new-session question' }))
  expect(turn.status).toBe('completed'); expect(turn.output?.text).toBe('final answer')
  expect(f.run).toHaveBeenCalledTimes(4); expect(f.requests).toHaveLength(5)
  for (let index = 1; index < f.requests.length; index++) {
    const messages = f.requests[index]!.messages
    expect(messages.filter(m => m.role === 'tool')).toHaveLength(index)
    for (let n = 1; n <= index; n++) {
      expect(messages).toContainEqual({ role: 'tool', content: 'private search result', tool_call_id: `call_${n}` })
      expect(messages.some(m => m.role === 'assistant' && m.tool_calls?.[0]?.id === `call_${n}`)).toBe(true)
    }
  }
  expect(f.diagnostic.filter(r => r.type === 'p2-b-request-start')).toHaveLength(5)
  expect(f.diagnostic).toContainEqual(expect.objectContaining({ type: 'context-assembled', recallIncluded: recall }))
})

it.each([false, true])('stops repeated calls before executing an unconsumable fifth round, recall=%s', async recall => {
  const f = setup(5, recall)
  const turn = await f.runtime.ingest(createUserTextStimulus({ source: 'test', text: 'new session' }))
  expect(turn.status).toBe('failed'); expect(turn.error).toBe('Tool loop exceeded the maximum number of rounds')
  expect(f.run).toHaveBeenCalledTimes(4); expect(f.requests).toHaveLength(5)
  expect(f.runtime.history).toEqual([])
  expect(JSON.stringify(f.diagnostic)).not.toMatch(/private query|private search result|prior quotation|call_1/)
})

it('terminates a new-session ordinary reply once, and reports a failed tool with correctly linked feedback', async () => {
  const ordinary = setup(0)
  expect((await ordinary.runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))).status).toBe('completed')
  expect(ordinary.requests).toHaveLength(1); expect(ordinary.run).not.toHaveBeenCalled()
  const failed = setup(1, false, false, true)
  expect((await failed.runtime.ingest(createUserTextStimulus({ source: 'test', text: 'search' }))).status).toBe('completed')
  expect(failed.requests[1]!.messages).toContainEqual({ role: 'tool', content: 'Error: private tool error', tool_call_id: 'call_1' })
  expect(failed.run).toHaveBeenCalledOnce()
  expect(failed.requests).toHaveLength(2)
  expect(JSON.stringify(failed.diagnostic)).not.toContain('private tool error')
})
