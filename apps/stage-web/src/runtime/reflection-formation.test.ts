import { afterEach, expect, it, vi } from 'vitest'
import { createOpenAICompatibleProvider, type ChatCompletionRequest, type ChatCompletionResult, type ConversationMessage } from '@aisling/core'
import type { ConversationSession } from '../conversation/conversation-store'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { createReflectionStore, type ReflectionStorage } from './reflection-store'
import { createReflectionFormation, formationRequest, parseReflections, reflectionCandidates, sourceRef } from './reflection-formation'

afterEach(() => vi.useRealTimers())
function storage() {
  let value: string | null = null, fail = false
  const backend: ReflectionStorage = { read: () => ({ ok: true, value }), write: text => { if (fail) return false; value = text; return true } }
  return { backend, corrupt: (text: string) => { value = text }, fail: () => { fail = true }, raw: () => value }
}
const draft = { content: '用户报告纸舟只是导出按钮，尚无实际导出能力。', kind: 'project-state', basis: 'direct', tags: ['纸舟', 'PDF'], sources: ['E1'], related: [] }
async function evidence() {
  const messages: ConversationMessage[] = [{ role: 'user', content: '纸舟目前只是导出按钮，还不能生成文件。' },
    { role: 'assistant', content: '是我误把按钮当成已经完成了。' }]
  return Promise.all(messages.map(async (message, i) => ({ message, ref: await sourceRef('private-session', i, message) })))
}

it('projects only temporary labels and maps valid sources and associations back to internal records', async () => {
  const input = await evidence()
  const previous = parseReflections(JSON.stringify({ reflections: [draft] }), input, [])
  const request = formationRequest(input, previous)
  expect(JSON.stringify(request)).not.toMatch(/private-session|messageIndex|digest|sourceRefs/)
  expect(JSON.parse(request.messages[1]!.content!).evidence[0].label).toBe('E1')
  expect(JSON.parse(request.messages[1]!.content!).candidates[0].label).toBe('R1')
  const records = parseReflections(JSON.stringify({ reflections: [{ ...draft, related: ['R1'], sources: ['E1', 'E2'] }] }), input, previous, () => 123)
  expect(records[0]).toMatchObject({ version: 1, createdAt: 123, sourceRefs: input.map(e => e.ref), relatedReflectionIds: [previous[0]!.id] })
  expect(records[0]!.id).not.toBe(previous[0]!.id)
  expect(reflectionCandidates(previous, '纸舟 PDF')).toEqual(previous)
})

it('rejects malformed JSON, invented references, unsupported structures and assistant-only external facts', async () => {
  const input = await evidence()
  for (const output of ['```json\n{}\n```', '{', JSON.stringify({ reflections: [{ ...draft, sources: ['E99'] }] }),
    JSON.stringify({ reflections: [{ ...draft, related: ['R1'] }] }), JSON.stringify({ reflections: [{ ...draft, sources: [] }] }),
    JSON.stringify({ reflections: [{ ...draft, sources: ['E2'] }] }), JSON.stringify({ reflections: [{ ...draft, basis: 'inferred' }] }),
    JSON.stringify({ reflections: [{ ...draft, id: 'model-supplied' }] }), JSON.stringify({ reflections: [{ ...draft, content: '由 E1 证明。' }] })])
    expect(() => parseReflections(output, input, [])).toThrow('invalid-output')
  expect(parseReflections('{"reflections":[]}', input, [])).toEqual([])
})

it('accepts explicit related: [] with or without candidates without inventing associations', async () => {
  const input = await evidence()
  const output = JSON.stringify({ reflections: [{ ...draft, related: [] }] })
  const previous = parseReflections(output, input, [])
  for (const candidates of [[], previous]) {
    const records = parseReflections(output, input, candidates)
    expect(records).toHaveLength(1)
    expect(records[0]!.relatedReflectionIds).toEqual([])
    expect(records[0]!.sourceRefs).toEqual([input[0]!.ref])
  }
})

it('rejects omitted and non-array related fields without filling or coercing them', async () => {
  const input = await evidence()
  for (const related of [undefined, null, 'R1', '', {}, false, 0]) {
    const output = JSON.stringify({ reflections: [{ ...draft, related }] })
    if (related === undefined) expect(Object.hasOwn(JSON.parse(output).reflections[0], 'related')).toBe(false)
    let failure: unknown
    try { parseReflections(output, input, []) }
    catch (error) { failure = error }
    expect(failure).toMatchObject({ message: 'invalid-output', detail: {
      stage: 'output-schema', field: 'related', reason: 'array-required', reflectionIndex: 0,
    } })
  }
})

it('persists validated records and rejects corrupt state and failed writes without losing the previous snapshot', async () => {
  const s = storage(), store = createReflectionStore(s.backend)
  const records = parseReflections(JSON.stringify({ reflections: [draft] }), await evidence(), [])
  store.update(state => { state.reflections.push(...records) })
  expect(createReflectionStore(s.backend).read().reflections).toEqual(records)
  const raw = s.raw(); s.fail()
  expect(() => store.update(state => { state.reflections.push({ ...records[0]!, id: 'other' }) })).toThrow('reflection-store-write')
  expect(s.raw()).toBe(raw)
  s.corrupt('{broken')
  expect(() => store.update(() => {})).toThrow('reflection-store-invalid')
  expect(s.raw()).toBe('{broken')
})

function fixture(complete = vi.fn(async (_request: ChatCompletionRequest): Promise<ChatCompletionResult> => ({ text: '{"reflections":[]}' }))) {
  const s = storage()
  const session: ConversationSession = { id: 's', title: '', createdAt: 0, updatedAt: 0, messages: [] }
  const queue = createReflectionFormation({ storage: s.backend, getSessions: () => [session], getProvider: () => ({ id: 'mock', complete }) })
  async function deliver(n: number) {
    const start = session.messages.length
    session.messages.push({ role: 'user', content: `纸舟问题${n}仍需处理。` }, { role: 'assistant', content: `我确认你报告了纸舟问题${n}。` })
    await queue.delivered('s', [start, start + 1])
    return start
  }
  return { s, session, queue, complete, deliver }
}

it('defaults off, batches three completed interactions, and durably completes zero-reflection batches once', async () => {
  const f = fixture()
  await f.deliver(0)
  expect(f.s.raw()).toBeNull()
  expect(f.complete).not.toHaveBeenCalled()
  await f.queue.setEnabled(true)
  const index = await f.deliver(1)
  await f.deliver(2)
  expect(f.complete).not.toHaveBeenCalled()
  await f.deliver(3)
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.complete.mock.calls[0]![0].onTiming).toBeUndefined()
  expect(f.queue.diagnostics).toEqual({ enabled: false })
  expect(f.queue.inspect().batches[0]!.sourceRefs).toHaveLength(6)
  await f.queue.delivered('s', [index, index + 1])
  f.queue.dispose()
  const restarted = createReflectionFormation({ storage: f.s.backend, getSessions: () => [f.session], getProvider: () => ({ id: 'same', complete: f.complete }) })
  await restarted.setEnabled(true); await restarted.flush()
  await new Promise(resolve => setTimeout(resolve, 15))
  expect(f.complete).toHaveBeenCalledTimes(1)
  restarted.dispose()
})

it('flushes partial batches, persists failures, and retries only explicitly', async () => {
  const complete = vi.fn(async () => ({ text: '{broken' }))
  const f = fixture(complete)
  await f.queue.setEnabled(true); await f.deliver(1); await f.queue.flush('s')
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('failed'))
  expect(f.queue.inspect().batches[0]!.error).toBe('invalid-output')
  expect(f.queue.inspect().reflections).toEqual([])
  await f.queue.flush()
  await new Promise(resolve => setTimeout(resolve, 15))
  expect(complete).toHaveBeenCalledTimes(1)
  complete.mockResolvedValueOnce({ text: '{"reflections":[]}' })
  await f.queue.retry(f.queue.inspect().batches[0]!.id)
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('completed'))
  expect(f.queue.inspect().batches[0]!.attempts).toBe(2)
  f.queue.dispose()
})

it('does not save a stale or disabled in-flight result and detects source changes before calling the provider', async () => {
  let finish!: (result: ChatCompletionResult) => void
  const complete = vi.fn(() => new Promise<ChatCompletionResult>(resolve => { finish = resolve }))
  const f = fixture(complete)
  await f.queue.setEnabled(true); await f.deliver(1); await f.queue.flush()
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
  await f.queue.setEnabled(false)
  finish({ text: JSON.stringify({ reflections: [draft] }) })
  await vi.waitFor(() => expect(f.queue.status.running).toBe(false))
  expect(f.queue.inspect().reflections).toEqual([])
  f.session.messages[0] = { role: 'user', content: 'Changed source.' }
  await f.queue.setEnabled(true)
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('source-changed'))
  expect(complete).toHaveBeenCalledTimes(1)
  f.queue.dispose()
})

it('records an input-rejected batch durably without sending unsafe content to the provider', async () => {
  const f = fixture()
  await f.queue.setEnabled(true)
  f.session.messages.push({ role: 'user', content: 'password: must not be sent' }, { role: 'assistant', content: '收到。' })
  await f.queue.delivered('s', [0, 1])
  expect(f.queue.inspect().batches[0]).toMatchObject({ status: 'failed', attempts: 0, error: 'input-limit' })
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.s.raw()).not.toContain('must not be sent')
  f.queue.dispose()
})

it('distinguishes parse, schema, field, source-label and content rejection without retaining invalid values', async () => {
  const input = await evidence()
  const cases = [
    ['', 'json-parse', undefined, 'empty-content'],
    ['  ', 'json-parse', undefined, 'whitespace-only'],
    ['```json\n{}\n```', 'json-parse', undefined, 'markdown-fence'],
    ['Private narrative', 'json-parse', undefined, 'non-json-prefix'],
    ['{"Private":', 'json-parse', undefined, 'json-syntax'],
    ['{"reflections":{},"Private":"secret"}', 'output-schema', 'root', 'unexpected-fields-or-root'],
    ['{"reflections":{}}', 'output-schema', 'reflections', 'array-required-max-three'],
    [{ ...draft, related: null }, 'output-schema', 'related', 'array-required'],
    [{ ...draft, sources: ['E99'] }, 'reference-label', 'sources', 'label-not-provided'],
    [{ ...draft, related: ['Private'] }, 'reference-label', 'related', 'invalid-label'],
    [{ ...draft, content: 1 }, 'reflection-validation', 'content', 'invalid-value'],
    [{ ...draft, kind: 'Private' }, 'reflection-validation', 'kind', 'invalid-value'],
    [{ ...draft, tags: [null] }, 'reflection-validation', 'tags', 'invalid-value'],
    [{ ...draft, basis: 'inferred' }, 'reflection-validation', 'uncertainty', 'invalid-value'],
    [{ ...draft, sources: ['E2'] }, 'reflection-validation', 'kind/sources', 'assistant-only-external-claim'],
    [{ ...draft, kind: 'pattern', uncertainty: '有限证据。' }, 'reflection-validation', 'sources/uncertainty', 'pattern-evidence-required'],
    [{ ...draft, content: '来源 E1' }, 'reflection-validation', 'content/tags/uncertainty', 'evidence-label-in-text'],
  ] as const
  for (const [value, stage, field, reason] of cases) {
    let failure: unknown
    try { parseReflections(typeof value === 'string' ? value : JSON.stringify({ reflections: [value] }), input, []) }
    catch (error) { failure = error }
    expect(failure).toMatchObject({ message: 'invalid-output', detail: { stage, reason, ...(field ? { field } : {}) } })
    expect(JSON.stringify(failure)).not.toMatch(/Private|secret|private-session/)
  }
})

it('diagnoses Provider envelopes and JSON content independently, with no wire or persistence changes', async () => {
  const cases = [
    { body: { choices: [] }, shape: 'missing-message', reason: 'empty-content' },
    { body: { choices: [{ message: {} }] }, shape: 'missing-content', reason: 'empty-content' },
    { body: { choices: [{ message: { content: null, reasoning_content: 'Private reasoning' }, finish_reason: 'length' }] }, shape: 'null-content', reason: 'empty-content' },
    { body: { choices: [{ message: { content: [{ text: 'Private content' }] } }] }, shape: 'unsupported-content', reason: 'empty-content' },
    { body: { choices: [{ message: { content: '```json\n{"reflections":[]}\n```' }, finish_reason: 'stop' }] }, shape: 'string-content', reason: 'markdown-fence' },
  ]
  for (const sample of cases) {
    let wire = ''
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'Private credential', model: 'mock',
      fetchImpl: async (_url, init) => { wire = String(init?.body); return Response.json(sample.body) } })
    const f = fixture(vi.fn(request => provider.complete(request)))
    f.queue.setDiagnosticsEnabled(true)
    await f.queue.setEnabled(true); await f.deliver(1); await f.queue.flush()
    await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.status).toBe('failed'))
    expect(f.queue.diagnostics.lastFailure).toMatchObject({ error: 'invalid-output', stage: 'json-parse', reason: sample.reason,
      response: { responseShape: sample.shape, httpStatus: 200 } })
    if (sample.shape === 'null-content') expect(f.queue.diagnostics.lastFailure!.response).toMatchObject({ textChars: 0, reasoningChars: 17, finishReason: 'length' })
    expect(JSON.stringify(f.queue.diagnostics)).not.toMatch(/Private|reflections|纸舟/)
    expect(f.s.raw()).not.toMatch(/lastFailure|responseShape|Private/)
    expect(JSON.parse(wire)).toEqual({ model: 'mock', stream: false, messages: formationRequest(await Promise.all(f.queue.inspect().batches[0]!.sourceRefs.map(async ref =>
      ({ ref, message: f.session.messages[ref.messageIndex]! }))), []).messages, temperature: 0.2, max_completion_tokens: 1500 })
    f.queue.setDiagnosticsEnabled(false)
    expect(f.queue.diagnostics).toEqual({ enabled: false })
    f.queue.dispose()
  }
})

it('reports Provider errors without copying exception bodies and rejects a non-string adapter result', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://mock.invalid', apiKey: 'Private key', model: 'mock',
    fetchImpl: async () => Response.json({ error: { message: 'Private error body' } }, { status: 429 }) })
  const f = fixture(vi.fn(request => provider.complete(request)))
  f.queue.setDiagnosticsEnabled(true)
  await f.queue.setEnabled(true); await f.deliver(1); await f.queue.flush()
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('provider-error'))
  expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'provider', response: { httpStatus: 429, providerErrorKind: 'http-error' } })
  expect(JSON.stringify(f.queue.diagnostics)).not.toContain('Private')
  f.complete.mockResolvedValueOnce({ text: null } as unknown as ChatCompletionResult)
  await f.queue.retry(f.queue.inspect().batches[0]!.id)
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('invalid-output'))
  expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'provider-result', field: 'text', reason: 'text-not-string' })
  f.complete.mockResolvedValueOnce({ text: '{"reflections":[]}', toolCalls: [{ id: 'not-used', name: 'not-used', arguments: 'Private arguments' }] })
  await f.queue.retry(f.queue.inspect().batches[0]!.id)
  await vi.waitFor(() => expect(f.queue.diagnostics.lastFailure?.reason).toBe('unexpected-tool-calls'))
  expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'provider-result', field: 'toolCalls' })
  expect(JSON.stringify(f.queue.diagnostics)).not.toContain('Private')
  f.queue.dispose()
})

it('distinguishes deleted sessions, absent positions and changed digests before any Provider call', async () => {
  for (const reason of ['session-missing', 'message-missing', 'digest-mismatch']) {
    const f = fixture()
    f.queue.setDiagnosticsEnabled(true)
    await f.queue.setEnabled(true); await f.deliver(1)
    if (reason === 'session-missing') f.session.id = 'different'
    else if (reason === 'message-missing') f.session.messages = []
    else f.session.messages[0] = { role: 'user', content: 'Changed record.' }
    await f.queue.flush()
    await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('source-changed'))
    expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'source-before-request', reason })
    expect(f.complete).not.toHaveBeenCalled()
    f.queue.dispose()
  }
})

it('rechecks sources after a valid response and rejects edits made during the request', async () => {
  let finish!: (result: ChatCompletionResult) => void
  const f = fixture(vi.fn(() => new Promise<ChatCompletionResult>(resolve => { finish = resolve })))
  f.queue.setDiagnosticsEnabled(true)
  await f.queue.setEnabled(true); await f.deliver(1); await f.queue.flush()
  await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1))
  f.session.messages[0] = { role: 'user', content: 'Changed during request.' }
  finish({ text: '{"reflections":[]}' })
  await vi.waitFor(() => expect(f.queue.inspect().batches[0]?.error).toBe('source-changed'))
  expect(f.queue.diagnostics.lastFailure).toMatchObject({ stage: 'source-before-save', reason: 'digest-mismatch' })
  f.queue.dispose()
})

it('preserves source indices and digests through real ConversationStore append, switching and restart', async () => {
  const values = new Map<string, string>(), s = storage()
  const chatStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const chat = createLocalStorageConversationStore(chatStorage), session = chat.create()
  const complete = vi.fn(async () => ({ text: '{"reflections":[]}' }))
  const queue = createReflectionFormation({ storage: s.backend, getSessions: chat.list, getProvider: () => ({ id: 'mock', complete }) })
  await queue.setEnabled(true)
  session.messages.push({ role: 'user', content: '纸舟实验版。' }, { role: 'assistant', content: '收到。' })
  chat.save(session); await queue.delivered(session.id, [0, 1]); queue.dispose()
  session.title = 'Renamed'; session.updatedAt++
  session.messages.push({ role: 'user', content: '只追加新记录。' })
  chat.save(session); chat.create()
  const restarted = createReflectionFormation({ storage: s.backend, getSessions: createLocalStorageConversationStore(chatStorage).list,
    getProvider: () => ({ id: 'mock', complete }) })
  restarted.setDiagnosticsEnabled(true)
  await restarted.setEnabled(true)
  await vi.waitFor(() => expect(restarted.inspect().batches[0]?.status).toBe('completed'))
  expect(complete).toHaveBeenCalledTimes(1)
  expect(restarted.diagnostics.lastFailure).toBeUndefined()
  const removed = chat.create()
  removed.messages = [{ role: 'user', content: '稍后删除这个会话。' }, { role: 'assistant', content: '收到。' }]
  chat.save(removed)
  await restarted.delivered(removed.id, [0, 1])
  chat.delete(removed.id)
  await restarted.flush(removed.id)
  await vi.waitFor(() => expect(restarted.diagnostics.lastFailure).toMatchObject({ stage: 'source-before-request', reason: 'session-missing' }))
  expect(complete).toHaveBeenCalledTimes(1)
  restarted.dispose()
})
