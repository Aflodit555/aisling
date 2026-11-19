import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createAutonomousStimulus, type ChatCompletionRequest } from '@aisling/core'
import { estimateMessageTokens, INPUT_TOKEN_LIMIT } from '../../../../packages/core/src/context'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useStageStore } from './stage'
import { useSettingsStore } from './settings'
import { useSpeechStore } from './speech'
import { useEmotionStore } from './emotion'
import { sourceRef } from '../runtime/formation-evidence'
import type { NoteV2RecallBridge } from '../runtime/note-v2-recall'
import type { NoteFormationBridge } from '../runtime/note-formation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture({ diagnostics = false, snapshot, formationBridge }: {
  diagnostics?: boolean; snapshot?: NoteV2RecallBridge['snapshot']; formationBridge?: NoteFormationBridge;
} = {}) {
  const data = new Map<string, string>()
  const diagnosticRecords: Array<Record<string, unknown>> = []
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) } }, aislingDesktop: {
      ...(diagnostics && { desktopDiagnostics: { enabled: true },
        recordDesktopDiagnostic: (r: Record<string, unknown>) => diagnosticRecords.push(r) }),
      ...(snapshot && { noteRecall: { snapshot, current: async () => true } }),
      ...(formationBridge && { noteFormation: formationBridge }),
    } })
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

it('forwards only delivered interactions to current Note Formation and keeps Memory off effective', async () => {
  const bridge: NoteFormationBridge = { delivered: vi.fn(async () => {}), flush: vi.fn(async () => {}), next: vi.fn(async () => null),
    prepare: vi.fn(async () => { throw Error('No synthetic work was claimed') }), submit: vi.fn(async () => {}), fail: vi.fn(async () => {}) }
  const { stage, settings, send, complete } = await fixture({ formationBridge: bridge })
  complete.mockResolvedValue({ text: 'Synthetic delivered reply.' })
  try {
    await send(); expect(bridge.delivered).not.toHaveBeenCalled()
    await settings.setMemoryFormationEnabled(true); await send()
    await vi.waitFor(() => expect(bridge.delivered).toHaveBeenCalledWith(stage.activeSessionId, [2, 3]))
    await settings.setMemoryEnabled(false); vi.mocked(bridge.delivered).mockClear(); await send()
    expect(bridge.delivered).not.toHaveBeenCalled()
    await settings.setMemoryEnabled(true); await settings.setMemoryFormationEnabled(true)
    complete.mockRejectedValueOnce(Error('Synthetic failed response')); await send()
    expect(bridge.delivered).not.toHaveBeenCalled()
    expect(bridge.submit).not.toHaveBeenCalled()
  } finally { stage.$dispose() }
})

it('combines current Note v2 with Raw, rejecting stale sources and preserving Raw on Note timeouts', async () => {
 const snapshot=vi.fn<NoteV2RecallBridge['snapshot']>()
 const {stage,old,complete,settings,send}=await fixture({snapshot})
 const evidence=await sourceRef(old.id,0,old.messages[0]!)
 const note={id:'semantic-note',version:1,createdAt:1,updatedAt:1,status:'active',kind:'fact',basis:'direct',subject:'profile-user',eventTime:null,content:'纸舟工具的票根导出格式是 PDF。'} as const
 snapshot.mockResolvedValue({reason:'ready',version:'v1',notes:[{note,grounds:{evidence:[evidence]}},
  {note:{...note,id:'stale',content:'纸舟票根 PDF 过期候选'},grounds:{evidence:[{...evidence,digest:'a'.repeat(64)}]}}]})
 const request=()=>JSON.stringify(complete.mock.calls.at(-1)![0])
 await send();expect(snapshot).not.toHaveBeenCalled();expect(request()).toContain('[Cross-session recall evidence]')
 stage.newConversation();await settings.setNoteRecallEnabled(true);await send()
 expect(request()).toContain(note.content);expect(request()).not.toContain('过期候选');expect(request()).toContain('[Cross-session recall evidence]')
 snapshot.mockImplementation(()=>new Promise(()=>{}));await send()
 expect(request()).not.toContain(note.content);expect(request()).toContain('[Cross-session recall evidence]')
 stage.deleteSession(old.id);await send();expect(request()).not.toContain(old.messages[0]!.content!)
 stage.$dispose()
})

it('ignores an obsolete Reflection bridge and keeps Memory off independent from Formation', async () => {
 const {stage,settings,complete,send}=await fixture({diagnostics:true})
 const read=vi.fn(()=>({ok:true,value:'NEVER-INJECT-ARCHIVED-REFLECTION'})),write=vi.fn()
 vi.stubGlobal('window',{...window,aislingDesktop:{...window.aislingDesktop,reflectionStorage:{read,write}}})
 await send();expect(JSON.stringify(complete.mock.calls.at(-1)![0])).toContain('[Cross-session recall evidence]')
 expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('NEVER-INJECT-ARCHIVED-REFLECTION')
 await settings.setMemoryEnabled(false);await send()
 expect(JSON.stringify(complete.mock.calls.at(-1)![0])).not.toContain('[Cross-session recall evidence]')
 expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(settings.config.memory.formationEnabled).toBe(false)
 stage.$dispose()
})

it('disables thinking for the current ordinary-chat route without changing saved settings or the shared provider', async () => {
  for (const diagnostics of [false, true]) {
    const { settings, complete, send, data } = await fixture({ diagnostics })
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
  const { stage, settings, complete, send, diagnosticRecords } = await fixture({ diagnostics: true })
  await settings.setMemoryEnabled(false); await send() // Give the session its title before counting reads.
  const readsAtProvider: number[] = []
  const read = vi.spyOn(window.localStorage, 'getItem')
  complete.mockImplementation(async () => { readsAtProvider.push(read.mock.calls.length); return { text: '' } })
  for (const [memory, reflection] of [[false, false], [true, false], [true, true]]) {
    await settings.setMemoryEnabled(memory!)
    await settings.setMemoryFormationEnabled(reflection!)
    read.mockClear(); diagnosticRecords.length = 0
    await send()
    expect(settings.config.memory.formationEnabled).toBe(reflection)
    expect(JSON.stringify(complete.mock.calls.at(-1)![0]).includes('[Cross-session recall evidence]')).toBe(memory)
    expect(diagnosticRecords.filter(r => r.type === 'context-assembled')).toHaveLength(1)
    expect(diagnosticRecords.find(r => r.type === 'context-assembled')?.recallIncluded).toBe(memory)
  }
  expect(readsAtProvider[1]).toBe(readsAtProvider[0])
  expect(readsAtProvider[2]).toBe(readsAtProvider[0])
  expect(complete).toHaveBeenCalledTimes(4)
  stage.$dispose()
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
