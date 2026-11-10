import type { ChatProvider } from '@aisling/core'
import type { EvidenceRef } from '../../../stage-desktop/memory-database/store'
import { formationInput, limits, parseNoteProposals, type NoteFormationContext } from '../../../stage-desktop/note-formation-contract.mjs'
import speakers from '../../../stage-desktop/memory-subjects.json'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef, withRelatedHistory, type FormationEvidence } from './formation-evidence'
import { safeText } from './memory-recall'

type Attempt = { id: string; attempt: number; sessionId: string; refs: EvidenceRef[] }
export interface NoteFormationBridge {
  delivered(sessionId: string, indices: number[]): Promise<void>
  flush(sessionId: string): Promise<void>
  next(): Promise<Attempt | null>
  prepare(id: string, attempt: number, history: EvidenceRef[]): Promise<NoteFormationContext>
  submit(id: string, attempt: number, raw: string): Promise<void>
  fail(id: string, attempt: number, reason: string): Promise<void>
}

export function createNoteFormation(bridge: NoteFormationBridge, getSessions: () => ConversationSession[], getEnableThinking: () => false | undefined) {
  let provider: ChatProvider | undefined
  let epoch = 0, pumping = false, requested = false
  let active: AbortController | undefined

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
    let error = 'provider-error'
    const stillCurrent = () => {
      if (ticket !== epoch) throw new Error('cancelled')
    }
    try {
      stillCurrent()
      const current = await resolve(job.refs)
      const evidence = await withRelatedHistory(job.sessionId, current, getSessions, sources => {
        formationInput({ notes: [], speakers, evidence: sources.map(source => ({
          ref: source.ref, message: source.message as NoteFormationContext['evidence'][number]['message'],
          scope: source.scope === 'related-history' ? 'history' : 'current',
        })) })
      })
      stillCurrent()
      const context = await bridge.prepare(job.id, job.attempt, evidence.slice(current.length).map(e => e.ref))
      await resolve(context.evidence.map(e => e.ref))
      stillCurrent()
      const { messages } = formationInput(context)
      const output = await Promise.race([
        selected.complete({ messages, temperature: 0.2, maxOutputTokens: 1500, enableThinking: getEnableThinking(), signal: controller.signal }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error(error === 'timeout' ? error : 'cancelled')), { once: true })
          timer = setTimeout(() => { error = 'timeout'; controller.abort() }, limits.timeoutMs)
        }),
      ])
      stillCurrent()
      if (output.toolCalls?.length) throw new Error('invalid-proposal')
      error = 'invalid-proposal'
      parseNoteProposals(output.text, context)
      await resolve(context.evidence.map(e => e.ref))
      stillCurrent()
      await bridge.submit(job.id, job.attempt, output.text)
    } catch (cause) {
      const reason = ticket !== epoch ? 'cancelled' : cause instanceof Error
        && ['invalid-json', 'input-limit', 'source-changed'].includes(cause.message) ? cause.message : error
      await bridge.fail(job.id, job.attempt, reason)
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
          const job = await bridge.next()
          if (!job) break
          await generate(job, selected, ticket)
        }
      }
    } catch { /* Main persists unfinished work and checks receipts on the next wake. */ }
    finally { pumping = false }
  }

  function wake() { requested = true; void pump() }
  return {
    setProvider(next: ChatProvider | undefined) {
      if (next === provider) return
      provider = next
      epoch++
      active?.abort()
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
