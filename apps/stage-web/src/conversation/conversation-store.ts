import { normalizeAutonomousContext, type ChatMessage, type ConversationMessage } from '@aisling/core'

import type { PersistentStorage } from '../storage/desktop-storage'

export interface ConversationSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Full UI/persistence history (longer than the model context window). */
  messages: ConversationMessage[]
}

const KEY = 'aisling.conversations.v1'
const LEGACY_KEY = 'aisling.conversation.v1'

interface PersistedState {
  sessions: ConversationSession[]
  activeId: string | null
}

export interface ConversationPersistenceError {
  operation: 'read' | 'write'
  reason: 'QuotaExceededError' | 'SecurityError' | 'SyntaxError' | 'TypeError' | 'StorageError'
  at: number
  serializedChars?: number
}

export interface ConversationStore {
  getPersistenceError(): ConversationPersistenceError | undefined
  list(): ConversationSession[]
  get(id: string): ConversationSession | undefined
  save(session: ConversationSession): void
  create(title?: string): ConversationSession
  delete(id: string): void
  getActiveId(): string | null
  setActiveId(id: string): void
}

export const DEFAULT_SESSION_TITLE = 'New conversation'

export function truncateTitle(text: string, max = 30): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}…` : cleaned
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object')
    return false
  const record = value as Record<string, unknown>
  return (record.role === 'user' || record.role === 'assistant' || record.role === 'system' || record.role === 'tool')
    && (typeof record.content === 'string' || record.content === null)
}

function normalizeMessages(messages: unknown[]): ConversationMessage[] {
  return messages.filter(isChatMessage).map((message) => {
    const context = message.role === 'assistant'
      ? normalizeAutonomousContext((message as ConversationMessage).autonomousContext) : undefined
    return { role: message.role, content: message.content,
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(context ? { autonomousContext: context } : {}) }
  })
}

function normalizeSession(value: unknown): ConversationSession | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string')
    return undefined
  const messages = Array.isArray(record.messages) ? normalizeMessages(record.messages) : []
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title ? record.title : DEFAULT_SESSION_TITLE,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    messages,
  }
}

export function createLocalStorageConversationStore(storage: PersistentStorage = window.localStorage): ConversationStore {
  let pendingState: PersistedState | undefined
  let lastKnownState: PersistedState = { sessions: [], activeId: null }
  let readFailed = false
  let persistenceError: ConversationPersistenceError | undefined

  function remember(state: PersistedState): PersistedState {
    lastKnownState = state
    return state
  }

  function failure(operation: 'read' | 'write', error: unknown, serializedChars?: number): void {
    const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined
    const reason = name === 'QuotaExceededError' || name === 'SecurityError' || name === 'SyntaxError' || name === 'TypeError' ? name : 'StorageError'
    persistenceError = { operation, reason, at: Date.now(), serializedChars }
  }

  function readState(): PersistedState {
    if (pendingState) return pendingState
    try {
      const raw = storage.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>
        const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : [])
          .map(normalizeSession)
          .filter((session): session is ConversationSession => session !== undefined)
        return remember({ sessions, activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null })
      }

      // Migrate the legacy single-conversation array (v0.1.6) into one session.
      const legacy = storage.getItem(LEGACY_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy) as unknown
        if (Array.isArray(parsed)) {
          const messages = normalizeMessages(parsed)
          const now = Date.now()
          const session: ConversationSession = {
            id: crypto.randomUUID(),
            title: deriveTitle(messages),
            createdAt: now,
            updatedAt: now,
            messages,
          }
          // Keep the migrated identity stable until the first successful write.
          pendingState = remember({ sessions: [session], activeId: session.id })
          return pendingState
        }
      }

      return remember({ sessions: [], activeId: null })
    }
    catch (error) {
      failure('read', error)
      readFailed = true
      pendingState = lastKnownState
      return pendingState
    }
  }

  function writeState(state: PersistedState): void {
    pendingState = state
    // Never overwrite unknown stored data after a read failure; keep this run in memory.
    if (readFailed) return
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(state)
      // Desktop's synchronous bridge reports failure with false; localStorage throws.
      if ((storage.setItem(KEY, serialized) as unknown) === false) throw new Error('Conversation storage write failed')
      remember(state)
      pendingState = undefined
      persistenceError = undefined
    }
    catch (error) {
      failure('write', error, serialized?.length)
    }
  }

  function deriveTitle(messages: readonly ChatMessage[]): string {
    const firstUser = messages.find(message => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
    return firstUser && firstUser.content ? truncateTitle(firstUser.content) : DEFAULT_SESSION_TITLE
  }

  return {
    getPersistenceError: () => persistenceError,
    list() {
      return readState().sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    get(id) {
      return readState().sessions.find(session => session.id === id)
    },
    save(session) {
      const state = readState()
      const index = state.sessions.findIndex(item => item.id === session.id)
      const normalized = normalizeSession(session) ?? session
      if (index >= 0)
        state.sessions[index] = normalized
      else
        state.sessions.push(normalized)
      writeState(state)
    },
    create(title = DEFAULT_SESSION_TITLE) {
      const now = Date.now()
      const session: ConversationSession = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, messages: [] }
      const state = readState()
      state.sessions.push(session)
      state.activeId = session.id
      writeState(state)
      return session
    },
    delete(id) {
      const state = readState()
      state.sessions = state.sessions.filter(session => session.id !== id)
      if (state.activeId === id) {
        const remaining = state.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
        state.activeId = remaining[0]?.id ?? null
      }
      writeState(state)
    },
    getActiveId() {
      return readState().activeId
    },
    setActiveId(id) {
      const state = readState()
      state.activeId = id
      writeState(state)
    },
  }
}
