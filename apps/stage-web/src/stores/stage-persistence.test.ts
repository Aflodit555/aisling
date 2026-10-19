import { createPinia, setActivePinia } from 'pinia'
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
      { role: 'user', content: 'Next question' }, { role: 'assistant', content: 'Final reply' }])
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
    expect(stage.runtime.history).toEqual([{ role: 'user', content: 'first unsaved question' }, { role: 'assistant', content: 'Final reply' }])
    expect(backend.getItem('aisling.conversations.v1')).toBe(durable)
    expect(stage.sessions).toHaveLength(2)
    write.mockRestore()
    stage.send('third question'); await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(complete).toHaveBeenCalledTimes(3)
    const restored = createLocalStorageConversationStore(backend)
    expect(restored.get(originalId)!.messages).toEqual(stage.runtime.history)
    expect(restored.get(unsavedId)!.messages).toEqual([{ role: 'user', content: 'second session question' }, { role: 'assistant', content: 'Final reply' }])
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
    expect(history).toEqual([{ role: 'user', content: 'question' }])
    expect(stage.runtime.history).toEqual(history)
    expect(stage.messages.some(message => message.role === 'assistant')).toBe(false)
    expect(stage.lastTurn).toBeUndefined()
  })
})
