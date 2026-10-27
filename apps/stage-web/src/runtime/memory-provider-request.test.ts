import { createOpenAICompatibleProvider, createUserTextStimulus, type ChatProvider } from '@aisling/core'
import { expect, it, vi } from 'vitest'
import { createAislingRuntime } from './aisling'
import { recallForModel, retrieveRecall } from './memory-recall'

type WireRequest = { messages: Array<{ role: string; content: string | null }>; stream: boolean; [key: string]: unknown }
const history = [{ role: 'user' as const, content: '当前会话的其他话题。' }, { role: 'assistant' as const, content: '知道啦。' }]
const query = '纸舟旅行票根工具 PDF 导出如何？'
const sessions = [{ id: 'old', title: 'Synthetic', createdAt: 0, updatedAt: 0,
  messages: [{ role: 'user' as const, content: '纸舟旅行票根工具支持 PDF 导出。' },
    { role: 'assistant' as const, content: '纸舟导出已确认。' }] }]
const recall = () => recallForModel(retrieveRecall(sessions, 'active', query).evidence!).evidence
const tools = [{ name: 'web_search', description: 'Synthetic search', parameters: { type: 'object' }, run: async () => 'Synthetic result' }]
const response = (payload: unknown) => new Response(JSON.stringify({ choices: [{ message: payload, finish_reason: 'stop' }] }),
  { headers: { 'Content-Type': 'application/json' } })

it('recall adds one evidence message while preserving all other wire parameters on the same history', async () => {
  const bodies: WireRequest[] = []
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid/v1', apiKey: 'synthetic', model: 'same-model', temperature: 0.7,
    fetchImpl: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return response({ content: '合成回复。' }) } })
  for (const enabled of [false, true]) {
    const runtime = createAislingRuntime({ getChatProvider: () => provider, getTools: () => tools, history: [...history],
      getSituationContext: () => 'Same short-term context', getRecallEvidence: () => enabled ? recall() : undefined })
    const turn = await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))
    expect(turn.status).toBe('completed')
  }
  const baseline = bodies[0]!
  expect(bodies).toHaveLength(2)
  const enabled = bodies[1]!, evidence = enabled.messages.filter(m => m.content?.startsWith('[Cross-session recall evidence]'))
  expect(evidence).toHaveLength(1)
  expect({ ...enabled, messages: enabled.messages.filter(m => !evidence.includes(m)) }).toEqual(baseline)
  expect(enabled).toMatchObject({ model: 'same-model', temperature: 0.7, stream: true })
  expect(enabled).not.toHaveProperty('enable_thinking'); expect(enabled).not.toHaveProperty('max_completion_tokens')
  expect(JSON.stringify(enabled.tools)).toEqual(JSON.stringify(baseline.tools))
})

it('recalls once per turn and injects one evidence message per actual tool round, without retaining it in history', async () => {
  const bodies: WireRequest[] = [], getRecallEvidence = vi.fn(recall)
  const provider: ChatProvider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid/v1', apiKey: 'synthetic', model: 'same-model',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return response(bodies.length === 1 ? { content: null,
        tool_calls: [{ id: 'one-call', type: 'function', function: { name: 'web_search', arguments: '{}' } }] } : { content: '完成。' })
    } })
  const runtime = createAislingRuntime({ getChatProvider: () => provider, getTools: () => tools, history: [...history], getRecallEvidence })
  expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))).status).toBe('completed')
  expect(getRecallEvidence).toHaveBeenCalledOnce(); expect(bodies).toHaveLength(2)
  for (const body of bodies) expect(body.messages.filter(m => m.content?.startsWith('[Cross-session recall evidence]'))).toHaveLength(1)
  expect(JSON.stringify(runtime.history)).not.toContain('[Cross-session recall evidence]')
})
