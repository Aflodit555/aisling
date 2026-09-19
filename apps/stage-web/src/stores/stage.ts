import type { CharacterOutput, ChatMessage, ImageInput, RuntimeEvent, Stimulus } from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { createWebVisualStimulus } from '../adapter/vision'
import { createWebTextStimulus } from '../adapter/web'
import {
  createLocalStorageConversationStore,
  DEFAULT_SESSION_TITLE,
  truncateTitle,
  type ConversationSession,
} from '../conversation/conversation-store'
import { createAislingRuntime } from '../runtime/aisling'
import { useSettingsStore } from './settings'
import { useSpeechStore } from './speech'

/** A message the Stage renders in the interaction dock. */
export interface DisplayMessage {
  role: 'user' | 'assistant' | 'error'
  content: string
}

/** Events shown in /devtools: runtime lifecycle plus app-level pipeline events. */
export type PipelineEvent =
  | RuntimeEvent
  | { type: 'vision:started' }
  | { type: 'vision:completed' }
  | { type: 'vision:failed'; error: string }
  | { type: 'hearing:capture_started' }
  | { type: 'hearing:capture_stopped' }
  | { type: 'hearing:recognition_started' }
  | { type: 'hearing:transcript_ready'; transcript: string }
  | { type: 'hearing:error'; error: string }

const MAX_DEVTOOLS_EVENTS = 200
const MODEL_CONTEXT_WINDOW = 40
const MAX_SESSION_MESSAGES = 200

function historyToDisplay(history: readonly ChatMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = []
  for (const message of history) {
    if (message.role === 'user' || message.role === 'assistant') {
      result.push({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
      })
    }
  }
  return result
}

function stimulusToUserMessage(stimulus: Stimulus): { role: 'user'; content: string } | undefined {
  if (stimulus.kind === 'user-text')
    return { role: 'user', content: stimulus.text }
  if (stimulus.kind === 'visual') {
    const label = stimulus.caption?.trim() ? `[image] ${stimulus.caption.trim()}` : '[image]'
    return { role: 'user', content: label }
  }
  return undefined
}

/**
 * The single Stage store: owns the runtime instance, the active conversation
 * session, the visible messages, and the Devtools event buffer. UI/persistence
 * history and the runtime's model-context window are kept separate.
 */
export const useStageStore = defineStore('stage', () => {
  const settings = useSettingsStore()
  const speech = useSpeechStore()
  const conversationStore = createLocalStorageConversationStore()

  function ensureActiveSession(): ConversationSession {
    const sessions = conversationStore.list()
    const activeId = conversationStore.getActiveId()
    const active = sessions.find(session => session.id === activeId)
    if (active)
      return active
    if (sessions.length > 0) {
      conversationStore.setActiveId(sessions[0]!.id)
      return sessions[0]!
    }
    return conversationStore.create()
  }

  const activeSession = ensureActiveSession()
  const activeSessionId = ref<string>(activeSession.id)
  const sessionMessages = ref<ChatMessage[]>([...activeSession.messages])
  const sessionsList = ref<ConversationSession[]>(conversationStore.list())

  const runtime = createAislingRuntime({
    getChatProvider: () => settings.activeChatProvider,
    getTools: () => settings.activeTools,
    history: activeSession.messages.slice(-MODEL_CONTEXT_WINDOW),
  })

  const messages = ref<DisplayMessage[]>(historyToDisplay(activeSession.messages))
  const sending = ref(false)
  const searching = ref(false)
  const visionProcessing = ref(false)
  const events = ref<PipelineEvent[]>([])
  const lastTurn = shallowRef<{ stimulus: Stimulus; output: CharacterOutput } | undefined>()

  runtime.onEvent((event) => {
    events.value = [...events.value, event].slice(-MAX_DEVTOOLS_EVENTS)
    if (event.type === 'tool:requested' || event.type === 'tool:started')
      searching.value = true
    if (event.type === 'tool:completed' || event.type === 'tool:failed')
      searching.value = false
  })

  function appendEvent(event: PipelineEvent): void {
    events.value = [...events.value, event].slice(-MAX_DEVTOOLS_EVENTS)
  }

  function persistActiveSession(): void {
    const session = conversationStore.get(activeSessionId.value)
    if (!session)
      return
    session.messages = sessionMessages.value.slice(-MAX_SESSION_MESSAGES)
    session.updatedAt = Date.now()
    conversationStore.save(session)
    sessionsList.value = conversationStore.list()
  }

  const characterName = computed(() => runtime.character.name)

  function sendStimulus(stimulus: Stimulus): void {
    if (sending.value)
      return

    sending.value = true
    const userMessage = stimulusToUserMessage(stimulus)
    if (userMessage) {
      messages.value = [...messages.value, { role: 'user', content: userMessage.content }]
      sessionMessages.value = [...sessionMessages.value, userMessage]

      const session = conversationStore.get(activeSessionId.value)
      if (session && session.title === DEFAULT_SESSION_TITLE && userMessage.content.trim()) {
        session.title = truncateTitle(userMessage.content)
        conversationStore.save(session)
      }
    }

    void runtime.ingest(stimulus).then((turn) => {
      if (turn.status === 'completed' && turn.output) {
        lastTurn.value = { stimulus: turn.stimulus, output: turn.output }
        messages.value = [...messages.value, { role: 'assistant', content: turn.output.text }]
        sessionMessages.value = [...sessionMessages.value, { role: 'assistant', content: turn.output.text }]
        persistActiveSession()
        void speech.speak(turn.output.text)
      }
      else {
        messages.value = [...messages.value, {
          role: 'error',
          content: turn.error ?? 'Something went wrong.',
        }]
      }
    }).finally(() => {
      sending.value = false
    })
  }

  function send(text: string): void {
    const trimmed = text.trim()
    if (!trimmed)
      return
    sendStimulus(createWebTextStimulus(trimmed))
  }

  async function sendImage(image: ImageInput, caption: string): Promise<void> {
    const provider = settings.activeVisionProvider
    if (!provider) {
      appendEvent({ type: 'vision:failed', error: 'Vision is not configured' })
      messages.value = [...messages.value, { role: 'error', content: 'Vision is not configured — set it up in Settings.' }]
      return
    }

    visionProcessing.value = true
    appendEvent({ type: 'vision:started' })
    try {
      const observation = await provider.analyze({ image })
      appendEvent({ type: 'vision:completed' })
      sendStimulus(createWebVisualStimulus(observation.text, caption))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendEvent({ type: 'vision:failed', error: message })
      messages.value = [...messages.value, { role: 'error', content: `Vision failed: ${message}` }]
    }
    finally {
      visionProcessing.value = false
    }
  }

  function switchSession(id: string): void {
    const session = conversationStore.get(id)
    if (!session)
      return
    activeSessionId.value = id
    conversationStore.setActiveId(id)
    sessionMessages.value = [...session.messages]
    messages.value = historyToDisplay(session.messages)
    runtime.resetHistory(session.messages.slice(-MODEL_CONTEXT_WINDOW))
    sessionsList.value = conversationStore.list()
  }

  function newConversation(): void {
    const session = conversationStore.create()
    activeSessionId.value = session.id
    sessionMessages.value = []
    messages.value = []
    runtime.resetHistory([])
    sessionsList.value = conversationStore.list()
  }

  function deleteSession(id: string): void {
    const wasActive = id === activeSessionId.value
    conversationStore.delete(id)
    sessionsList.value = conversationStore.list()
    if (wasActive) {
      const remaining = sessionsList.value
      if (remaining.length > 0)
        switchSession(remaining[0]!.id)
      else
        newConversation()
    }
  }

  return {
    activeSessionId,
    deleteSession,
    appendEvent,
    character: runtime.character,
    characterName,
    events,
    lastTurn,
    messages,
    newConversation,
    runtime,
    searching,
    send,
    sendImage,
    sendStimulus,
    sending,
    sessions: sessionsList,
    switchSession,
    visionProcessing,
  }
})
