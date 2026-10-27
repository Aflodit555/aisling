import { normalizeAutonomousContext } from '@aisling/core'
import type { ConversationSession } from '../conversation/conversation-store'
import { recallQuery, safeText, terms } from './memory-recall'
import { sourceRef } from './reflection-formation'
import { validReflection, type ReflectionState } from './reflection-store'

export const REFLECTION_RECALL_LIMITS = { topK: 3, chars: 1500, bytes: 4500, minScore: 1, minTerms: 2 } as const

/** Cache only validated persisted state; source messages are rechecked against each turn's snapshot. */
export function createReflectionRecall(read: () => ReflectionState) {
  let cached: ReflectionState | undefined
  return {
    invalidate() { cached = undefined },
    retrieve(sessions: readonly ConversationSession[], activeId: string, query: string) {
      const start = performance.now()
      const result = (candidates: string[], reason: string) => ({ candidates, reason, durationMs: performance.now() - start })
      if (!safeText(query)) return result([], 'unsafe-query')
      let state: ReflectionState
      try { state = cached ??= read() }
      catch { return result([], 'storage-error') }
      // Capture before the first await; a later Formation commit belongs to the next turn.
      const completed = new Set(state.batches.filter(b => b.status === 'completed').flatMap(b => b.reflectionIds))
      const queryTerms = new Set(terms(recallQuery(query, sessions.find(s => s.id === activeId))))
      if (!state.reflections.length) return result([], 'empty')
      if (queryTerms.size < REFLECTION_RECALL_LIMITS.minTerms) return result([], 'no-match')
      const docs = state.reflections.filter(r => completed.has(r.id) && validReflection(r)).map(r => {
        const tokens = terms(`${r.content} ${r.kind} ${r.basis} ${r.tags.join(' ')} ${r.uncertainty ?? ''}`)
        const tf = new Map<string, number>()
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
        return { r, tf, length: tokens.length }
      })
      const df = new Map<string, number>()
      for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
      const average = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1)
      const ranked = docs.map(d => {
        let score = 0, matched = 0
        for (const t of queryTerms) {
          const tf = d.tf.get(t) ?? 0
          if (!tf) continue
          matched++
          score += Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
            * (/^[a-z0-9]+$/.test(t) ? 2 : 1) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / average))
        }
        return { ...d, score, matched }
      }).filter(d => d.score >= REFLECTION_RECALL_LIMITS.minScore && d.matched >= REFLECTION_RECALL_LIMITS.minTerms)
        .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id)).slice(0, REFLECTION_RECALL_LIMITS.topK)
      if (!ranked.length) return result([], 'no-match')
      return (async () => {
        const candidates: string[] = []
        let reason = 'invalid-source'
        for (const { r } of ranked) {
          const statement = `${r.content} ${r.tags.join(' ')} ${r.uncertainty ?? ''}`
          if (!safeText(statement) || /\b[ER]\d+\b/.test(statement)
            || [r.id, ...r.relatedReflectionIds, ...r.sourceRefs.map(ref => ref.sessionId)].some(id => statement.includes(id))) continue
          const sources = []
          for (const ref of r.sourceRefs) {
            const message = sessions.find(s => s.id === ref.sessionId)?.messages[ref.messageIndex]
            if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
              || !safeText(message.content) || message.toolCalls?.length || message.toolCallId) break
            try { if ((await sourceRef(ref.sessionId, ref.messageIndex, message)).digest !== ref.digest) break }
            catch { break }
            const autonomous = message.role === 'assistant' && normalizeAutonomousContext(message.autonomousContext)
            sources.push({ role: message.role, sourceScope: autonomous ? 'stored-autonomous-utterance'
              : message.role === 'user' ? 'stored-user-report' : 'stored-assistant-utterance' })
          }
          if (sources.length !== r.sourceRefs.length
            || (['fact', 'preference', 'project-state'].includes(r.kind) && sources.every(s => s.role === 'assistant'))
            || (r.kind === 'pattern' && (sources.length < 2 || !r.uncertainty))) continue
          const candidate = JSON.stringify({ content: r.content, kind: r.kind, basis: r.basis, tags: r.tags,
            sources, ...(r.uncertainty ? { uncertainty: r.uncertainty } : {}) })
          const packed = `[${[...candidates, candidate].join(',')}]`
          if (packed.length > REFLECTION_RECALL_LIMITS.chars || new TextEncoder().encode(packed).length > REFLECTION_RECALL_LIMITS.bytes) {
            reason = 'candidate-budget'; continue
          }
          candidates.push(candidate)
        }
        return result(candidates, candidates.length ? 'selected' : reason)
      })()
    },
  }
}
