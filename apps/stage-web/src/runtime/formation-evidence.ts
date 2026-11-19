import type { ConversationMessage } from '@aisling/core'
import type { EvidenceRef } from '../../../stage-desktop/memory-database/store'
import type { ConversationSession } from '../conversation/conversation-store'
import { retrieveRecall, safeText } from './memory-recall'

export interface FormationEvidence {
  ref: EvidenceRef
  message: ConversationMessage
  scope?: 'current-batch' | 'related-history'
  sessionTime?: { createdAt?: number; updatedAt?: number }
}

export async function sourceRef(sessionId: string, messageIndex: number, message: ConversationMessage): Promise<EvidenceRef> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(message)))
  return { sessionId, messageIndex, digest: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') }
}

export async function withRelatedHistory(sessionId: string, current: FormationEvidence[], getSessions: () => ConversationSession[],
  fits: (evidence: FormationEvidence[]) => void, noteContext = false): Promise<FormationEvidence[]> {
  const selected = [...current]
  if (selected.length >= 12) return selected
  try {
    const sessions = getSessions()
    if (noteContext) {
      const matching = sessions.filter(s => s.id === sessionId)
      const first = Math.min(...current.map(e => e.ref.messageIndex))
      if (matching.length !== 1 || !Number.isSafeInteger(first) || first < 0) return selected
      const start = Math.max(0, first - Math.min(4, 12 - selected.length))
      const messages = matching[0]!.messages.slice(start, first)
      // Keep the nearby window together; never skip a correction, unsafe text or a tool result inside it.
      if (messages.length && messages.every(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'
        && safeText(m.content) && !m.noteDerived && !m.toolCalls?.length && !m.toolCallId)) {
        const extra = await Promise.all(messages.map(async (message, i) => ({
          ref: await sourceRef(sessionId, start + i, message), message, scope: 'related-history' as const,
        })))
        try { fits([...selected, ...extra]); selected.push(...extra) } catch { /* Optional context never displaces the batch. */ }
      }
    }
    const reports = current.filter(e => e.message.role === 'user')
    // Historical support is for attempts/outcomes, not another pass over unrelated old states.
    const experience = (text: string | null) => typeof text === 'string' && /本来|原本|尝试|练习|目标|任务|计划|\b(?:tried|practice|goal|task|plan)\b/iu.test(text)
      && /完成|做完|练完|没开始|未开始|没动笔|没有动笔|拖延|结果|失败|成功|\b(?:finished|completed|failed|stalled|outcome)\b/iu.test(text)
    if (!noteContext && !reports.some(e => experience(e.message.content))) return selected
    const queryReports = noteContext ? selected.filter(e => e.message.role === 'user') : reports
    const query = (queryReports.length ? queryReports : current).map(e => e.message.content).join('\n').slice(0, 3000)
    const recalled = retrieveRecall(sessions, sessionId, query)
    if (!recalled.evidence) return selected
    const records = JSON.parse(recalled.evidence) as Array<{ sessionId: string; messageIndex: number }>
    // Keep each retrieved session together, including corrections; never register it as new work.
    for (const id of recalled.sessionIds) {
      const group = records.filter(r => r.sessionId === id)
      if (selected.length + group.length > 12) continue
      const matching = sessions.filter(s => s.id === id)
      if (!matching.length || noteContext && matching.length !== 1) continue
      const session = matching[0]!
      if (noteContext && session.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'
        || !safeText(m.content) || m.noteDerived || m.toolCalls?.length || m.toolCallId)) continue
      if (!group.some(r => { const message = session.messages[r.messageIndex]!; return message.role === 'user' && (noteContext || experience(message.content)) })) continue
      const extra = await Promise.all(group.map(async r => {
        const message = session.messages[r.messageIndex]!
        return { ref: await sourceRef(id, r.messageIndex, message), message, scope: 'related-history' as const,
          sessionTime: { createdAt: session.createdAt || undefined, updatedAt: session.updatedAt || undefined } }
      }))
      try { fits([...selected, ...extra]); selected.push(...extra) }
      catch { /* Optional history must fit the current batch's existing budgets. */ }
    }
  }
  catch { /* Missing/over-budget history leaves the current batch usable. */ }
  return selected
}

/** Current Note context; the narrower selector remains for frozen P3 comparisons. */
export const withNoteHistory = (sessionId: string, current: FormationEvidence[], getSessions: () => ConversationSession[],
  fits: (evidence: FormationEvidence[]) => void) => withRelatedHistory(sessionId, current, getSessions, fits, true)
