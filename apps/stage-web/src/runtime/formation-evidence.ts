import type { ConversationMessage } from '@aisling/core'
import type { EvidenceRef } from '../../../stage-desktop/memory-database/store'
import type { ConversationSession } from '../conversation/conversation-store'
import { retrieveRecall } from './memory-recall'

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
  fits: (evidence: FormationEvidence[]) => void): Promise<FormationEvidence[]> {
  const selected = [...current]
  if (selected.length >= 12) return selected
  try {
    const sessions = getSessions()
    const reports = current.filter(e => e.message.role === 'user')
    // Historical support is for attempts/outcomes, not another pass over unrelated old states.
    const experience = (text: string | null) => typeof text === 'string' && /本来|原本|尝试|练习|目标|任务|计划|\b(?:tried|practice|goal|task|plan)\b/iu.test(text)
      && /完成|做完|练完|没开始|未开始|没动笔|没有动笔|拖延|结果|失败|成功|\b(?:finished|completed|failed|stalled|outcome)\b/iu.test(text)
    if (!reports.some(e => experience(e.message.content))) return selected
    const query = (reports.length ? reports : current).map(e => e.message.content).join('\n').slice(0, 3000)
    const recalled = retrieveRecall(sessions, sessionId, query)
    if (!recalled.evidence) return selected
    const records = JSON.parse(recalled.evidence) as Array<{ sessionId: string; messageIndex: number }>
    // Keep each retrieved session together, including corrections; never register it as new work.
    for (const id of recalled.sessionIds) {
      const group = records.filter(r => r.sessionId === id)
      if (selected.length + group.length > 12) continue
      const session = sessions.find(s => s.id === id)!
      if (!group.some(r => { const message = session.messages[r.messageIndex]!; return message.role === 'user' && experience(message.content) })) continue
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
