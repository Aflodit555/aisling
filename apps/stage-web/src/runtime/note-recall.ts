import { isValidTimestamp } from '@aisling/core'
import type { ReflectionRecallContext } from '@aisling/core/legacy-recall'
import type { ConversationSession } from '../conversation/conversation-store'
import { rankNoteHeads, type OrganizationBridge } from './note-organization'
import { recallQuery, safeText, terms } from './memory-recall'
import { sourceRef } from './reflection-formation'
import speakers from '../../../stage-desktop/memory-subjects.json'

export interface NoteRecallTrace {
  reason: string
  durationMs: number
  excluded: number
  candidates: Array<{ id: string; version: number; subject: string; outcome: string; origins: string[];
    sources: Array<{ sessionId: string; messageIndex: number }> }>
  injected: string[]
}

const comparisonText = (text: string) => text.normalize('NFKC').trim().replace(/\s+/gu, ' ')
const iso = (time: unknown) => isValidTimestamp(time) ? new Date(time).toISOString() : 'unknown'

export async function prepareNoteRecall(read: NonNullable<OrganizationBridge['recallHeads']>, sessions: ConversationSession[],
  activeId: string, query: string, current: () => boolean, trace: (value: NoteRecallTrace) => void): Promise<ReflectionRecallContext['appendNotes']> {
  const start = performance.now()
  const result: NoteRecallTrace = { reason: 'no-match', durationMs: 0, excluded: 0, candidates: [], injected: [] }
  const finish = (reason: string) => {
    result.reason = reason
    result.durationMs = performance.now() - start
    if (current()) trace(result)
    return undefined
  }
  if (!safeText(query)) return finish('unsafe-query')
  const text = recallQuery(query, sessions.find(session => session.id === activeId))
  const queryTerms = new Set(terms(text).filter(term => term.length > 1))
  if (!queryTerms.size) return finish('no-match')
  let cancelTimeout = () => {}
  try {
    const deadline = new Promise<undefined>(resolve => {
      const timer = setTimeout(() => resolve(undefined), 75)
      cancelTimeout = () => clearTimeout(timer)
    })
    const snapshot = await Promise.race([read(), deadline])
    if (!snapshot) return finish('database-timeout')
    if (!current() || snapshot.reason !== 'ready') return finish(snapshot.reason)
    result.excluded = snapshot.excluded
    const eligible = snapshot.notes.filter(({ note }) => note.status === 'active'
      && (note.basis === 'direct' || !!note.uncertainty) && safeText([note.content, note.subject, note.uncertainty].join(' '))
      && terms(note.content).some(term => queryTerms.has(term)))
    const ranked = rankNoteHeads(text, eligible)
    result.excluded += snapshot.notes.length - ranked.length
    const pool: Array<{ json: string; key: string; rawKey?: string; candidate: NoteRecallTrace['candidates'][number] }> = []
    for (const { note, grounds } of ranked) {
      const candidate = { id: note.id, version: note.version, subject: note.subject, outcome: 'invalid-source',
        origins: grounds.origins.map(origin => origin.reflectionId),
        sources: grounds.evidence.map(({ sessionId, messageIndex }) => ({ sessionId, messageIndex })) }
      result.candidates.push(candidate)
      const messages = []
      for (const ref of grounds.evidence) {
        const matching = sessions.filter(session => session.id === ref.sessionId)
        const message = matching[0]?.messages[ref.messageIndex]
        if (matching.length !== 1 || !message || (message.role !== 'user' && message.role !== 'assistant')
          || typeof message.content !== 'string' || message.noteDerived || !safeText(message.content) || message.toolCalls?.length || message.toolCallId
          || (await sourceRef(ref.sessionId, ref.messageIndex, message)).digest !== ref.digest) break
        messages.push(message)
      }
      if (!messages.length || messages.length !== grounds.evidence.length) continue
      if (grounds.evidence.every(ref => ref.sessionId === activeId)) {
        candidate.outcome = 'current-session'
        continue
      }
      const first = messages[0]!
      const speaker = first.role === 'user' ? speakers.user : speakers.assistant
      const speech = messages.length === 1 && note.basis === 'direct' && note.subject === speaker.subject
        && note.content === speaker.prefix + first.content
      const key = JSON.stringify([note.basis, note.uncertainty ?? '', comparisonText(note.content)])
      const restated = note.basis === 'direct' && !note.uncertainty && first.role === 'user' && note.subject === speakers.user.subject
        && note.content.startsWith('用户自述') && comparisonText(note.content.replace(/^用户自述/u, '我')) === comparisonText(first.content!)
      const rawKey = speech || restated ? first.role + ':' + comparisonText(first.content!) : undefined
      const json = JSON.stringify({ kind: speech ? 'note-speech-event' : 'note-understanding', content: note.content,
        subject: note.subject, basis: note.basis, uncertainty: note.uncertainty, version: note.version,
        storedAt: iso(note.createdAt), eventTime: note.eventTime,
        sources: messages.map(message => ({ role: message.role, at: iso(message.createdAt) })) })
      pool.push({ json, key, rawKey, candidate })
    }
    if (!pool.length) return finish(ranked.length ? 'sources-excluded' : 'no-match')
    result.durationMs = performance.now() - start
    return (reflections, rawEvidence, fits) => {
      if (!current()) return []
      type Evidence = { content: string; role?: string; basis?: string; uncertainty?: string }
      const reflectionKeys = new Set(reflections.map(item => JSON.parse(item) as Evidence)
        .map(item => JSON.stringify([item.basis, item.uncertainty ?? '', comparisonText(item.content)])))
      const rawKeys = new Set((rawEvidence ? JSON.parse(rawEvidence) as Evidence[] : [])
        .map(item => item.role + ':' + comparisonText(item.content)))
      const selected: string[] = []
      for (const item of pool) {
        if (reflectionKeys.has(item.key) || (item.rawKey && rawKeys.has(item.rawKey))) item.candidate.outcome = 'duplicate'
        else if (!fits([...selected, item.json])) item.candidate.outcome = 'budget'
        else {
          selected.push(item.json)
          reflectionKeys.add(item.key)
          item.candidate.outcome = 'injected'
        }
      }
      trace({ ...result, reason: selected.length ? 'injected' : 'deduplicated-or-budget', injected: selected })
      return selected
    }
  }
  catch { return finish('unavailable') }
  finally { cancelTimeout() }
}
