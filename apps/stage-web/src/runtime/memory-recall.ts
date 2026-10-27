import { isValidTimestamp, normalizeAutonomousContext } from '@aisling/core'
import type { ConversationSession } from '../conversation/conversation-store'

export const RECALL_LIMITS = { topK: 5, minScore: 1, minTerms: 2, chars: 6000, bytes: 6000, scanChars: 250_000, scanMs: 30 } as const

export interface RecallSource {
  label: string
  sessionId: string
  messageIndex: number
  messageId: null
}

interface RecallRecord {
  sessionId: string
  messageIndex: number
  messageId: null
  role: string
  content: string
  sourceScope: string
  createdAt?: number
  sessionTime?: { createdAt?: number; updatedAt?: number }
  autonomousBasis?: unknown
}

/** Labels retain relevance priority; presentation preserves source order and known chronology. */
export function recallForModel(evidence: string): { evidence: string; sources: RecallSource[] } {
  const records = JSON.parse(evidence) as RecallRecord[]
  const iso = (value: unknown) => isValidTimestamp(value) ? new Date(value).toISOString() : undefined
  const conversations = new Map<string, string>()
  const sources: RecallSource[] = []
  const projected = records.map((r, index) => {
    const label = `E${index + 1}`
    if (!conversations.has(r.sessionId)) conversations.set(r.sessionId, `C${conversations.size + 1}`)
    sources.push({ label, sessionId: r.sessionId, messageIndex: r.messageIndex, messageId: r.messageId })
    const basis = normalizeAutonomousContext(r.autonomousBasis)
    const safeBasis = basis && { source: basis.source, change: basis.change, app: basis.app, title: basis.title,
      artist: basis.artist, excerpt: basis.excerpt,
      ...(basis.observedAt === undefined ? {} : { observedAt: new Date(basis.observedAt).toISOString() }),
      deliveredAt: new Date(basis.deliveredAt).toISOString() }
    const at = isValidTimestamp(r.createdAt) ? r.createdAt : basis?.deliveredAt
    const sessionTime = r.sessionTime && { createdAt: iso(r.sessionTime.createdAt), updatedAt: iso(r.sessionTime.updatedAt) }
    return { label, conversation: conversations.get(r.sessionId)!, role: r.role, sourceScope: r.sourceScope,
      position: r.messageIndex + 1, content: r.content,
      time: at === undefined ? 'unknown' : { kind: isValidTimestamp(r.createdAt) ? 'message-created' : 'utterance-delivered', at: iso(at) },
      ...(sessionTime ? { sessionTime } : {}), ...(safeBasis ? { autonomousBasis: safeBasis } : {}) }
  })
  const groups = [...conversations.values()].map(conversation => {
    const messages = projected.filter(r => r.conversation === conversation)
    const sessionTime = messages.find(r => r.sessionTime)?.sessionTime
    if (sessionTime && (sessionTime.createdAt || sessionTime.updatedAt)) {
      for (const message of messages) if (message.time === 'unknown') message.time = 'session-only'
    }
    const times = messages.map(r => typeof r.time === 'object' ? Date.parse(r.time.at!) : undefined)
    const range = times.every((t): t is number => t !== undefined)
      ? [Math.min(...times), Math.max(...times)]
      : sessionTime?.createdAt && sessionTime.updatedAt && Date.parse(sessionTime.createdAt) <= Date.parse(sessionTime.updatedAt)
        ? [Math.min(Date.parse(sessionTime.createdAt), ...times.filter((t): t is number => t !== undefined)),
            Math.max(Date.parse(sessionTime.updatedAt), ...times.filter((t): t is number => t !== undefined))] : undefined
    return { messages, range }
  })
  const ordered: typeof projected = []
  // Only disjoint ranges establish cross-session order; ties/overlap/unknown keep stable priority.
  while (groups.length) {
    const index = groups.findIndex(g => !groups.some(other => g.range && other.range && other.range[1]! < g.range[0]!))
    ordered.push(...groups.splice(index, 1)[0]!.messages)
  }
  return { evidence: JSON.stringify(ordered), sources }
}

// Keep original quotations or exclude them entirely; never silently rewrite evidence.
export function safeText(text: string): boolean {
  return !!text.trim() && text.length <= 3000 && !/^\s*\[image\]\s*$/i.test(text)
    && !/password|api.?key|access.?token|secret|验证码|密码|口令|密钥|令牌|身份证|银行卡|\bsk-[\w-]{8,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{7,}|[A-Za-z0-9_+/=-]{32,}/i.test(text)
}

export function terms(text: string): string[] {
  const result: string[] = []
  for (const run of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (/^[a-z0-9]/.test(run)) { result.push(run); continue }
    const chars = [...run]
    for (let i = 0; i < chars.length; i++) {
      result.push(chars[i]!)
      if (i + 1 < chars.length) result.push(chars[i]! + chars[i + 1]!)
    }
  }
  return result
}

function isVagueFollowup(text: string): boolean {
  const plain = text.normalize('NFKC').replace(/[\s，。！？、,.!?]/gu, '')
  return /^(?:(?:你)?还记得(?:有)?什么(?:吗|呢)?|还有(?:什么)?(?:吗|呢)?|然后呢|继续(?:说)?|再说说|具体呢|为什么|你确定吗|真的吗)$/u.test(plain)
}

export function recallQuery(query: string, session: ConversationSession | undefined): string {
  if (!isVagueFollowup(query)) return query
  // Only recent user text anchors retrieval; assistant guesses never supply the topic.
  for (const message of (session?.messages ?? []).slice(-12).reverse()) {
    if (message.role !== 'user' || typeof message.content !== 'string' || isVagueFollowup(message.content)) continue
    return message.content.length <= 300 && !message.content.startsWith('[image]') && safeText(message.content)
      ? `${message.content}\n${query}` : query
  }
  return query
}

/** Fresh read-only projection every turn. No index/cache can retain deleted sessions. */
export function retrieveRecall(sessions: readonly ConversationSession[], activeId: string, query: string) {
  const start = performance.now()
  const empty = () => ({ evidence: undefined as string | undefined, sessionIds: [] as string[], rankedSessionIds: [] as string[],
    packingOmittedSessionIds: [] as string[], records: 0 })
  if (!safeText(query)) return empty()
  const active = sessions.find(s => s.id === activeId)
  const queryTerms = new Set(terms(recallQuery(query, active)))
  if (queryTerms.size < RECALL_LIMITS.minTerms) return empty()
  const current = new Set(sessions.filter(s => s.id === activeId).flatMap(s => s.messages.map(m => m.content)))
  let scanned = 0
  const docs = []
  for (const session of sessions) {
    if (session.id === activeId || !/^[\w-]{1,128}$/.test(session.id)) continue
    const records: RecallRecord[] = []
    for (const [messageIndex, message] of session.messages.entries()) {
      scanned += message.content?.length ?? 0
      if (scanned > RECALL_LIMITS.scanChars || performance.now() - start > RECALL_LIMITS.scanMs) return empty()
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string'
        || message.toolCalls?.length || message.toolCallId || current.has(message.content) || !safeText(message.content)) continue
      const basis = message.role === 'assistant' ? normalizeAutonomousContext(message.autonomousContext) : undefined
      records.push({ sessionId: session.id, messageIndex, messageId: null, role: message.role,
        sourceScope: basis ? 'stored-autonomous-utterance' : message.role === 'user' ? 'stored-user-report' : 'stored-assistant-utterance',
        content: message.content, ...(isValidTimestamp(message.createdAt) ? { createdAt: message.createdAt } : {}),
        ...(basis ? { autonomousBasis: basis } : {}) })
    }
    if (!records.length) continue
    const sessionTime = {
      ...(isValidTimestamp(session.createdAt) && session.createdAt > 0 ? { createdAt: session.createdAt } : {}),
      ...(isValidTimestamp(session.updatedAt) && session.updatedAt > 0 ? { updatedAt: session.updatedAt } : {}),
    }
    if (Object.keys(sessionTime).length) records[0]!.sessionTime = sessionTime
    const tokens = terms(records.map(r => r.content).join('\n'))
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    docs.push({ records, tf, length: tokens.length, sessionId: session.id })
  }
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const average = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1)
  const ranked = docs.map(d => {
    let score = 0, matched = 0
    for (const t of queryTerms) {
      const tf = d.tf.get(t) ?? 0
      if (!tf) continue
      matched++
      // Han names already contribute both characters and bigrams; keep whole Latin terms competitive.
      score += Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
        * (/^[a-z0-9]+$/.test(t) ? 2 : 1) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / average))
    }
    return { ...d, score, matched }
  }).filter(d => d.score >= RECALL_LIMITS.minScore && d.matched >= RECALL_LIMITS.minTerms)
    .sort((a, b) => b.score - a.score || a.sessionId.localeCompare(b.sessionId)).slice(0, RECALL_LIMITS.topK)
  const selected: typeof docs[number]['records'] = []
  const packingOmittedSessionIds: string[] = []
  // Keep each qualifying session together so a later correction is not clipped away from a mistake.
  for (const d of ranked) {
    const packed = JSON.stringify([...selected, ...d.records])
    const fits = (text: string) => text.length <= RECALL_LIMITS.chars && new TextEncoder().encode(text).length <= RECALL_LIMITS.bytes
    if (fits(packed) && fits(recallForModel(packed).evidence)) selected.push(...d.records)
    else packingOmittedSessionIds.push(d.sessionId)
  }
  if (performance.now() - start > RECALL_LIMITS.scanMs) return empty()
  return { evidence: selected.length ? JSON.stringify(selected) : undefined, sessionIds: [...new Set(selected.map(r => r.sessionId))],
    rankedSessionIds: ranked.map(d => d.sessionId), packingOmittedSessionIds, records: selected.length }
}
