import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { legacyRecallProvider } from '@aisling/core/legacy-recall'
import type { useSettingsStore } from '../stores/settings'
import type { ConversationSession } from '../conversation/conversation-store'
import { formationEnableThinking } from './provider-factory'
import { createReflectionFormation } from './reflection-formation'
import { createReflectionRecall } from './reflection-recall'
import { createOrganizationProcessor } from './note-organization'
import { prepareNoteRecall, type NoteRecallTrace } from './note-recall'

/** Active only on Desktop profiles that still use the old memory authority. */
export function createLegacyMemory({ settings, freshSessions, sessions, activeId, storageFailed, onUsed }: {
  settings: ReturnType<typeof useSettingsStore>
  freshSessions: () => ConversationSession[]
  sessions: () => ConversationSession[]
  activeId: () => string
  storageFailed: () => boolean
  onUsed: () => void
}) {
  const bridge = window.aislingDesktop?.memoryOrganization
  const enabled = computed(() => settings.loaded && settings.config.memory.enabled)
  const recall = computed(() => enabled.value && settings.config.memory.noteRecallEnabled === true)
  const organizationDesired = computed(() => enabled.value && settings.config.memory.organizationEnabled === true)
  const formationStatus = shallowRef({ enabled: false, running: false, calls: 0, lastEvent: 'disabled' })
  const organizationStatus = shallowRef({ ready: false, autoWrite: false, reason: 'disabled', pending: 0 })
  const memoryTraceEnabled = ref(false)
  const noteRecallTrace = shallowRef<NoteRecallTrace>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let recallEpoch = 0
  let organizationEpoch = 0

  function invalidate() {
    recallEpoch++
    noteRecallTrace.value = undefined
    clearTimeout(timer)
  }

  const offStatus = bridge?.onStatus?.(state => {
    if (state.reason === 'erasing' || state.reason === 'erasure-failed') invalidate()
    organizationStatus.value = { ...organizationStatus.value, ...state }
  })
  const organization = bridge && createOrganizationProcessor({
    enabled: () => organizationDesired.value && organizationStatus.value.ready,
    bridge, getSessions: freshSessions,
  })
  const reflectionRecall = createReflectionRecall(() => formation.inspect())
  const formation = createReflectionFormation({
    storage: { read: () => window.aislingDesktop?.reflectionStorage?.read() ?? { ok: false },
      write: value => window.aislingDesktop?.reflectionStorage?.write(value) ?? false },
    getSessions: freshSessions,
    getProvider: () => settings.activeChatProvider,
    getEnableThinking: () => formationEnableThinking(settings.config.consciousness),
    organization,
    changed() {
      formationStatus.value = { ...formation.status }
      reflectionRecall.invalidate()
      try {
        const state = formation.inspect()
        organizationStatus.value = { ...organizationStatus.value,
          pending: state.batches.reduce((count, batch) => count
            + (batch.organization?.items.filter(item => item.status === 'proposed-not-applied').length ?? 0), 0) }
      } catch { invalidate() }
    },
  })

  watch(recall, (desired, previous) => {
    invalidate()
    if (desired) void bridge?.recallHeads?.().catch(() => {})
    else if (previous && !settings.config.memory.organizationEnabled) void bridge?.setEnabled(false).catch(() => {})
  }, { immediate: true, flush: 'sync' })
  watch(memoryTraceEnabled, trace => { if (!trace) invalidate() }, { flush: 'sync' })
  watch(() => enabled.value && (organizationDesired.value ? organizationStatus.value.ready : settings.config.memory.formationEnabled === true),
    value => { void formation.setEnabled(value) }, { immediate: true, flush: 'sync' })
  watch(() => [organizationDesired.value, organizationDesired.value ? settings.activeChatProvider : undefined] as const,
    async ([desired, provider], previous) => {
      if (!desired && !previous?.[0]) return
      const ticket = ++organizationEpoch
      if (formation.status.enabled) formation.interrupt()
      organizationStatus.value = { ...organizationStatus.value, ready: false, reason: desired ? 'starting' : 'disabled' }
      try {
        const state = await bridge?.setEnabled(desired && !!provider)
        if (ticket === organizationEpoch) organizationStatus.value = { ...organizationStatus.value,
          ...(state ?? { ready: false, autoWrite: false, reason: 'desktop-required' }) }
      } catch {
        if (ticket === organizationEpoch) organizationStatus.value = { ...organizationStatus.value, ready: false, reason: 'database-unavailable' }
      }
    }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    invalidate()
    offStatus?.()
    formation.dispose()
    organizationEpoch++
    void bridge?.setEnabled(false).catch(() => {})
  })

  const getHistoryAddon = legacyRecallProvider(stimulus => {
    if (!enabled.value) return { candidates: [], durationMs: 0, reason: 'disabled' }
    if (storageFailed()) return { candidates: [], durationMs: 0, reason: 'conversation-error' }
    const snapshot = sessions()
    const sessionId = activeId()
    const context = reflectionRecall.retrieve(snapshot, sessionId, stimulus.text)
    if (!recall.value || !bridge?.recallHeads) return context
    const epoch = recallEpoch
    const current = () => recall.value && recallEpoch === epoch
    const append = prepareNoteRecall(() => bridge.recallHeads!(), snapshot, sessionId, stimulus.text, current, value => {
      if (value.injected.length) onUsed()
      if (!memoryTraceEnabled.value) return
      noteRecallTrace.value = structuredClone(value)
      clearTimeout(timer)
      timer = setTimeout(() => { noteRecallTrace.value = undefined }, 5 * 60_000)
    })
    return Promise.all([context, append]).then(([reflection, appendNotes]) => ({ ...reflection, appendNotes }))
  })

  return { formation, formationStatus, organizationStatus, memoryTraceEnabled, noteRecallTrace, getHistoryAddon, invalidate,
    interruptOrganization: () => { if (organizationDesired.value) formation.interrupt() } }
}
