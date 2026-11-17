import type { ChatProvider } from '@aisling/core'
import type { EvidenceRef } from '../../../stage-desktop/memory-database/store'
import { formationInput, limits, parseNoteBatch, type NoteFormationContext } from '../../../stage-desktop/note-formation-contract.mjs'
import speakers from '../../../stage-desktop/memory-subjects.json'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef, withRelatedHistory, type FormationEvidence } from './formation-evidence'
import { safeText } from './memory-recall'
import { organizationInput, parseSemanticRelations, semanticLimits } from '../../../stage-desktop/note-semantic-contract.mjs'
import { formationFailure, type FormationFailure } from '../../../stage-desktop/note-formation-errors.mjs'

type Attempt = { id: string; attempt: number; sessionId: string; refs: EvidenceRef[]; kind?: 'organization' }
export interface NoteFormationBridge {
  delivered(sessionId: string, indices: number[]): Promise<void>
  flush(sessionId: string): Promise<void>
  next(allowSemantic?: boolean): Promise<Attempt | null>
  prepare(id: string, attempt: number, history: EvidenceRef[]): Promise<NoteFormationContext>
  submit(id: string, attempt: number, raw: string): Promise<void>
  fail(id: string, attempt: number, reason: string | Pick<FormationFailure, 'code' | 'phase'>): Promise<void>
}

export interface FormationBatchStatus {
  id: string; status: string; attempts: number; autoRetries: number; retryAt?: number; failure?: FormationFailure
  history: Array<{ attempt: number; startedAt: number | null; recordedAt?: number; endedAt?: number; outcome: string; failure?: FormationFailure; settlementFailures?: FormationFailure[] }>
  applied: number; rejected: number; reviewRequired: number; skipped: number; outcomeUnknown: number; retryBlocked: string
  issues: Array<FormationFailure & { status: string }>
}
export interface FormationStatus {
  counts: Record<string, number>
  batches: FormationBatchStatus[]
}

export function createNoteFormation(bridge: NoteFormationBridge, getSessions: () => ConversationSession[], getEnableThinking: () => false | undefined,
  isChatBusy: () => boolean = () => false) {
  let provider: ChatProvider | undefined
  let epoch = 0, pumping = false, requested = false
  let active: AbortController | undefined
  let poll: ReturnType<typeof setTimeout> | undefined

  async function resolve(refs: EvidenceRef[]): Promise<FormationEvidence[]> {
    const sessions = getSessions()
    return Promise.all(refs.map(async ref => {
      const matching = sessions.filter(session => session.id === ref.sessionId)
      const message = matching[0]?.messages[ref.messageIndex]
      if (matching.length !== 1 || !message || !['user', 'assistant'].includes(message.role)
        || typeof message.content !== 'string' || !safeText(message.content) || message.noteDerived
        || message.toolCalls?.length || message.toolCallId || (await sourceRef(ref.sessionId, ref.messageIndex, message)).digest !== ref.digest)
        throw new Error('source-changed')
      return { ref, message }
    }))
  }

  async function generate(job: Attempt, selected: ChatProvider, ticket: number) {
    const controller = new AbortController()
    active = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    let phase: FormationFailure['phase'] = 'source'
    let timedOut = false
    const stillCurrent = () => {
      if (ticket !== epoch) throw new Error('cancelled')
    }
    try {
      stillCurrent()
      const current = await resolve(job.refs)
      const evidence = job.kind === 'organization' ? current : await withRelatedHistory(job.sessionId, current, getSessions, sources => {
        formationInput({ notes: [], speakers, evidence: sources.map(source => ({
          ref: source.ref, message: source.message as NoteFormationContext['evidence'][number]['message'],
          scope: source.scope === 'related-history' ? 'history' : 'current',
        })) })
      })
      stillCurrent()
      phase = 'prepare'
      const context = await bridge.prepare(job.id, job.attempt, evidence.slice(current.length).map(e => e.ref))
      phase = 'source'
      await resolve(context.evidence.map(e => e.ref))
      stillCurrent()
      const semantic = context.mode === 'organization'
      const { messages } = semantic ? organizationInput(context) : formationInput(context)
      phase = 'provider'
      const output = await Promise.race([
        selected.complete({ messages, temperature: 0.2, maxOutputTokens: semantic ? semanticLimits.outputTokens : 1500, enableThinking: getEnableThinking(), signal: controller.signal }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error(timedOut ? 'timeout' : 'cancelled')), { once: true })
          timer = setTimeout(() => { timedOut = true; controller.abort() }, semantic ? semanticLimits.timeoutMs : limits.timeoutMs)
        }),
      ])
      stillCurrent()
      phase = 'parse'
      if (output.toolCalls?.length) throw new Error('unexpected-tools')
      if (semantic) parseSemanticRelations(output.text, context)
      else parseNoteBatch(output.text, context)
      phase = 'source'
      await resolve(context.evidence.map(e => e.ref))
      stillCurrent()
      phase = 'submit'
      await bridge.submit(job.id, job.attempt, output.text)
    } catch (cause) {
      const failure = formationFailure(ticket !== epoch ? 'cancelled' : timedOut ? 'timeout' : cause, phase)
      await bridge.fail(job.id, job.attempt, failure.code === 'cancelled' ? 'cancelled' : { code: failure.code, phase: failure.phase })
    } finally {
      clearTimeout(timer)
      active = undefined
    }
  }

  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (provider && requested) {
        requested = false
        const ticket = epoch, selected = provider
        while (ticket === epoch) {
          const job = await bridge.next(!isChatBusy())
          if (!job) break
          await generate(job, selected, ticket)
        }
      }
    } catch { /* Main persists unfinished work and checks receipts on the next wake. */ }
    finally { pumping = false }
  }

  function wake() { requested = true; void pump() }
  function pollIdle() {
    clearTimeout(poll)
    if (!provider) return
    poll = setTimeout(() => { if (!isChatBusy()) wake(); pollIdle() }, 15_000)
  }
  return {
    wake,
    setProvider(next: ChatProvider | undefined) {
      if (next === provider) return
      provider = next
      epoch++
      active?.abort()
      pollIdle()
      if (provider) wake()
    },
    delivered(sessionId: string, indices: number[]) {
      if (provider) void bridge.delivered(sessionId, indices).then(wake, () => {})
    },
    flush(sessionId: string) {
      if (provider) void bridge.flush(sessionId).then(wake, () => {})
    },
  }
}
