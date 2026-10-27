import { createDefaultPlatformConfig, createOpenAICompatibleProvider, createUserTextStimulus } from '@aisling/core'
import { expect, it } from 'vitest'
import { createAislingRuntime } from './aisling'
import { userTextEnableThinking } from './provider-factory'
import { recallForModel, retrieveRecall } from './memory-recall'

const config = { ...createDefaultPlatformConfig().consciousness, apiKey: 'MOCK_ONLY', model: 'qwen3.7-flash', temperature: 1.2,
  baseUrl: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }

it('disables thinking only for the verified model and endpoint; other routes retain their defaults', () => {
  expect(userTextEnableThinking(config)).toBe(false)
  expect(userTextEnableThinking({ ...config, baseUrl: `${config.baseUrl}/` })).toBe(false)
  for (const other of [{ ...config, model: 'other-model' }, { ...config, baseUrl: 'https://other.invalid/v1' },
    { ...config, baseUrl: 'not a URL' },
    { ...config, baseUrl: 'https://test-workspace.cn-beijing.maas.aliyuncs.com.evil.invalid/compatible-mode/v1' },
    { ...config, baseUrl: `${config.baseUrl}?enable_thinking=false` }]) {
    expect(userTextEnableThinking(other)).toBeUndefined()
  }
})

it('sends false for both stream and complete while preserving Memory, context, model, temperature and tools', async () => {
  const sessions = [{ id: 'history', title: 'Synthetic', createdAt: 0, updatedAt: 0, messages: [
    { role: 'user' as const, content: '柚灯项目支持 SVG 导出，由北辰编写代码，我负责测试。' },
    { role: 'assistant' as const, content: '我猜柚灯项目已经发布了。' },
    { role: 'user' as const, content: '纠正：柚灯项目还没发布，仍在试验；你只是猜测，未替我们执行发布。' },
  ] }]
  const query = '柚灯项目的 SVG 功能、发布纠正和代码测试分别归谁？'
  const recall = retrieveRecall(sessions, 'active', query)
  const projected = recallForModel(recall.evidence!)
  const bodies: Array<Record<string, unknown> & { messages: Array<{ content: string }> }> = []
  const provider = createOpenAICompatibleProvider({ ...config, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    bodies.push(body)
    return body.stream
      ? new Response('data: {"choices":[{"delta":{"content":"合成回复"}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ choices: [{ message: { content: '合成回复' } }] }), { headers: { 'Content-Type': 'application/json' } })
  } })
  const tools = [{ name: 'search', description: 'Same tool', parameters: {}, run: async () => 'unused' }]
  for (const memory of [false, true]) for (const streaming of [false, true]) for (const applyPolicy of [false, true]) {
    const activeProvider = streaming ? provider : { id: provider.id, complete: provider.complete }
    const runtime = createAislingRuntime({ getChatProvider: () => activeProvider, getTools: () => tools,
      getRecallEvidence: () => memory ? projected.evidence : undefined,
      ...(applyPolicy ? { getUserTextEnableThinking: () => userTextEnableThinking(config) } : {}) })
    expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: query }))).status).toBe('completed')
  }
  expect(bodies).toHaveLength(8)
  for (let i = 0; i < bodies.length; i += 2) {
    const baseline = bodies[i]!, disabled = bodies[i + 1]!
    expect(baseline).not.toHaveProperty('enable_thinking')
    expect(disabled).toEqual({ ...baseline, enable_thinking: false })
    expect(disabled).not.toHaveProperty('extra_body')
    expect(disabled).toMatchObject({ model: 'qwen3.7-flash', temperature: 1.2, stream: i % 4 === 2 })
  }
  for (const body of bodies.slice(0, 4)) expect(JSON.stringify(body)).not.toContain('[Cross-session recall evidence]')
  for (const body of bodies.slice(4)) {
    const evidence = body.messages.filter(m => m.content.startsWith('[Cross-session recall evidence]'))
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.content).toContain(projected.evidence)
    expect(evidence[0]!.content).toMatch(/later correction supersedes|not independently/)
    expect(evidence[0]!.content).toContain('纠正：柚灯项目还没发布')
    expect(evidence[0]!.content).toContain('stored-assistant-utterance')
  }
  expect(projected.sources.map(s => s.messageIndex)).toEqual([0, 1, 2])
})

it.each([
  { ...config, baseUrl: 'https://api.openai.com/v1', model: 'other-model' },
  { ...config, model: 'other-model' },
  { ...config, baseUrl: 'https://api.ppio.com/openai', model: 'qwen/qwen3.8-flash' },
])('omits the field from actual requests to other providers/models: $model', async other => {
  let body: Record<string, unknown> = {}
  const provider = createOpenAICompatibleProvider({ ...other, fetchImpl: async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'Content-Type': 'application/json' } })
  } })
  const runtime = createAislingRuntime({ getChatProvider: () => provider, getTools: () => [],
    getUserTextEnableThinking: () => userTextEnableThinking(other) })
  expect((await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))).status).toBe('completed')
  expect(body).not.toHaveProperty('enable_thinking')
})

it('does not change direct background calls through the shared Consciousness provider', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const provider = createOpenAICompatibleProvider({ ...config, fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'Content-Type': 'application/json' } })
  } })
  const runtime = createAislingRuntime({ getChatProvider: () => provider, getTools: () => [],
    getUserTextEnableThinking: () => userTextEnableThinking(config) })
  await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'hello' }))
  await provider.complete({ messages: [{ role: 'user', content: 'background formation' }] })
  expect(bodies[0]!.enable_thinking).toBe(false)
  expect(bodies[1]).not.toHaveProperty('enable_thinking')
})
