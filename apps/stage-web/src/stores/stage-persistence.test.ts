import { createPinia, setActivePinia } from 'pinia'
import { createVisualStimulus, type ChatCompletionRequest } from '@aisling/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  const values = new Map<string, string>()
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } }
  vi.stubGlobal('window', { localStorage: backend })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  const complete = vi.fn(async () => ({ text: 'Final reply' }))
  settings.activeChatProvider = { id: 'mock', complete }
  return { backend, settings, complete }
}

describe('Stage history under storage failure', () => {
  it.each(['text', 'visual'])('records %s input at append and final output at delivery, preserving short-term order', async kind => {
    const { backend, settings } = await fixture()
    let now = 1000, finish!: (result: { text: string }) => void
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const requests: ChatCompletionRequest[] = []
    settings.activeChatProvider = { id: 'deferred', complete: async request => {
      requests.push(request); return new Promise(resolve => { finish = resolve })
    } }
    const stage = useStageStore(), store = createLocalStorageConversationStore(backend)
    if (kind === 'text') stage.send('手碟还没购买，我计划购买手碟。')
    else stage.sendStimulus(createVisualStimulus({ source: 'test', caption: '手碟旧照片', observation: 'a handpan' }))
    const input = store.get(stage.activeSessionId)!.messages[0]!
    expect(input.createdAt).toBe(1000)
    expect(store.get(stage.activeSessionId)!.messages).toHaveLength(1)
    now = 2500; finish({ text: '收到。' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(store.get(stage.activeSessionId)!.messages.map(m => m.createdAt)).toEqual([1000, 2500])
    now = 3000; stage.send('现在手碟已经购买了。')
    expect(requests[1]!.messages.filter(m => m.role === 'user' || m.role === 'assistant')).toEqual([
      { role: 'user', content: input.content }, { role: 'assistant', content: '收到。' },
      { role: 'user', content: '现在手碟已经购买了。' },
    ])
    expect(JSON.stringify(requests)).not.toContain('createdAt')
    now = 4000; finish({ text: '知道了。' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    const saved = store.get(stage.activeSessionId)!.messages
    expect(saved.map(m => m.createdAt)).toEqual([1000, 2500, 3000, 4000])
    expect(saved).toEqual(stage.runtime.history)
    expect(createLocalStorageConversationStore(backend).get(stage.activeSessionId)!.messages).toEqual(saved)
    stage.$dispose()
  })

  it('timestamps locally acknowledged user commands and replies without a provider call', async () => {
    const { backend, complete } = await fixture()
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const stage = useStageStore(); stage.send('/quiet')
    const saved = createLocalStorageConversationStore(backend).get(stage.activeSessionId)!.messages
    expect(saved.map(m => m.createdAt)).toEqual([1234, 1234])
    expect(saved.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(complete).not.toHaveBeenCalled()
    stage.$dispose()
  })

  it('keeps a migrated legacy session addressable and appends the next delivered reply once', async () => {
    const { backend } = await fixture()
    const old = [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier reply' }]
    backend.setItem('aisling.conversation.v1', JSON.stringify(old))
    const stage = useStageStore()
    expect(stage.runtime.history).toEqual(old)
    stage.send('Next question'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    const store = createLocalStorageConversationStore(backend)
    expect(store.list()).toHaveLength(1)
    expect(store.get(stage.activeSessionId)?.messages).toEqual([...old,
      { role: 'user', content: 'Next question', createdAt: expect.any(Number) }, { role: 'assistant', content: 'Final reply', createdAt: expect.any(Number) }])
  })
  it('keeps replies, later sends and unsaved session switches working, reports failure and recovers all history', async () => {
    const { backend, complete } = await fixture()
    const stage = useStageStore(), originalId = stage.activeSessionId
    const durable = backend.getItem('aisling.conversations.v1')
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    stage.send('first unsaved question')
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stage.messages.some(message => message.role === 'error' && /saved|storage/i.test(message.content))).toBe(true)
    expect(stage.messages.filter(message => message.role === 'assistant')).toHaveLength(1)
    stage.newConversation(); const unsavedId = stage.activeSessionId
    stage.send('second session question'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    stage.switchSession(originalId)
    expect(stage.runtime.history).toEqual([{ role: 'user', content: 'first unsaved question', createdAt: expect.any(Number) }, { role: 'assistant', content: 'Final reply', createdAt: expect.any(Number) }])
    expect(backend.getItem('aisling.conversations.v1')).toBe(durable)
    expect(stage.sessions).toHaveLength(2)
    write.mockRestore()
    stage.send('third question'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(complete).toHaveBeenCalledTimes(3)
    const restored = createLocalStorageConversationStore(backend)
    expect(restored.get(originalId)!.messages).toEqual(stage.runtime.history)
    expect(restored.get(unsavedId)!.messages).toEqual([{ role: 'user', content: 'second session question', createdAt: expect.any(Number) }, { role: 'assistant', content: 'Final reply', createdAt: expect.any(Number) }])
    expect(restored.list()).toHaveLength(2)
    expect(stage.persistenceError).toBeUndefined()
  })

  it('works and reports a quota failure when even initial session creation cannot persist', async () => {
    const { backend } = await fixture()
    vi.spyOn(backend, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    const stage = useStageStore()
    stage.send('hello'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stage.sessions).toHaveLength(1)
    expect(stage.runtime.history).toHaveLength(2)
    expect(stage.persistenceError?.reason).toBe('QuotaExceededError')
    expect(stage.messages.some(message => message.role === 'error')).toBe(true)
  })

  it.each(['', ' \n\t'])('does not persist an empty final user reply (%j), including after a visible partial', async text => {
    const { settings } = await fixture()
    settings.activeChatProvider = { id: 'stream', complete: async () => ({ text }), stream: async (_request, onText) => {
      onText('Undelivered partial'); return { text }
    } }
    const stage = useStageStore()
    stage.send('question'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    const history = createLocalStorageConversationStore().get(stage.activeSessionId)!.messages
    expect(history).toEqual([{ role: 'user', content: 'question', createdAt: expect.any(Number) }])
    expect(stage.runtime.history).toEqual(history)
    expect(stage.messages.some(message => message.role === 'assistant')).toBe(false)
    expect(stage.lastTurn).toBeUndefined()
  })
})
