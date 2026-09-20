import type { ChatMessage } from '@aisling/core'

import type { PersistentStorage } from '../storage/desktop-storage'

export interface ConversationSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Full UI/persistence history (longer than the model context window). */
  messages: ChatMessage[]
}

const KEY = 'aisling.conversations.v1'
const LEGACY_KEY = 'aisling.conversation.v1'
const MAX_SESSION_MESSAGES = 200
const MAX_SESSIONS = 50

interface PersistedState {
  sessions: ConversationSession[]
  activeId: string | null
}

export interface ConversationStore {
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

function normalizeSession(value: unknown): ConversationSession | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string')
    return undefined
  const messages = Array.isArray(record.messages) ? record.messages.filter(isChatMessage).slice(-MAX_SESSION_MESSAGES) : []
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title ? record.title : DEFAULT_SESSION_TITLE,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    messages,
  }
}

export function createLocalStorageConversationStore(storage: PersistentStorage = window.localStorage): ConversationStore {
  function readState(): PersistedState {
    try {
      const raw = storage.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>
        const sessions = (Array.isArray(parsed.sessions) ? parsed.sessions : [])
          .map(normalizeSession)
          .filter((session): session is ConversationSession => session !== undefined)
        return { sessions: sessions.slice(-MAX_SESSIONS), activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null }
      }

      // Migrate the legacy single-conversation array (v0.1.6) into one session.
      const legacy = storage.getItem(LEGACY_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy) as unknown
        if (Array.isArray(parsed)) {
          const messages = parsed.filter(isChatMessage).slice(-MAX_SESSION_MESSAGES)
          const now = Date.now()
          const session: ConversationSession = {
            id: crypto.randomUUID(),
            title: deriveTitle(messages),
            createdAt: now,
            updatedAt: now,
            messages,
          }
          return { sessions: [session], activeId: session.id }
        }
      }

      return { sessions: [], activeId: null }
    }
    catch {
      return { sessions: [], activeId: null }
    }
  }

  function writeState(state: PersistedState): void {
    try {
      storage.setItem(KEY, JSON.stringify(state))
    }
    catch {
      // storage full or unavailable — persistence is best-effort
    }
  }

  function deriveTitle(messages: readonly ChatMessage[]): string {
    const firstUser = messages.find(message => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
    return firstUser && firstUser.content ? truncateTitle(firstUser.content) : DEFAULT_SESSION_TITLE
  }

  return {
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
