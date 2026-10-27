import { describe, expect, it, vi } from 'vitest'
import { assembleContext, createAutonomousContext, estimateMessageTokens, estimateTokens,
  HISTORY_TOKEN_BUDGET, INPUT_TOKEN_LIMIT, normalizeAutonomousContext, type ConversationMessage } from './context'
import { createCharacter } from './character'
import { createCharacterRuntime, type ChatRuntimeDiagnostic } from './runtime'
import { createAutonomousStimulus, createUserTextStimulus, createVisualStimulus, type DesktopCandidate } from './stimulus'
import type { ChatCompletionRequest, ChatMessage } from './provider'

const candidate: DesktopCandidate = { id: 'candidate-a', objectId: 'object-a', source: 'media', change: 'track-changed',
  snapshot: { capturedAt: 1000, targetHwnd: '123', sequence: 1 }, target: { app: 'player', title: 'Song A', artist: 'Artist B' } }
const pair = (text: string): ChatMessage[] => [{ role: 'user', content: text }, { role: 'assistant', content: `reply ${text}` }]
const assemble = (history: ConversationMessage[], historyTokenBudget = HISTORY_TOKEN_BUDGET) => assembleContext({
  prefix: [{ role: 'system', content: 'persona' }], suffix: [{ role: 'user', content: 'current question' }], history, historyTokenBudget })

describe('bounded conversation context', () => {
  it('keeps timestamped messages in source order without sending persistence fields to providers', () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '我计划购买手碟。', createdAt: 2000 },
      { role: 'assistant', content: '明白。', createdAt: 2000 },
      { role: 'user', content: '现在已经购买了。', createdAt: 1000 },
      { role: 'assistant', content: '收到。', createdAt: 3000 },
    ]
    const baseline = assemble(history.map(({ createdAt: _time, ...message }) => message))
    expect(assemble(history)).toEqual(baseline)
    expect(history.map(m => m.createdAt)).toEqual([2000, 2000, 1000, 3000])
  })
  it.each([
    { kind: 'Chinese', text: '中文', bytes: 6 },
    { kind: 'English', text: 'Hello world', bytes: 11 },
    { kind: 'mixed', text: '中文 Hi 42🙂', bytes: 16 },
    { kind: 'digits and ASCII punctuation', text: '12345,6789!?', bytes: 12 },
    { kind: 'Chinese punctuation', text: '，。！？', bytes: 12 },
    { kind: 'whitespace', text: ' \t\r\n', bytes: 4 },
    { kind: 'emoji with joiners', text: '👨‍👩‍👧‍👦', bytes: 25 },
    { kind: 'supplementary Han and combining marks', text: '𠀀e\u0301', bytes: 7 },
  ])('checks explicit $kind byte weights without claiming provider tokenizer accuracy', ({ text, bytes }) => {
    expect(estimateTokens(text)).toBe(bytes)
    expect(estimateTokens(text)).toBe(new TextEncoder().encode(text).length)
  })

  it('counts full structured content and preserves a message exactly at the input boundary', () => {
    const json = JSON.stringify({ evidence: ['中文，标点🙂', 'English 42\n\t'], object: { title: '当前对象' } })
    const selected = assemble([{ role: 'assistant', content: json }])
    expect(selected.historyTokens).toBe(8 + new TextEncoder().encode(json).length)
    expect(selected.messages[1]?.content).toBe(json)
    const current: ChatMessage = { role: 'user', content: '中'.repeat(Math.floor((INPUT_TOKEN_LIMIT - 8) / 3)) }
    const result = assembleContext({ prefix: [], suffix: [current], history: pair('history') })
    expect(result.messages).toEqual([current])
    expect(result.requiredTokens).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    expect(() => assembleContext({ prefix: [], suffix: [{ ...current, content: current.content + '中' }], history: [] }))
      .toThrow('nothing was truncated')
  })

  it('keeps a short session and more than forty small messages in chronological order', () => {
    const history = Array.from({ length: 30 }, (_, i) => pair(`${i}`)).flat()
    const selected = assemble(history)
    expect(selected.messages.slice(1, -1)).toEqual(history)
    expect(selected).toMatchObject({ selectedMessages: 60, omittedMessages: 0, basisCount: 0 })
    expect(selected.historyTokens).toBeLessThan(HISTORY_TOKEN_BUDGET)
  })

  it('evicts only complete oldest turns when over budget and includes a recent referenced detail', () => {
    const old = pair('old '.repeat(400)), recent = pair('约定：周五看电影')
    const budget = recent.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
    const history = [...old, ...recent]
    expect(assemble(history, budget).messages.slice(1, -1)).toEqual(recent)
    expect(assemble(history, budget)).toMatchObject({ historyTokens: budget, omittedMessages: 2 })
    expect(history).toHaveLength(4)
    expect(assemble(history, budget - 1)).toMatchObject({ selectedMessages: 0, omittedMessages: 4 })
  })

  it.each(['ASCII\nwith punctuation! <>', '中文 English 混合', '🙂e\u0301\u200d🚀\u0000\ud800'])('estimates UTF-8 bytes conservatively for %s', (text) => {
    expect(estimateTokens(text)).toBe(new TextEncoder().encode(text).length)
    const history = [...pair('older'), ...pair(text)]
    const budget = pair(text).reduce((sum, message) => sum + estimateMessageTokens(message), 0)
    expect(assemble(history, budget).messages.slice(1, -1)).toEqual(pair(text))
  })

  it('keeps tool call references atomic and rejects a dangling result', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'lookup' },
      { role: 'assistant', content: null, toolCalls: [{ id: 'call', name: 'lookup', arguments: '{}' }] },
      { role: 'tool', content: 'found', toolCallId: 'call' }, { role: 'assistant', content: 'answer' }]
    const cost = history.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
    expect(assemble(history, cost).messages.slice(1, -1)).toEqual(history)
    expect(assemble(history, cost - 1).selectedMessages).toBe(0)
    expect(assemble(history.slice(2)).selectedMessages).toBe(0)
  })

  it('reserves persona/current input/evidence/tools before history without truncating them', () => {
    const prefix: ChatMessage[] = [{ role: 'system', content: 'persona '.repeat(500) }]
    const suffix: ChatMessage[] = [{ role: 'system', content: 'structured evidence '.repeat(200) },
      { role: 'user', content: 'current question '.repeat(200) }]
    const result = assembleContext({ prefix, suffix, history: Array.from({ length: 50 }, () => pair('history')).flat(), toolTokens: 1000 })
    expect(result.requiredTokens + result.historyTokens).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    expect(result.messages[0]).toEqual(prefix[0]); expect(result.messages.slice(-2)).toEqual(suffix)
  })

  it('injects bounded historical basis next to delivered speech with distinct ISO times, never metadata fields', () => {
    const history: ConversationMessage[] = [{ role: 'assistant', content: '这首歌有些忧伤。',
      autonomousContext: createAutonomousContext(candidate, 2500) }]
    const result = assemble(history)
    expect(result.basisCount).toBe(1)
    expect(result.messages[1]!.content).toContain('1970-01-01T00:00:01.000Z')
    expect(result.messages[1]!.content).toContain('1970-01-01T00:00:02.500Z')
    expect(result.messages[1]!.content).toContain('Song A')
    expect(result.messages[2]).toEqual({ role: 'assistant', content: '这首歌有些忧伤。' })
    expect(result.messages.every(message => !('autonomousContext' in message))).toBe(true)
    const budget = result.historyTokens - 1
    expect(assemble(history, budget).basisCount).toBe(0)
    expect(assemble(history, budget).selectedMessages).toBe(0)
  })

  it('redacts and bounds observation fields, discards raw attachments and accepts missing observation time', () => {
    const context = createAutonomousContext({ ...candidate, source: 'foreground', target: { app: 'browser', title: 'Paper',
      text: 'Contact foo@example.com https://private.test?q=value 13812345678. /home/alice/note.txt '.repeat(1000) } }, 3000)!
    expect(context.excerpt!.length).toBeLessThanOrEqual(240)
    expect(JSON.stringify(context)).not.toMatch(/foo@example|private.test|13812345678|alice|targetHwnd|sequence/)
    expect(createAutonomousContext({ ...candidate, target: { ...candidate.target, title: 'C:\\Users\\Alice\\note.txt' } }, 3000)?.title).toBe('[redacted]')
    expect(normalizeAutonomousContext({ ...context, observedAt: NaN, rawSnapshot: 'sensitive', title: 'password: abc' }))
      .toEqual({ ...context, observedAt: undefined, title: '[redacted]' })
    expect(normalizeAutonomousContext({ ...context, deliveredAt: Infinity })).toBeUndefined()
  })

  it.each(['user', 'visual', 'autonomous', 'persona', 'tools'] as const)('fails oversized %s explicitly before any provider call', async (kind) => {
    const complete = vi.fn(async () => ({ text: 'unused' }))
    const large = '超'.repeat(INPUT_TOKEN_LIMIT)
    const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: kind === 'persona' ? large : 'p', capabilities: [] }),
      getChatProvider: () => ({ id: 'mock', complete }),
      getTools: () => kind === 'tools' ? [{ name: 'large', description: large, parameters: {}, run: async () => '' }] : [] })
    const stimulus = kind === 'autonomous' ? createAutonomousStimulus({ candidate: { ...candidate, target: { ...candidate.target, title: large } } })
      : kind === 'visual' ? createVisualStimulus({ source: 'web', observation: large, caption: 'look' })
        : createUserTextStimulus({ source: 'web', text: kind === 'user' ? large : 'hello' })
    const turn = await runtime.ingest(stimulus)
    expect(turn.status).toBe('failed'); expect(turn.error).toContain('nothing was truncated')
    expect(complete).not.toHaveBeenCalled(); expect(runtime.history).toEqual([])
  })

  it('reselects history as tool evidence grows and fails safely when evidence alone is oversized', async () => {
    const requests: ChatCompletionRequest[] = []
    const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
      history: pair('history '.repeat(200)),
      getTools: () => [{ name: 'lookup', description: 'lookup', parameters: {}, run: async () => 'result '.repeat(1800) }],
      getChatProvider: () => ({ id: 'mock', complete: async request => {
        requests.push(request)
        return requests.length === 1 ? { text: '', toolCalls: [{ id: 'c', name: 'lookup', arguments: '{}' }] } : { text: 'done' }
      } }) })
    expect((await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'lookup' }))).status).toBe('completed')
    expect(requests[0]!.messages).toContainEqual(runtime.history[0])
    expect(requests[1]!.messages).not.toContainEqual(runtime.history[0])
    expect(requests[1]!.messages.find(message => message.role === 'tool')?.content).toBe('result '.repeat(1800))
    const complete = vi.fn(async () => ({ text: '', toolCalls: [{ id: 'c', name: 'lookup', arguments: '{}' }] }))
    const huge = createCharacterRuntime({ character: runtime.character, getChatProvider: () => ({ id: 'mock', complete }),
      getTools: () => [{ name: 'lookup', description: 'lookup', parameters: {}, run: async () => 'x'.repeat(INPUT_TOKEN_LIMIT) }] })
    expect((await huge.ingest(createUserTextStimulus({ source: 'web', text: 'lookup' }))).error).toContain('nothing was truncated')
    expect(complete).toHaveBeenCalledOnce(); expect(huge.history).toEqual([])
  })

  it('reports context selection and P2 request duration without content', async () => {
    const records: ChatRuntimeDiagnostic[] = []
    let time = 1000
    const runtime = createCharacterRuntime({ character: createCharacter({ id: 'a', name: 'A', persona: '', capabilities: [] }),
      history: [{ role: 'assistant', content: 'Private speech', autonomousContext: createAutonomousContext(candidate, 1500) }],
      now: () => time, diagnostic: record => records.push(record),
      getChatProvider: () => ({ id: 'mock', complete: async () => ({ text: 'unused' }), stream: async (_request, onText) => {
        time += 30; onText(''); time += 20; onText('Private answer'); time += 100; return { text: 'Private answer' }
      } }) })
    await runtime.ingest(createUserTextStimulus({ source: 'web', text: 'Private follow-up' }))
    expect(records.find(record => record.type === 'context-assembled')).toMatchObject({ selectedMessages: 1, basisCount: 1, omittedMessages: 0 })
    expect(records.find(record => record.type === 'p2-b-request-end')?.durationMs).toBe(150)
    expect(JSON.stringify(records)).not.toMatch(/Private|Song A|Artist B/)
  })
})
