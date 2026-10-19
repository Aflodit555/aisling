import { createAutonomousContext, type CharacterOutput, type ChatMessage, type ConversationMessage, type ImageInput, type Stimulus } from '@aisling/core'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'

import { createWebVisualStimulus } from '../adapter/vision'
import { createWebTextStimulus } from '../adapter/web'
import {
  createLocalStorageConversationStore,
  DEFAULT_SESSION_TITLE,
  truncateTitle,
  type ConversationPersistenceError,
  type ConversationSession,
} from '../conversation/conversation-store'
import { createAislingRuntime } from '../runtime/aisling'
import { createAutonomousController, createAutonomousState, type DesktopJudgeRequest, type DesktopObserverStatus } from '../runtime/autonomous'
import { CAPTURE_MAX_GAP_MS, mediaCandidateMatches, playingMedia } from '../runtime/desktop-observations'
import { PREFERENCE_ACKNOWLEDGEMENTS, recognizeInteractionPreference } from '../runtime/interaction-preference'
import { resolvePersistentStorage } from '../storage/desktop-storage'
import { createSituationWorkingState, isSituationCorrection, providerSituationExecutor } from '../runtime/situation-working-state'
import { situationEnableThinking } from '../runtime/provider-factory'
import { useEmotionStore } from './emotion'
import { useSettingsStore } from './settings'
import { useSpeechStore } from './speech'

/** A message the Stage renders in the interaction dock. */
export interface DisplayMessage {
  role: 'user' | 'assistant' | 'error'
  content: string
}

const SAVE_WARNING = 'Conversation history could not be saved. Changes are kept in memory for this run and may be lost on restart. Check available storage.'
const READ_WARNING = 'Conversation storage could not be read. Existing stored data will not be overwritten. New changes are only in memory and may be lost on restart.'

export type DesktopBridgeState = 'connected' | 'unavailable'

function hasDesktopBridge(): boolean {
  const bridge = window.aislingDesktop
  return typeof bridge?.setDesktopAwareness === 'function'
    && typeof bridge.readDesktopContext === 'function'
    && typeof bridge.judgeDesktopContext === 'function'
}

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
 * session and the visible messages. UI/persistence
 * history and the runtime's model-context window are kept separate.
 */
export const useStageStore = defineStore('stage', () => {
  const settings = useSettingsStore()
  const speech = useSpeechStore()
  const emotion = useEmotionStore()
  const conversationStore = createLocalStorageConversationStore(resolvePersistentStorage())

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
  const sessionMessages = ref<ConversationMessage[]>([...activeSession.messages])
  const sessionsList = ref<ConversationSession[]>(conversationStore.list())

  const diagnostic = window.aislingDesktop?.desktopDiagnostics?.enabled
    ? (record: import('../runtime/autonomous').DesktopDiagnosticRecord) => {
        try { window.aislingDesktop?.recordDesktopDiagnostic?.(record) }
        catch { /* The diagnostic bridge cannot affect production behavior. */ }
      } : undefined
  const turnDiagnostics = new Map<string, Record<string, unknown>>()
  const situation = createSituationWorkingState({ execute: providerSituationExecutor(() => settings.activeChatProvider,
    { getEnableThinking: () => situationEnableThinking(settings.config.consciousness) }), diagnostic })
  const situationStatus = situation.status
  onScopeDispose(() => situation.dispose())

  const runtime = createAislingRuntime({
    getChatProvider: () => settings.activeChatProvider,
    getTools: () => settings.activeTools,
    history: activeSession.messages,
    getSituationContext: (stimulus, turnId) => situation.contextFor(stimulus, diagnostic && turnId
      ? selection => { turnDiagnostics.set(turnId, { ...selection }) } : undefined),
    diagnostic: diagnostic ? record => {
      if (record.type === 'p2-b-context') {
        const selected = turnDiagnostics.get(record.turnId)
        turnDiagnostics.set(record.turnId, { ...selected, injected: record.injected, contextChars: record.contextChars,
          reason: record.reason === 'context-error' || record.reason === 'context-limit' ? record.reason : selected?.reason ?? record.reason,
          revision: record.injected ? selected?.revision : undefined, updateId: record.injected ? selected?.updateId : undefined,
          conversationId: activeSessionId.value, aCallsAtStart: situation.status.calls })
      }
      const trace = turnDiagnostics.get(record.turnId)
      diagnostic({ ...trace, ...record, reason: record.type === 'context-assembled' ? record.reason : trace?.reason ?? record.reason,
        aCalls: situation.status.calls, activeAUpdateId: situation.activeUpdateId() })
    } : undefined,
  })

  const messages = ref<DisplayMessage[]>(historyToDisplay(activeSession.messages))
  const persistenceError = shallowRef<ConversationPersistenceError>()
  syncPersistenceStatus()
  const sending = ref(false)
  const searching = ref(false)
  const visionProcessing = ref(false)
  const lastTurn = shallowRef<{ stimulus: Stimulus; output: CharacterOutput } | undefined>()
  const autonomous = reactive(createAutonomousState())
  const desktopBridgeState = ref<DesktopBridgeState>(hasDesktopBridge() ? 'connected' : 'unavailable')
  const desktopAvailable = computed(() => desktopBridgeState.value === 'connected')
  let awarenessRevision = 0

  function refreshDesktopBridgeStatus(): boolean {
    const connected = hasDesktopBridge()
    desktopBridgeState.value = connected ? 'connected' : 'unavailable'
    return connected
  }

  let desktopRead: Promise<DesktopObserverStatus> | undefined
  async function readDesktopContext() {
    if (!refreshDesktopBridgeStatus())
      throw new Error('Desktop bridge is unavailable')
    // Polling and final media validation share the native observer's one read.
    if (!desktopRead) desktopRead = window.aislingDesktop!.readDesktopContext().then(snapshot => {
      if (activeAutonomous?.stimulus.candidate.source === 'media') {
        if (!snapshot.available || !snapshot.context || !snapshot.context.media.length) cancelAutonomous('media-unavailable')
        else if (snapshot.context.capturedAt > Date.now() || Date.now() - snapshot.context.capturedAt > CAPTURE_MAX_GAP_MS) cancelAutonomous('media-stale')
        else if (!playingMedia(snapshot.context.media)) cancelAutonomous('media-ambiguous')
        else if (!mediaCandidateMatches(activeAutonomous.stimulus.candidate, snapshot.context)) cancelAutonomous('media-changed')
      }
      return snapshot
    }).finally(() => { desktopRead = undefined })
    return desktopRead
  }

  async function judgeDesktopContext(request: DesktopJudgeRequest) {
    if (!refreshDesktopBridgeStatus())
      throw new Error('Desktop bridge is unavailable')
    return window.aislingDesktop!.judgeDesktopContext(request)
  }

  const autonomousController = createAutonomousController({
    state: autonomous,
    readDesktop: readDesktopContext,
    judgeDesktop: judgeDesktopContext,
    isBusy: () => sending.value || visionProcessing.value || speech.speaking,
    isReady: () => desktopAvailable.value && settings.loaded && Boolean(settings.activeChatProvider),
    getCooldownMs: () => settings.config.desktopAwareness.cooldownSeconds * 1000,
    trigger: sendStimulus,
    getReplyHistoryEnabled: () => settings.config.desktopAwareness.replyHistoryEnabled === true,
    onSnapshot: snapshot => situation.observe(snapshot),
    diagnostic,
    diagnosticReplyText: window.aislingDesktop?.desktopDiagnostics?.replyText === true,
  })
  watch(() => settings.config.desktopAwareness.replyHistoryEnabled, () => autonomousController.syncHistorySetting(), { flush: 'sync' })
  watch(() => settings.config.desktopAwareness.situationEnabled === true && autonomous.enabled,
    enabled => situation.setEnabled(enabled), { flush: 'sync', immediate: true })
  watch(() => settings.activeChatProvider, () => situation.reset('provider-changed'), { flush: 'sync' })

  async function setDesktopAwarenessEnabled(enabled: boolean, persist = true): Promise<void> {
    const ticket = ++awarenessRevision
    if (!enabled || !refreshDesktopBridgeStatus())
      autonomousController.setEnabled(false)
    if (!desktopAvailable.value) {
      if (persist)
        await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, enabled: false })
      autonomous.error = 'Desktop Awareness is available in the Electron app only.'
      return
    }
    if (enabled && (!settings.config.desktopAwareness.jevApiKey.trim() || !settings.activeChatProvider)) {
      autonomousController.setEnabled(false)
      await window.aislingDesktop!.setDesktopAwareness(false)
      if (persist || settings.config.desktopAwareness.enabled)
        await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, enabled: false })
      autonomous.error = !settings.config.desktopAwareness.jevApiKey.trim() ? 'Configure the API key before enabling.' : 'Configure Consciousness before enabling.'
      return
    }
    // Start/stop IPC is issued before persistence so OFF cancels collection and
    // the in-flight judge immediately instead of waiting on storage.
    const status = await window.aislingDesktop!.setDesktopAwareness(enabled)
    if (ticket !== awarenessRevision)
      return
    autonomousController.setEnabled(status.enabled)
    if (persist)
      await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, enabled: status.enabled })
    autonomous.error = status.error ?? ''
  }

  let partialIndex = -1
  let activeAutonomous: { stimulus: import('@aisling/core').AutonomousStimulus; cancelled: boolean; delivered: boolean } | undefined
  function cancelAutonomous(reason: string): void {
    if (!activeAutonomous || activeAutonomous.cancelled) return
    activeAutonomous.cancelled = true
    if (partialIndex >= 0) messages.value.splice(partialIndex, 1)
    partialIndex = -1
    autonomousController.recordDecision(activeAutonomous.stimulus.source, 'blocked', reason, activeAutonomous.stimulus.id, activeAutonomous.stimulus.candidate)
    autonomousController.recordOutputDiagnostic(activeAutonomous.stimulus, 'chat-cancel-requested', { reason })
  }
  runtime.onEvent((event) => {
    if (event.type === 'provider:called' && activeAutonomous)
      autonomousController.recordOutputDiagnostic(activeAutonomous.stimulus, 'chat-started', { turnId: event.turnId })
    if (event.type === 'output:partial') {
      if (!sending.value || activeAutonomous?.cancelled) return
      if (!event.text.trim()) {
        if (partialIndex >= 0) messages.value.splice(partialIndex, 1)
        partialIndex = -1
      }
      else if (partialIndex < 0) {
        partialIndex = messages.value.length
        messages.value.push({ role: 'assistant', content: event.text })
      }
      else {
        messages.value[partialIndex] = { role: 'assistant', content: event.text }
      }
      return
    }
    if (event.type === 'tool:requested' || event.type === 'tool:started')
      searching.value = true
    if (event.type === 'tool:completed' || event.type === 'tool:failed')
      searching.value = false
  })

  function syncPersistenceStatus(): void {
    persistenceError.value = conversationStore.getPersistenceError()
    if (!persistenceError.value) return
    const content = persistenceError.value.operation === 'read' ? READ_WARNING : SAVE_WARNING
    if (!messages.value.some(message => message.role === 'error' && message.content === content))
      messages.value.push({ role: 'error', content })
  }

  function persistActiveSession(): void {
    const session = conversationStore.get(activeSessionId.value)
    if (!session)
      return
    session.messages = [...sessionMessages.value]
    session.updatedAt = Date.now()
    conversationStore.save(session)
    sessionsList.value = conversationStore.list()
    syncPersistenceStatus()
  }

  const characterName = computed(() => runtime.character.name)

  function sendStimulus(stimulus: Stimulus): void {
    if (stimulus.kind === 'user-text' || stimulus.kind === 'visual')
      autonomousController.noteHumanInteraction()
    if (stimulus.kind === 'user-text') {
      const preference = recognizeInteractionPreference(stimulus.text)
      if (preference) {
        autonomousController.setPreference(preference, stimulus.id)
        if (preference === 'quiet') cancelAutonomous('quiet-in-flight')
        const acknowledgement = [
          { role: 'user' as const, content: stimulus.text },
          { role: 'assistant' as const, content: PREFERENCE_ACKNOWLEDGEMENTS[preference] },
        ]
        messages.value = [...messages.value, ...acknowledgement]
        sessionMessages.value = [...sessionMessages.value, ...acknowledgement]
        persistActiveSession()
        if (!sending.value)
          runtime.resetHistory(sessionMessages.value)
        return
      }
    }
    if (stimulus.kind === 'autonomous' && autonomous.preference === 'quiet') {
      autonomousController.recordDecision(stimulus.source, 'blocked', 'quiet', stimulus.id, stimulus.candidate)
      autonomousController.recordOutputDiagnostic(stimulus, 'chat-blocked', { delivered: false })
      return
    }
    if (sending.value) {
      if (stimulus.kind === 'autonomous')
        autonomousController.recordOutputDiagnostic(stimulus, 'chat-busy', { delivered: false })
      return
    }

    sending.value = true
    if (stimulus.kind === 'user-text' && isSituationCorrection(stimulus.text))
      situation.feedback(stimulus.text, situation.currentScope())
    const autonomousTurn = stimulus.kind === 'autonomous' ? {
      stimulus, cancelled: false, delivered: false,
    } : undefined
    activeAutonomous = autonomousTurn
    if (activeAutonomous) {
      autonomousController.recordDecision(stimulus.source, 'allowed', 'output-started', stimulus.id, activeAutonomous.stimulus.candidate)
    }
    partialIndex = -1
    const userMessage = stimulusToUserMessage(stimulus)
    if (userMessage) {
      messages.value = [...messages.value, { role: 'user', content: userMessage.content }]
      sessionMessages.value = [...sessionMessages.value, userMessage]

      const session = conversationStore.get(activeSessionId.value)
      if (session && session.title === DEFAULT_SESSION_TITLE && userMessage.content.trim()) {
        session.title = truncateTitle(userMessage.content)
        conversationStore.save(session)
      }
      persistActiveSession()
    }

    let diagnosticTurnId: string | undefined, diagnosticDelivered = false
    let diagnosticOutcome = 'not-delivered'
    void runtime.ingest(stimulus).then(async (turn) => {
      diagnosticTurnId = turn.id
      diagnosticOutcome = turn.status === 'failed' ? 'generation-failed' : 'empty'
      if (autonomousTurn && !autonomousTurn.cancelled && stimulus.kind === 'autonomous' && stimulus.candidate.source === 'media'
        && turn.status === 'completed' && turn.output?.text.trim()) {
        try {
          const checked = await readDesktopContext()
          autonomousController.recordOutputDiagnostic(stimulus, 'media-delivery-check', {
            checkedSnapshot: checked.context ? { capturedAt: checked.context.capturedAt, targetHwnd: checked.context.targetHwnd, sequence: checked.context.sequence } : undefined,
          })
        }
        catch { cancelAutonomous('media-unavailable') }
      }
      if (autonomousTurn && stimulus.kind === 'autonomous') {
        const status = autonomousTurn.cancelled ? 'chat-cancelled' : turn.status === 'failed' ? 'chat-failed'
          : !turn.output?.text.trim() ? 'chat-empty' : 'chat-completed'
        autonomousController.recordOutputDiagnostic(stimulus, status,
          { turnId: turn.id, text: turn.output?.text, ...(status === 'chat-completed' ? {} : { delivered: false }) })
      }
      // No provider cancellation protocol: discard a revoked turn before any output side effects.
      if (autonomousTurn?.cancelled) {
        diagnosticOutcome = 'cancelled'
        autonomousController.recordDecision(stimulus.source, 'blocked', 'cancelled-output', stimulus.id, autonomousTurn.stimulus.candidate)
        return
      }
      // Foreground changes do not revoke accepted replies; obsolete media targets do.
      if (turn.status === 'completed' && turn.output) {
        if (!turn.output.text.trim()) {
          if (partialIndex >= 0) messages.value.splice(partialIndex, 1)
          if (autonomousTurn)
            autonomousController.recordDecision(stimulus.source, 'blocked', 'empty-output', stimulus.id, autonomousTurn.stimulus.candidate)
          return
        }
        lastTurn.value = { stimulus: turn.stimulus, output: turn.output }
        if (partialIndex >= 0)
          messages.value[partialIndex] = { role: 'assistant', content: turn.output.text }
        else
          messages.value.push({ role: 'assistant', content: turn.output.text })
        const delivered: ConversationMessage = { role: 'assistant', content: turn.output.text,
          ...(autonomousTurn ? { autonomousContext: createAutonomousContext(autonomousTurn.stimulus.candidate, Date.now()) } : {}) }
        sessionMessages.value = [...sessionMessages.value, delivered]
        persistActiveSession()
        diagnosticDelivered = true; diagnosticOutcome = 'delivered'
        if (autonomousTurn) {
          const replyHistoryWritten = autonomousController.completed(autonomousTurn.stimulus, true, turn.output.text)
          autonomousController.recordDecision(stimulus.source, 'allowed', 'output-delivered', stimulus.id, autonomousTurn.stimulus.candidate)
          autonomousTurn.delivered = true
          autonomousController.recordOutputDiagnostic(autonomousTurn.stimulus, 'delivery', {
            turnId: turn.id, text: turn.output.text, delivered: true, replyHistoryWritten,
          })
        }
        void speech.speak(turn.output.text)
        void emotion.judge(sessionMessages.value)
      }
      else {
        if (autonomousTurn)
          autonomousController.recordDecision(stimulus.source, 'blocked', 'output-failed', stimulus.id, autonomousTurn.stimulus.candidate)
        if (partialIndex >= 0) messages.value.splice(partialIndex, 1)
        messages.value = [...messages.value, {
          role: 'error',
          content: turn.error ?? 'Something went wrong.',
        }]
      }
    }).finally(() => {
      if (diagnostic && diagnosticTurnId) {
        const trace = turnDiagnostics.get(diagnosticTurnId)
        diagnostic({ ...trace, type: 'p2-b-delivery', at: Date.now(), turnId: diagnosticTurnId,
          source: stimulus.kind, delivered: diagnosticDelivered, outcome: diagnosticOutcome,
          aCallsDuringTurn: situation.status.calls - Number(trace?.aCallsAtStart ?? situation.status.calls) })
        turnDiagnostics.delete(diagnosticTurnId)
      }
      // The session owns delivered history, including commands received during generation.
      runtime.resetHistory(sessionMessages.value)
      activeAutonomous = undefined
      partialIndex = -1
      sending.value = false
      if (autonomousTurn && !autonomousTurn.delivered)
        autonomousController.completed(autonomousTurn.stimulus, false)
    })
  }

  function send(text: string): void {
    const trimmed = text.trim()
    if (!trimmed)
      return
    sendStimulus(createWebTextStimulus(trimmed))
  }

  async function sendImage(image: ImageInput, caption: string): Promise<void> {
    autonomousController.noteHumanInteraction()
    if (sending.value || visionProcessing.value)
      return
    const provider = settings.activeVisionProvider
    if (!provider) {
      messages.value = [...messages.value, { role: 'error', content: 'Vision is not configured — set it up in Settings.' }]
      return
    }

    visionProcessing.value = true
    try {
      const observation = await provider.analyze({ image })
      sendStimulus(createWebVisualStimulus(observation.text, caption))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      messages.value = [...messages.value, { role: 'error', content: `Vision failed: ${message}` }]
    }
    finally {
      visionProcessing.value = false
    }
  }

  function switchSession(id: string): void {
    autonomousController.noteHumanInteraction()
    if (sending.value || visionProcessing.value)
      return
    const session = conversationStore.get(id)
    if (!session)
      return
    activeSessionId.value = id
    situation.reset()
    conversationStore.setActiveId(id)
    sessionMessages.value = [...session.messages]
    messages.value = historyToDisplay(session.messages)
    runtime.resetHistory(session.messages)
    sessionsList.value = conversationStore.list()
    syncPersistenceStatus()
  }

  function newConversation(): void {
    autonomousController.noteHumanInteraction()
    if (sending.value || visionProcessing.value)
      return
    const session = conversationStore.create()
    activeSessionId.value = session.id
    situation.reset()
    sessionMessages.value = []
    messages.value = []
    runtime.resetHistory([])
    sessionsList.value = conversationStore.list()
    syncPersistenceStatus()
  }

  function deleteSession(id: string): void {
    autonomousController.noteHumanInteraction()
    if (sending.value || visionProcessing.value)
      return
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
    syncPersistenceStatus()
  }

  return {
    autonomous,
    situationStatus,
    desktopBridgeState,
    desktopAvailable,
    refreshDesktopBridgeStatus,
    tickAutonomous: autonomousController.tick,
    noteHumanInteraction: autonomousController.noteHumanInteraction,
    restoreDesktopAwareness: () => setDesktopAwarenessEnabled(settings.config.desktopAwareness.enabled, false),
    setDesktopAwarenessEnabled,
    activeSessionId,
    deleteSession,
    character: runtime.character,
    characterName,
    lastTurn,
    messages,
    persistenceError,
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
