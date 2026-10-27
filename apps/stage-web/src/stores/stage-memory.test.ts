import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createAutonomousStimulus, type ChatCompletionRequest } from '@aisling/core'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from '../../../../packages/core/src/context'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useStageStore } from './stage'
import { useSettingsStore } from './settings'
import { useSpeechStore } from './speech'
import { useEmotionStore } from './emotion'
import { sourceRef } from '../runtime/reflection-formation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(diagnostics = false) {
  const data = new Map<string, string>()
  const diagnosticRecords: Array<Record<string, unknown>> = []
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) } }, ...(diagnostics ? { aislingDesktop: {
      desktopDiagnostics: { enabled: true }, recordDesktopDiagnostic: (r: Record<string, unknown>) => diagnosticRecords.push(r),
    } } : {}) })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  const complete = vi.fn(async (_r: ChatCompletionRequest) => ({ text: '' }))
  settings.activeChatProvider = { id: 'mock', complete }
  vi.spyOn(useSpeechStore(), 'speak').mockResolvedValue(undefined)
  vi.spyOn(useEmotionStore(), 'judge').mockResolvedValue(undefined)
  const store = createLocalStorageConversationStore()
  const old = store.create()
  old.messages = [{ role: 'user', content: '纸舟旅行票根工具支持 PDF 导出。' }, { role: 'assistant', content: '纸舟导出已确认。' }]
  store.save(old)
  const stage = useStageStore(); stage.newConversation()
  const send = async () => { stage.send('纸舟旅行票根工具 PDF 导出如何？'); await vi.waitFor(() => expect(stage.sending).toBe(false)) }
  return { stage, store, old, complete, send, data, settings, diagnosticRecords }
}

it.each(['A', 'B', 'C'] as const)('manually selects Recall mode %s without saving settings, changing Formation or bypassing Memory OFF', async mode => {
  const { stage, settings, old, complete, send, data, diagnosticRecords } = await fixture(true)
  const ref = await sourceRef(old.id, 0, old.messages[0]!)
  const raw = JSON.stringify({ version: 1, progress: [], batches: [{ id: 'batch', sessionId: old.id,
    sourceRefs: [ref], units: 1, status: 'completed', attempts: 1, reflectionIds: ['reflection'] }], reflections: [
    { version: 1, id: 'reflection', content: '用户报告纸舟旅行票根工具支持 PDF 导出。', kind: 'project-state', basis: 'direct',
      tags: ['纸舟', 'PDF'], sourceRefs: [ref], relatedReflectionIds: [], createdAt: 1 },
  ] })
  const read = vi.fn(() => ({ ok: true, value: raw })), write = vi.fn(() => false)
  vi.stubGlobal('window', { ...window, aislingDesktop: { ...window.aislingDesktop, reflectionStorage: { read, write } } })
  const savedConfig = data.get('aisling.config.v1')
  expect(stage.memoryRecallMode).toBe('C')
  stage.setMemoryRecallMode(mode)
  expect(stage.memoryRecallMode).toBe(mode)
  await send()
  const request = JSON.stringify(complete.mock.calls.at(-1)![0])
  expect(request.includes('[Cross-session recall evidence]')).toBe(mode !== 'B')
  expect(request.includes('[Historical Aisling reflections]')).toBe(mode !== 'A')
  expect(diagnosticRecords.filter(r => r.type === 'context-assembled').at(-1)).toMatchObject({
    recallIncluded: mode !== 'B', reflectionCount: mode === 'A' ? 0 : 1, reflectionReason: mode === 'A' ? 'disabled' : 'injected',
  })
  expect(stage.memoryRecallDiagnostic === undefined).toBe(mode === 'B')
  expect(read).toHaveBeenCalledTimes(mode === 'A' ? 0 : 1)
  expect(write).not.toHaveBeenCalled()
  expect(stage.formationStatus.enabled).toBe(false)
  expect(data.get('aisling.config.v1')).toBe(savedConfig)
  expect(settings.config.memory.formationEnabled).toBe(false)
  await settings.setMemoryEnabled(false)
  read.mockClear()
  await send()
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toMatch(/Cross-session recall evidence|Historical Aisling reflections/)
  expect(read).not.toHaveBeenCalled()
  expect(stage.memoryRecallDiagnostic).toBeUndefined()
  expect(complete).toHaveBeenCalledTimes(2)
  stage.$dispose()
  expect(useStageStore().memoryRecallMode).toBe('C')
})

it('rejects invalid manual modes and changes during a turn without changing the captured mode', async () => {
  const { stage, complete } = await fixture()
  expect(() => stage.setMemoryRecallMode('invalid' as never)).toThrow('must be A, B or C')
  stage.setMemoryRecallMode('A')
  let finish!: (result: { text: string }) => void
  complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  stage.send('纸舟旅行票根工具 PDF 导出如何？')
  expect(() => stage.setMemoryRecallMode('B')).toThrow('Wait for the current turn')
  expect(stage.memoryRecallMode).toBe('A')
  finish({ text: 'ok' })
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  stage.setMemoryRecallMode('B')
  expect(stage.memoryRecallMode).toBe('B')
  stage.$dispose()
})

it('disables thinking for the current ordinary-chat route without changing saved settings or the shared provider', async () => {
  for (const diagnostics of [false, true]) {
    const { settings, complete, send, data } = await fixture(diagnostics)
    settings.config.consciousness = { ...settings.config.consciousness, model: 'qwen3.7-flash',
      baseUrl: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
    const saved = data.get('aisling.config.v1'), provider = settings.activeChatProvider
    await send()
    expect(complete.mock.calls.at(-1)![0].enableThinking).toBe(false)
    expect(settings.activeChatProvider).toBe(provider)
    expect(data.get('aisling.config.v1')).toBe(saved)
  }
})

it('uses the submission snapshot without another storage read for recall in all three switch combinations', async () => {
  const { stage, settings, complete, send, diagnosticRecords } = await fixture(true)
  let reflectionRaw: string | null = null
  vi.stubGlobal('window', { ...window, aislingDesktop: { ...window.aislingDesktop, reflectionStorage: {
    read: () => ({ ok: true, value: reflectionRaw }), write: (value: string) => { reflectionRaw = value; return true },
  } } })
  await settings.setMemoryEnabled(false); await send() // Give the session its title before counting reads.
  const readsAtProvider: number[] = []
  const read = vi.spyOn(window.localStorage, 'getItem')
  complete.mockImplementation(async () => { readsAtProvider.push(read.mock.calls.length); return { text: '' } })
  for (const [memory, reflection] of [[false, false], [true, false], [true, true]]) {
    await settings.setMemoryEnabled(memory!)
    await settings.setMemoryFormationEnabled(reflection!)
    if (reflection) await vi.waitFor(() => expect(stage.formationStatus.lastEvent).toBe('ready'))
    read.mockClear(); diagnosticRecords.length = 0
    await send()
    expect(stage.formationStatus.enabled).toBe(reflection)
    expect(JSON.stringify(complete.mock.calls.at(-1)![0]).includes('[Cross-session recall evidence]')).toBe(memory)
    expect(diagnosticRecords.filter(r => r.type === 'context-assembled')).toHaveLength(1)
    expect(diagnosticRecords.find(r => r.type === 'context-assembled')?.recallIncluded).toBe(memory)
  }
  expect(readsAtProvider[1]).toBe(readsAtProvider[0])
  expect(readsAtProvider[2]).toBe(readsAtProvider[0])
  expect(complete).toHaveBeenCalledTimes(4)
  stage.formation.dispose()
})

it('does not recall removed sessions when external storage no longer contains the active session', async () => {
  const { stage, data, complete, send } = await fixture()
  const removed = JSON.stringify({ sessions: [], activeId: null })
  data.set('aisling.conversations.v1', removed)
  await send()
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Cross-session recall evidence]')
  expect(stage.memoryRecallDiagnostic?.records).toBe(0)
  expect(data.get('aisling.conversations.v1')).toBe(removed)
})

it('reads another session only when enabled on user turns, stops on deletion and never saves evidence', async () => {
  const { stage, store, old, complete, send, data } = await fixture()
  expect(stage.memoryRecallEnabled).toBe(true)
  await useSettingsStore().setMemoryEnabled(false)
  await send(); const baseline = complete.mock.calls.at(-1)![0]
  expect(JSON.stringify(baseline)).not.toContain('[Cross-session recall evidence]')
  await useSettingsStore().setMemoryEnabled(true)
  await send()
  const request = complete.mock.calls.at(-1)![0]
  expect(JSON.stringify(request)).toContain(old.messages[0]!.content!)
  expect(JSON.stringify(request)).toContain('[Cross-session recall evidence]')
  expect(complete).toHaveBeenCalledTimes(2)
  expect(stage.activeSessionId).not.toBe(old.id)
  expect(stage.memoryRecallDiagnostic?.sessionIds).toEqual([old.id])
  const packed = request.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  expect(packed).not.toContain(old.id)
  expect(packed).not.toContain('Cite source session and message index')
  expect(packed).toContain('Never mention labels')
  expect(stage.memoryRecallDiagnostic?.sources[0]).toEqual({ label: 'E1', sessionId: old.id, messageIndex: 0, messageId: null })
  stage.sendStimulus(createAutonomousStimulus({ candidate: { id: 'c', objectId: 'o', source: 'foreground', change: 'appeared',
    snapshot: { capturedAt: 1, targetHwnd: '1', sequence: 1 }, target: { app: 'Browser', title: 'Now', text: 'Current page' } } }))
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toMatch(/Cross-session|纸舟旅行票根工具支持/)
  stage.deleteSession(old.id)
  await send(); expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Cross-session recall evidence]')
  expect(store.get(old.id)).toBeUndefined()
  expect(JSON.stringify([...data.values()])).not.toContain('Cross-session recall evidence')
  await useSettingsStore().setMemoryEnabled(false)
  expect(stage.memoryRecallDiagnostic).toBeUndefined()
})

it('excludes the active session and fails back on low relevance or read errors without extra calls', async () => {
  const { stage, old, complete, store } = await fixture()
  await useSettingsStore().setMemoryEnabled(true)
  stage.switchSession(old.id)
  stage.send('纸舟旅行票根 PDF'); await vi.waitFor(() => expect(stage.sending).toBe(false))
  const request = JSON.stringify(complete.mock.calls.at(-1)![0])
  expect(request).not.toContain('Cross-session recall evidence')
  stage.newConversation()
  stage.send('totally unrelated zebras'); await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('Cross-session recall evidence')
  const original = JSON.stringify(store.get(old.id))
  complete.mockRejectedValueOnce(new Error('offline'))
  stage.send('纸舟旅行票根 PDF'); await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(store.get(old.id))).toBe(original)
  expect(store.get(stage.activeSessionId)!.messages.every(m => m.role === 'user')).toBe(true)
  expect(complete).toHaveBeenCalledTimes(3)
  vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('read failed') })
  stage.send('纸舟旅行票根 PDF'); await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('Cross-session recall evidence')
})

it('recalls delivered self-speech separately from user reports and never recalls cancelled or failed generations', async () => {
  const { stage, store, complete } = await fixture()
  await useSettingsStore().setMemoryEnabled(true)
  const subject = '萤桥发布'
  complete.mockResolvedValueOnce({ text: `${subject}：我猜可能已经稳定。` })
  stage.send(`${subject}：我说你已经替我发布了，但这只是我的描述。`)
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const autonomous = (text: string) => createAutonomousStimulus({ candidate: { id: 'private-candidate', objectId: 'private-object',
    source: 'foreground', change: 'appeared', snapshot: { capturedAt: 1000, targetHwnd: '1', sequence: 1 },
    target: { app: 'Browser', title: subject, text } } })
  complete.mockResolvedValueOnce({ text: `${subject}：窗口里的只是旧照片吗？` })
  stage.sendStimulus(autonomous('a release photograph'))
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  let finish!: (result: { text: string }) => void
  complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  stage.sendStimulus(autonomous('another photograph'))
  stage.send('/quiet')
  finish({ text: `${subject}：未交付的秘密想法。` })
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  complete.mockRejectedValueOnce(new Error('generation failed'))
  stage.send(`${subject}：这个请求会失败。`)
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const saved = store.get(stage.activeSessionId)!.messages
  expect(saved.filter(m => m.role === 'assistant').map(m => m.content)).toEqual([
    `${subject}：我猜可能已经稳定。`, `${subject}：窗口里的只是旧照片吗？`, '我先不主动说话，你找我时我照常回答。',
  ])
  stage.newConversation()
  stage.send(`${subject}：你以前说过什么，真的替我做过什么？`)
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const packed = complete.mock.calls.at(-1)![0].messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  expect(packed).toContain('stored-user-report')
  expect(packed).toContain('stored-assistant-utterance')
  expect(packed).toContain('stored-autonomous-utterance')
  expect(packed).toContain('我猜可能已经稳定')
  expect(packed).toContain('窗口里的只是旧照片吗')
  expect(packed).toContain('1970-01-01T00:00:01.000Z')
  expect(packed).not.toMatch(/未交付的秘密想法|private-candidate|private-object|generation failed/)
  expect(complete).toHaveBeenCalledTimes(5)
})

it('anchors an enabled vague follow-up in the real Stage path and keeps disabled requests isolated and bounded', async () => {
  const { stage, store, complete } = await fixture()
  const story = store.create()
  story.messages = [{ role: 'user', content: '我们以前聊过《灌篮高手》。' },
    { role: 'assistant', content: '我编过“流川枫邻居”的笑话，那是我瞎编的。' }]
  store.save(story)
  stage.newConversation()
  await useSettingsStore().setMemoryEnabled(true)
  complete.mockResolvedValueOnce({ text: '我猜刚才的话题其实是电池和歌曲。' })
  stage.send('我们以前聊过《灌篮高手》吗？你当时怎么评价的？')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  stage.send('还记得有什么吗')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const request = complete.mock.calls.at(-1)![0]
  const packed = request.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))!.content!
  expect(stage.memoryRecallDiagnostic?.sessionIds[0]).toBe(story.id)
  expect(packed).toContain(story.messages[1]!.content!)
  expect(packed).not.toContain(story.id)
  expect(request.messages.at(-1)!.content).toBe('还记得有什么吗')
  await useSettingsStore().setMemoryEnabled(false)
  stage.send('还有呢？')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(stage.memoryRecallDiagnostic).toBeUndefined()
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Cross-session recall evidence]')
  expect(complete).toHaveBeenCalledTimes(3)
  for (const [input] of complete.mock.calls) {
    expect(input.messages.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(INPUT_TOKEN_LIMIT)
    const block = input.messages.find(m => m.content?.startsWith('[Cross-session recall evidence]'))?.content
    if (block) expect(new TextEncoder().encode(block.slice(block.lastIndexOf('\n') + 1)).length).toBeLessThanOrEqual(6000)
  }
})

it('forms only delivered interactions asynchronously in an independent store without waiting in chat', async () => {
  const { stage, settings, complete } = await fixture()
  let raw: string | null = null
  vi.stubGlobal('window', { ...window, aislingDesktop: { reflectionStorage: {
    read: () => ({ ok: true, value: raw }), write: (value: string) => { raw = value; return true },
  } } })
  expect(stage.formationStatus.enabled).toBe(false)
  expect(raw).toBeNull()
  let finish!: (result: { text: string }) => void
  let finishCancelled!: (result: { text: string }) => void
  let deferAutonomous = false
  let normalFailure = false
  complete.mockImplementation(request => {
    if (request.messages[0]?.content?.startsWith('You form append-only'))
      return new Promise(resolve => { finish = resolve })
    if (deferAutonomous) return new Promise(resolve => { finishCancelled = resolve })
    return normalFailure ? Promise.reject(new Error('failed chat')) : Promise.resolve({ text: '这是实际交付的回应。' })
  })
  await settings.setMemoryFormationEnabled(true)
  await vi.waitFor(() => expect(stage.formationStatus.lastEvent).toBe('ready'))
  deferAutonomous = true
  stage.sendStimulus(createAutonomousStimulus({ candidate: { id: 'cancelled', objectId: 'cancelled-object', source: 'foreground',
    change: 'appeared', snapshot: { capturedAt: 1, targetHwnd: '1', sequence: 1 }, target: { app: 'Mock', title: '纸舟', text: 'Old photograph.' } } }))
  stage.send('/quiet')
  finishCancelled({ text: '未交付，不应形成 Reflection。' }); deferAutonomous = false
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(stage.formation.inspect().batches).toEqual([])
  for (const text of ['纸舟实验版已发布。', '纸舟还有识别问题。', '纸舟识别问题修复了。']) {
    stage.send(text)
    await vi.waitFor(() => expect(stage.sending).toBe(false))
  }
  await vi.waitFor(() => expect(stage.formationStatus.running).toBe(true))
  expect(stage.sending).toBe(false)
  expect(stage.memoryRecallEnabled).toBe(true)
  expect(stage.formation.inspect().batches[0]!.sourceRefs).toHaveLength(6)
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain(stage.activeSessionId)
  finish({ text: '{"reflections":[{"content":"用户报告纸舟实验版已发布。","kind":"project-state","basis":"direct","tags":["纸舟"],"sources":["E1"],"related":[]}]}' })
  await vi.waitFor(() => expect(stage.formation.inspect().reflections).toHaveLength(1))
  expect(stage.formation.inspect().reflections[0]!.sourceRefs[0]!.sessionId).toBe(stage.activeSessionId)
  normalFailure = true
  stage.send('这个请求不会得到交付回复。')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  await stage.formation.flush()
  expect(stage.formation.inspect().batches).toHaveLength(1)
  await settings.setMemoryFormationEnabled(false)
  stage.formation.dispose()
})

it('stops both Memory paths and discards in-flight Formation without deleting saved reflections or pending work', async () => {
  const { stage, settings, complete } = await fixture()
  let raw: string | null = null
  vi.stubGlobal('window', { ...window, aislingDesktop: { reflectionStorage: {
    read: () => ({ ok: true, value: raw }), write: (value: string) => { raw = value; return true },
  } } })
  let finish!: (result: { text: string }) => void
  let signal: AbortSignal | undefined
  let formationCalls = 0
  complete.mockImplementation(request => {
    if (request.messages[0]?.content?.startsWith('You form append-only')) {
      formationCalls++; signal = request.signal
      return new Promise(resolve => { finish = resolve })
    }
    return Promise.resolve({ text: '这是实际交付的回应。' })
  })
  await settings.setMemoryFormationEnabled(true)
  await vi.waitFor(() => expect(stage.formationStatus.lastEvent).toBe('ready'))
  const output = { text: '{"reflections":[{"content":"用户报告纸舟实验版已发布。","kind":"project-state","basis":"direct","tags":["纸舟"],"sources":["E1"],"related":[]}]}' }
  for (let n = 0; n < 2; n++) {
    stage.send('纸舟实验版已发布。')
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    await stage.formation.flush()
    await vi.waitFor(() => expect(formationCalls).toBe(n + 1))
    if (n === 0) {
      finish(output)
      await vi.waitFor(() => expect(stage.formation.inspect().reflections).toHaveLength(1))
    }
  }
  const saved = stage.formation.inspect()
  await settings.setMemoryEnabled(false)
  expect(stage.memoryRecallEnabled).toBe(false)
  expect(stage.formationStatus.enabled).toBe(false)
  expect(signal?.aborted).toBe(true)
  finish(output)
  await vi.waitFor(() => expect(stage.formationStatus.running).toBe(false))
  expect(stage.formation.inspect()).toEqual(saved)
  expect(settings.config.memory).toEqual({ enabled: false, formationEnabled: false })
  await settings.setMemoryEnabled(true)
  expect(stage.formationStatus.enabled).toBe(false)
  settings.config.memory.formationEnabled = true
  await settings.setMemoryEnabled(false)
  // Even a stale developer flag cannot bypass the runtime's master gate.
  settings.config.memory.formationEnabled = true
  await stage.formation.flush()
  expect(stage.formationStatus.enabled).toBe(false)
  expect(formationCalls).toBe(2)
  stage.formation.dispose()
})

it('reads newly committed Reflection on later text turns with Formation off, never changing an in-flight turn', async () => {
  const { stage, settings, complete, diagnosticRecords } = await fixture(true)
  let raw: string | null = null
  vi.stubGlobal('window', { ...window, aislingDesktop: { ...window.aislingDesktop, reflectionStorage: {
    read: () => ({ ok: true, value: raw }), write: (value: string) => { raw = value; return true },
  } } })
  let finishFormation!: (result: { text: string }) => void
  let finishChat: ((result: { text: string }) => void) | undefined
  let holdChat = false, formationCalls = 0
  complete.mockImplementation(input => {
    if (input.messages[0]?.content?.startsWith('You form append-only')) {
      formationCalls++
      return new Promise(resolve => { finishFormation = resolve })
    }
    if (holdChat) return new Promise(resolve => { finishChat = resolve })
    return Promise.resolve({ text: '收到当前更新。' })
  })
  await settings.setMemoryFormationEnabled(true)
  await vi.waitFor(() => expect(stage.formationStatus.lastEvent).toBe('ready'))
  stage.send('纸舟旅行票根工具支持 PDF 导出。')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const sourceId = stage.activeSessionId
  await stage.formation.flush()
  await vi.waitFor(() => expect(formationCalls).toBe(1))
  stage.newConversation(); holdChat = true
  stage.send('纸舟旅行票根工具 PDF 导出如何？')
  await vi.waitFor(() => expect(finishChat).toBeTypeOf('function'))
  const inFlight = complete.mock.calls.at(-1)![0]
  expect(JSON.stringify(inFlight)).not.toContain('[Historical Aisling reflections]')
  finishFormation({ text: JSON.stringify({ reflections: [{ content: '用户报告纸舟旅行票根工具支持 PDF 导出。',
    kind: 'project-state', basis: 'direct', tags: ['纸舟', 'PDF'], sources: ['E1'], related: [] }] }) })
  await vi.waitFor(() => expect(stage.formation.inspect().reflections).toHaveLength(1))
  expect(JSON.stringify(inFlight)).not.toContain('[Historical Aisling reflections]')
  holdChat = false; finishChat!({ text: '当前轮保持原快照。' })
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  await settings.setMemoryFormationEnabled(false)
  const saved = raw
  stage.send('纸舟旅行票根工具 PDF 导出现在已经取消。')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  const request = complete.mock.calls.at(-1)![0]
  expect(JSON.stringify(request)).toContain('[Historical Aisling reflections]')
  expect(JSON.stringify(request)).toContain('[Cross-session recall evidence]')
  expect(request.messages.at(-1)!.content).toContain('现在已经取消')
  expect(JSON.stringify(request)).not.toContain(sourceId)
  expect(diagnosticRecords.filter(r => r.type === 'context-assembled').at(-1)).toMatchObject({ reflectionCount: 1,
    reflectionChars: expect.any(Number), reflectionTokens: expect.any(Number), reflectionRetrievalMs: expect.any(Number), reflectionReason: 'injected' })
  expect(raw).toBe(saved)
  await settings.setMemoryEnabled(false)
  stage.send('纸舟旅行票根工具 PDF 导出如何？')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toMatch(/Historical Aisling reflections|Cross-session recall evidence/)
  await settings.setMemoryEnabled(true)
  stage.deleteSession(sourceId)
  stage.send('纸舟旅行票根工具 PDF 导出如何？')
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Historical Aisling reflections]')
  expect(diagnosticRecords.filter(r => r.type === 'context-assembled').at(-1)?.reflectionReason).toBe('invalid-source')
  expect(raw).toBe(saved)
  expect(formationCalls).toBe(1)
  expect(complete).toHaveBeenCalledTimes(6)
  stage.formation.dispose()
})
