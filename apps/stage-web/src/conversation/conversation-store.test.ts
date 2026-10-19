import { describe, expect, it, vi } from 'vitest'
import { createLocalStorageConversationStore } from './conversation-store'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('conversation context persistence compatibility', () => {
  it('handles the desktop bridge false write result as an unsaved state', () => {
    const backend = storage(), store = createLocalStorageConversationStore(backend), session = store.create()
    vi.spyOn(backend, 'setItem').mockImplementation(() => false)
    session.messages = [{ role: 'user', content: 'Unsaved desktop input' }]
    store.save(session)
    expect(store.getPersistenceError()).toMatchObject({ operation: 'write', reason: 'StorageError' })
    expect(store.get(session.id)?.messages).toEqual(session.messages)
    expect(createLocalStorageConversationStore(backend).get(session.id)?.messages).toEqual([])
  })
  it('retains unsaved sessions and messages in memory after quota failure and retries the full state', () => {
    const backend = storage(), store = createLocalStorageConversationStore(backend)
    const original = store.create('Original'), durable = backend.getItem('aisling.conversations.v1')
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    const unsaved = store.create('Unsaved')
    unsaved.messages = [{ role: 'user', content: 'Do not lose this' }]
    expect(() => store.save(unsaved)).not.toThrow()
    expect(store.get(unsaved.id)?.messages).toEqual(unsaved.messages)
    expect(store.get(original.id)?.title).toBe('Original')
    expect(store.getActiveId()).toBe(unsaved.id)
    expect(backend.getItem('aisling.conversations.v1')).toBe(durable)
    expect(store.getPersistenceError()).toMatchObject({ operation: 'write', reason: 'QuotaExceededError' })
    write.mockRestore(); store.save(unsaved)
    expect(store.getPersistenceError()).toBeUndefined()
    const restored = createLocalStorageConversationStore(backend)
    expect(restored.get(unsaved.id)?.messages).toEqual(unsaved.messages)
    expect(restored.get(original.id)?.title).toBe('Original')
  })

  it('does not silently discard older sessions above fifty on read or a later save', () => {
    const backend = storage()
    const sessions = Array.from({ length: 52 }, (_, i) => ({ id: `s${i}`, title: `${i}`, createdAt: i, updatedAt: i,
      messages: [{ role: 'user', content: `history ${i}` }] }))
    backend.setItem('aisling.conversations.v1', JSON.stringify({ sessions, activeId: 's0' }))
    const store = createLocalStorageConversationStore(backend)
    expect(store.list()).toHaveLength(52)
    store.save(sessions[51] as never)
    expect(JSON.parse(backend.getItem('aisling.conversations.v1')!).sessions).toHaveLength(52)
    expect(store.get('s0')?.messages[0]?.content).toBe('history 0')
  })

  it('does not overwrite unreadable persisted data with an empty fallback', () => {
    const backend = storage(), write = vi.spyOn(backend, 'setItem')
    vi.spyOn(backend, 'getItem').mockImplementation(() => { throw new DOMException('unavailable', 'SecurityError') })
    const store = createLocalStorageConversationStore(backend), session = store.create('In memory')
    session.messages = [{ role: 'user', content: 'Still usable' }]; store.save(session)
    expect(store.get(session.id)?.messages).toEqual(session.messages)
    expect(write).not.toHaveBeenCalled()
    expect(store.getPersistenceError()).toMatchObject({ operation: 'read', reason: 'SecurityError' })
  })

  it('restores old sessions without metadata and preserves their entire history', () => {
    const backend = storage()
    const messages = Array.from({ length: 250 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}` }))
    backend.setItem('aisling.conversations.v1', JSON.stringify({ activeId: 'old', sessions: [
      { id: 'old', title: 'Old session', createdAt: 1, updatedAt: 2, messages },
    ] }))
    const store = createLocalStorageConversationStore(backend)
    expect(store.getActiveId()).toBe('old'); expect(store.get('old')!.messages).toEqual(messages)
    store.save(store.get('old')!)
    expect(createLocalStorageConversationStore(backend).get('old')!.messages).toEqual(messages)
  })

  it('migrates the old single-session format without discarding messages', () => {
    const backend = storage()
    const messages = Array.from({ length: 220 }, () => ({ role: 'assistant', content: 'old speech' }))
    backend.setItem('aisling.conversation.v1', JSON.stringify(messages))
    const store = createLocalStorageConversationStore(backend)
    expect(store.list()[0]!.messages).toEqual(messages)
    const id = store.list()[0]!.id
    expect(store.getActiveId()).toBe(id)
    expect(store.get(id)?.messages).toEqual(messages)
    store.save(store.list()[0]!)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]!.messages).toHaveLength(220)
  })

  it('validates and bounds persisted basis and never retains raw attachments or invalid context', () => {
    const store = createLocalStorageConversationStore(storage()), session = store.create()
    session.messages = [{ role: 'assistant', content: 'delivered', autonomousContext: {
      deliveredAt: 1000, observedAt: 500, source: 'foreground', change: 'appeared', objectId: 'object',
      app: 'browser', title: 'My private page', excerpt: 'password: private-value',
      rawSnapshot: { dom: 'private DOM' },
    } } as never, { role: 'assistant', content: 'old speech', autonomousContext: { deliveredAt: 'invalid' } } as never]
    store.save(session)
    const restored = store.get(session.id)!
    expect(restored.messages[0]!.autonomousContext?.excerpt).toBe('[redacted]')
    expect(restored.messages[1]!.autonomousContext).toBeUndefined()
    expect(JSON.stringify(restored)).not.toMatch(/private-value|private DOM|rawSnapshot/)
    store.delete(session.id); expect(store.get(session.id)).toBeUndefined()
  })
})
