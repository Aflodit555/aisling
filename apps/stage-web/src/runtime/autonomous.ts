import { createAutonomousStimulus, type AutonomousStimulus, type DesktopActivitySnapshot, type DesktopCandidate } from '@aisling/core'
import { CAPTURE_MAX_GAP_MS, OBSERVATION_RETENTION_MS, createDesktopObservations, mediaCandidateMatches, type DesktopObservation } from './desktop-observations'
import type { InteractionPreference } from './interaction-preference'

export interface DesktopJudgeRequest {
  candidate: DesktopCandidate
  recentReply?: { deliveredAt: number; summary: string }
  diagnostic?: { sampleId: string; judgmentId: string }
}
export interface DesktopDiagnosticRecord { at: number; type: string; [key: string]: unknown }
export interface DesktopJudgeScores { shouldInterrupt: number }
export interface DesktopObserverStatus { enabled: boolean; available: boolean; context?: DesktopActivitySnapshot; error?: string }
export interface DesktopJudgeResult { context: DesktopActivitySnapshot; scores: DesktopJudgeScores; historyIncluded?: boolean }
export interface AutonomousDecision {
  at: number; source: string; outcome: 'allowed' | 'blocked' | 'updated'; reason: string
  preference: InteractionPreference; candidateId?: string; objectId?: string; stimulusId?: string; score?: number; historyIncluded?: boolean
}
export interface AutonomousState {
  enabled: boolean; preference: InteractionPreference; decisions: AutonomousDecision[]; observations: DesktopObservation[]
  cooldownStartedAt: number | null; pending: boolean; error: string
}
export const DESKTOP_POLL_MS = 2_000
export const SHOULD_INTERRUPT_THRESHOLD = 0.65
export function createAutonomousState(): AutonomousState {
  return { enabled: false, preference: 'normal', decisions: [], observations: [], cooldownStartedAt: null,
    pending: false, error: '' }
}
/** Informational fingerprint, never used in business identity. */
function diagnosticFingerprint(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
interface Trace { sampleId: string; judgmentId?: string; judgmentSampleId?: string }

export function createAutonomousController(options: {
  state: AutonomousState; readDesktop: () => Promise<DesktopObserverStatus>; judgeDesktop: (request: DesktopJudgeRequest) => Promise<DesktopJudgeResult>
  isBusy: () => boolean; isReady: () => boolean; getCooldownMs: () => number; trigger: (stimulus: AutonomousStimulus) => void
  getReplyHistoryEnabled?: () => boolean; diagnostic?: (record: DesktopDiagnosticRecord) => void; diagnosticReplyText?: boolean; now?: () => number
  onSnapshot?: (snapshot: DesktopActivitySnapshot | undefined) => void
}) {
  const { state } = options
  const now = options.now ?? Date.now
  const observations = createDesktopObservations(state.observations, now)
  let revision = 0
  let historyEnabled = options.getReplyHistoryEnabled?.() === true
  const traces = options.diagnostic ? new WeakMap<AutonomousStimulus, Trace>() : undefined
  let previousSample: Record<string, string> | undefined

  function diagnose(type: string, details: Record<string, unknown>, trace?: Trace): void {
    if (!options.diagnostic) return
    try { options.diagnostic({ at: now(), type, ...trace, ...details }) }
    catch { /* A diagnostic sink failure cannot change product behavior. */ }
  }
  function recordDecision(source: string, outcome: AutonomousDecision['outcome'], reason: string, stimulusId?: string, candidate?: DesktopCandidate): void {
    const cached = candidate ? observations.find(candidate.id)?.judgment : undefined
    state.decisions.push({ at: now(), source, outcome, reason, preference: state.preference, stimulusId,
      candidateId: candidate?.id, objectId: candidate?.objectId,
      ...(candidate?.id === cached?.candidateId ? { score: cached?.scores.shouldInterrupt, historyIncluded: cached?.historyIncluded } : {}) })
    if (state.decisions.length > 50) state.decisions.shift()
  }
  function recordOutputDiagnostic(stimulus: AutonomousStimulus, status: string,
    details: { turnId?: string; text?: string; delivered?: boolean; reason?: string; replyHistoryWritten?: boolean;
      checkedSnapshot?: DesktopCandidate['snapshot'] } = {}): void {
    const { text, ...fields } = details
    if (!options.diagnostic) return
    diagnose(status, { ...fields, stimulusId: stimulus.id, candidateId: stimulus.candidate.id, objectId: stimulus.candidate.objectId,
      candidateSource: stimulus.candidate.source, change: stimulus.candidate.change, snapshot: stimulus.candidate.snapshot,
      targetFingerprint: diagnosticFingerprint(JSON.stringify(stimulus.candidate.target)),
      replyTarget: 'unknown', intendedTarget: stimulus.candidate.source,
      ...(text === undefined ? {} : { replyLength: text.length, replyFingerprint: diagnosticFingerprint(text) }),
      ...(status === 'delivery' && details.delivered && text !== undefined && options.diagnosticReplyText
        ? { replyText: text.slice(0, 2000), replyTextTruncated: text.length > 2000 } : {}) }, traces?.get(stimulus))
  }
  function syncHistorySetting(): void {
    const enabled = options.getReplyHistoryEnabled?.() === true
    if (enabled === historyEnabled) return
    historyEnabled = enabled
    observations.clearReplyHistory()
    observations.clearJudgments()
    revision++
    diagnose('history-setting', { enabled })
  }
  function noteHumanInteraction(): void { revision++ }
  function setPreference(preference: InteractionPreference, stimulusId: string): void {
    state.preference = preference
    revision++
    observations.clearJudgments()
    if (preference === 'quiet') observations.interrupt()
    recordDecision('user-text', 'updated', 'explicit-command', stimulusId)
    diagnose('preference', { preference, stimulusId })
  }
  function setEnabled(enabled: boolean): void {
    state.enabled = enabled
    revision++
    if (!enabled) {
      observations.interrupt()
      observations.clearJudgments()
      state.error = ''
    }
  }
  function completed(stimulus: AutonomousStimulus, delivered: boolean, text?: string): boolean {
    state.cooldownStartedAt = now()
    syncHistorySetting()
    return observations.complete(stimulus.candidate.id, delivered ? text : undefined, historyEnabled)
  }
  function logSample(context: DesktopActivitySnapshot, trace: Trace | undefined, candidate: DesktopCandidate | undefined, observation: DesktopObservation | undefined, reason: string): void {
    if (!trace) return
    const fields = { focus: diagnosticFingerprint(JSON.stringify([context.targetHwnd, context.focus.app, context.focus.title])),
      screen_text: diagnosticFingerprint(context.focus.text), media: diagnosticFingerprint(JSON.stringify(context.media)),
      mic: diagnosticFingerprint(JSON.stringify(context.mic)), idle: String(context.idleSeconds) }
    const changedFields = previousSample ? Object.keys(fields).filter(key => fields[key as keyof typeof fields] !== previousSample![key]) : Object.keys(fields)
    const compact = previousSample && changedFields.every(field => field === 'idle')
    diagnose('sample', { snapshot: { capturedAt: context.capturedAt, targetHwnd: context.targetHwnd, sequence: context.sequence },
      changedFields, initial: !previousSample, semanticChange: 'unknown', reason, candidateId: candidate?.id, objectId: candidate?.objectId,
      candidateSource: candidate?.source, change: candidate?.change,
      ...(compact ? { idleSeconds: context.idleSeconds } : { app: context.focus.app, titleFingerprint: diagnosticFingerprint(context.focus.title),
        uiaLength: context.focus.text.length, uiaFingerprint: context.textFingerprint, mediaCount: context.media.length,
        mediaFingerprints: context.media.map(item => diagnosticFingerprint(JSON.stringify(item))), micActive: context.mic.length > 0, idleSeconds: context.idleSeconds }),
      observation: observation ? { status: observation.status, deliveredAt: observation.deliveredAt, recentReplyPresent: Boolean(observation.recentReply) } : undefined }, trace)
    previousSample = fields
  }
  async function tick(): Promise<void> {
    syncHistorySetting()
    let candidate: DesktopCandidate | undefined
    let trace: Trace | undefined
    let judging = false
    const block = (reason: string) => {
      const cached = candidate ? observations.find(candidate.id)?.judgment : undefined
      recordDecision('desktop-poll', 'blocked', reason, undefined, candidate)
      diagnose('gate', { reason, outcome: 'blocked', candidateId: candidate?.id, objectId: candidate?.objectId,
        score: candidate?.id === cached?.candidateId ? cached?.scores.shouldInterrupt : undefined }, trace)
    }
    if (!state.enabled || state.preference === 'quiet' || state.pending) {
      block(!state.enabled ? 'disabled' : state.preference === 'quiet' ? 'quiet' : 'pending')
      return
    }
    const ticket = revision
    state.pending = true
    try {
      trace = options.diagnostic ? { sampleId: crypto.randomUUID() } : undefined
      const sample = await options.readDesktop()
      if (!state.enabled || ticket !== revision) { block('invalidated'); return }
      state.error = sample.error ?? ''
      try { options.onSnapshot?.(sample.enabled && sample.available ? sample.context : undefined) }
      catch { /* Optional slow processing must not affect the existing gates. */ }
      if (!sample.enabled || !sample.available || !sample.context) { observations.interrupt(); block('desktop-unavailable'); return }
      const observed = observations.observe(sample.context)
      candidate = observed.candidate
      logSample(sample.context, trace, candidate, observed.observation, observed.reason)
      if (!candidate || !observed.observation) { block(observed.reason); return }
      if (observed.observation.status !== 'new') { block(observed.observation.status === 'superseded' ? 'foreground-superseded' : 'duplicate'); return }
      if (!options.isReady()) { block('not-ready'); return }
      if (options.isBusy()) { block('busy'); return }
      const recent = observed.observation.recentReply
      const recentReply = historyEnabled && recent && sample.context.capturedAt >= recent.deliveredAt
        && sample.context.capturedAt - recent.deliveredAt <= OBSERVATION_RETENTION_MS ? recent : undefined
      const key = JSON.stringify([candidate.id, [...sample.context.mic].sort(), recentReply])
      let cached = observed.observation.judgment
      if (cached?.key !== key) {
        if (trace) { trace.judgmentId = crypto.randomUUID(); trace.judgmentSampleId = trace.sampleId }
        diagnose('judge-requested', { candidateId: candidate.id, objectId: candidate.objectId, candidateSource: candidate.source,
          targetFingerprint: options.diagnostic ? diagnosticFingerprint(JSON.stringify(candidate.target)) : undefined,
          change: candidate.change, snapshot: candidate.snapshot, historyRequested: Boolean(recentReply), mode: 'requested' }, trace)
        judging = true
        const judged = await options.judgeDesktop({ candidate, ...(recentReply ? { recentReply } : {}),
          ...(trace?.judgmentId ? { diagnostic: { sampleId: trace.sampleId, judgmentId: trace.judgmentId } } : {}) })
        judging = false
        diagnose('judge-returned', { score: judged.scores.shouldInterrupt, historyIncluded: judged.historyIncluded === true }, trace)
        if (!state.enabled || ticket !== revision) { diagnose('judge-discarded', { reason: 'invalidated' }, trace); block('invalidated'); return }
        const expected = candidate.snapshot
        if (judged.context.capturedAt !== expected.capturedAt || judged.context.targetHwnd !== expected.targetHwnd || judged.context.sequence !== expected.sequence) {
          diagnose('judge-discarded', { reason: 'snapshot-changed' }, trace); block('snapshot-changed'); return
        }
        if (observed.observation.status !== 'new') {
          const reason = observed.observation.status === 'superseded' ? 'foreground-superseded' : 'duplicate'
          diagnose('judge-discarded', { reason, candidateId: candidate.id }, trace); block(reason); return
        }
        cached = { key, candidateId: candidate.id, scores: judged.scores, historyIncluded: judged.historyIncluded === true, trace }
        observed.observation.judgment = cached
        diagnose('judge-accepted', { candidateId: candidate.id, score: judged.scores.shouldInterrupt, historyIncluded: cached.historyIncluded }, trace)
      }
      else if (trace) {
        trace = { ...cached.trace, sampleId: trace.sampleId }
        diagnose('judge-cached', { candidateId: candidate.id, objectId: candidate.objectId, mode: 'cached', score: cached.scores.shouldInterrupt }, trace)
      }
      if (!options.isReady()) { block('not-ready'); return }
      if (options.isBusy()) { block('busy'); return }
      if (cached.scores.shouldInterrupt < SHOULD_INTERRUPT_THRESHOLD) { block('below-threshold'); return }
      if (state.cooldownStartedAt !== null && now() < state.cooldownStartedAt + options.getCooldownMs()) { block('cooldown'); return }
      // Media judgments can take seconds. Revalidate only this time-sensitive
      // target before starting Chat, without another model judgment.
      if (candidate.source === 'media') {
        const fresh = await options.readDesktop()
        if (!state.enabled || ticket !== revision) { block('invalidated'); return }
        if (!fresh.enabled || !fresh.available || !fresh.context || now() - fresh.context.capturedAt > CAPTURE_MAX_GAP_MS || !mediaCandidateMatches(candidate, fresh.context)) {
          diagnose('judge-discarded', { reason: 'media-stale', candidateId: candidate.id }, trace)
          if (fresh.context) observations.observe(fresh.context)
          block('media-stale'); return
        }
        // Keep the judged target and identity; explicitly bind the generation to the fresh capture.
        candidate = { ...candidate, snapshot: { capturedAt: fresh.context.capturedAt, targetHwnd: fresh.context.targetHwnd, sequence: fresh.context.sequence } }
        diagnose('media-revalidated', { candidateId: candidate.id, snapshot: candidate.snapshot }, trace)
      }
      if (!options.isReady()) { block('not-ready'); return }
      if (options.isBusy()) { block('busy'); return }
      const stimulus = createAutonomousStimulus({ candidate, at: now() })
      if (trace) traces!.set(stimulus, { ...trace })
      observations.reserve(candidate.id)
      state.cooldownStartedAt = now()
      recordDecision(stimulus.source, 'allowed', 'gate-passed', stimulus.id, candidate)
      diagnose('gate', { reason: 'allowed', outcome: 'allowed', candidateId: candidate.id, objectId: candidate.objectId,
        stimulusId: stimulus.id, score: cached.scores.shouldInterrupt }, trace)
      options.trigger(stimulus)
    }
    catch (error) {
      diagnose(judging ? 'judge-failed' : 'poll-failed', { reason: ticket !== revision ? 'invalidated' : 'judge-or-capture-error' }, trace)
      block(ticket !== revision ? 'invalidated' : 'judge-or-capture-error')
      if (state.enabled && ticket === revision) state.error = error instanceof Error ? error.message : String(error)
    }
    finally { state.pending = false }
  }
  return { tick, noteHumanInteraction, setEnabled, setPreference, syncHistorySetting, recordDecision, recordOutputDiagnostic, completed }
}
