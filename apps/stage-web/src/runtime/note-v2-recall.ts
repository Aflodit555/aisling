import { isValidTimestamp, type NoteRecallContext } from '@aisling/core'
import type { NoteV2Store } from '../../../stage-desktop/memory-database/store'
import { rankNoteHeads, safeText, terms } from '../../../stage-desktop/memory-text.mjs'
import type { ConversationSession } from '../conversation/conversation-store'
import { recallQuery } from './memory-recall'
import { sourceRef } from './formation-evidence'
import speakers from '../../../stage-desktop/memory-subjects.json'

type Head = Awaited<ReturnType<NoteV2Store['listRecallHeads']>>['notes'][number]
export interface NoteV2RecallBridge {
  snapshot(): Promise<{ reason: 'ready'; version: string; notes: Pick<Head, 'note' | 'grounds'>[] }
    | { reason: 'disabled' | 'snapshot-changed' | 'index-incomplete' }>
  current(version: string): Promise<boolean>
}

const comparisons = new Set(terms('共同 相似 共性 模式 规律 pattern patterns similar common').filter(word => word.length > 1))
const broad = new Set([...comparisons, '经历', '经验', '状态', '偏好', '兴趣', '计划', '事实', '问题', 'what', 'have', 'the', 'about', 'you', 'me', 'that', 'tell'])
const normalized = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
const iso = (time: unknown) => isValidTimestamp(time) ? new Date(time).toISOString() : undefined

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: number | ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<undefined>(resolve => { timer = setTimeout(resolve, ms) })])
  } finally { clearTimeout(timer) }
}

export async function prepareNoteV2Recall(bridge: NoteV2RecallBridge, sessions: ConversationSession[],
  activeId: string, query: string, enabled: () => boolean, onUsed: () => void): Promise<NoteRecallContext | undefined> {
  if (!safeText(query)) return
  const text = recallQuery(query, sessions.find(session => session.id === activeId))
  const topics = new Set(terms(text).filter(word => word.length > 1 && !broad.has(word)))
  const compares = terms(query).some(word => comparisons.has(word))
  if (!topics.size) return
  const snapshot = await bounded(bridge.snapshot(), 250)
  if (snapshot?.reason !== 'ready' || !enabled()) return
  const heads = snapshot.notes.filter(({ note, grounds }) => note.status === 'active'
    && grounds.evidence.some(ref => ref.sessionId !== activeId)
    && (note.basis === 'direct' && note.kind !== 'pattern' || !!note.uncertainty)
    && safeText([note.content, note.uncertainty, ...(note.tags ?? [])].join(' '))
    && terms([note.content, ...(note.tags ?? [])].join(' ')).some(word => topics.has(word)))
  const ranked = rankNoteHeads([...topics].join(' '), heads)
  if (compares) {
    const [pattern] = rankNoteHeads([...topics].join(' '), heads.filter(({ note }) => note.kind === 'pattern'))
    if (pattern) ranked.splice(0, ranked.length, pattern, ...ranked.filter(head => head !== pattern))
  }
  const pool: Array<{ key: string; rawKey?: string; json: string; sessions: string[] }> = []
  for (const { note, grounds } of ranked) {
    const sources = []
    for (const ref of grounds.evidence) {
      const matching = sessions.filter(session => session.id === ref.sessionId)
      const message = matching[0]?.messages[ref.messageIndex]
      if (matching.length !== 1 || !message || (message.role !== 'user' && message.role !== 'assistant')
        || typeof message.content !== 'string' || message.noteDerived || !safeText(message.content) || message.toolCalls?.length || message.toolCallId
        || (await sourceRef(ref.sessionId, ref.messageIndex, message)).digest !== ref.digest) break
      sources.push({ role: message.role, content: message.content, at: iso(message.createdAt) })
    }
    if (!sources.length || sources.length !== grounds.evidence.length) continue
    const [first] = sources
    const contentKey = normalized(note.content)
    const prefix = first!.role === 'user' ? speakers.user.prefix : speakers.assistant.prefix
    const speaker = first!.role === 'user' ? speakers.user.subject : speakers.assistant.subject
    const reported = first!.role === 'user' ? contentKey.replace(/^用户(?:自述|报告|陈述)[: ]*/u, '') : contentKey
    const original = normalized(first!.content)
    const speech = sources.length === 1 && note.basis === 'direct' && note.subject === speaker
      && (contentKey === original || contentKey === normalized(prefix + first!.content)
        || (reported !== contentKey && (reported === original || reported === original.replace(/^我/u, ''))))
    pool.push({
      key: JSON.stringify([note.subject, note.basis, contentKey]),
      rawKey: speech ? first!.role + ':' + normalized(first!.content) : undefined,
      sessions: grounds.evidence.map(ref => ref.sessionId),
      json: JSON.stringify({ kind: note.kind, content: note.content, subject: note.subject, basis: note.basis,
        uncertainty: note.uncertainty, eventTime: note.eventTime, storedAt: iso(note.createdAt),
        sources: sources.map(({ role, at }) => ({ role, at })) }),
    })
  }
  if (!pool.length) return
  return {
    current: async () => enabled() && await bounded(bridge.current(snapshot.version), 150) === true && enabled(),
    select(raw, fits) {
      const rawKeys = new Set<string>((raw ? JSON.parse(raw) as Array<{ role: string; content: string }> : [])
        .map(item => item.role + ':' + normalized(item.content)))
      const keys = new Set<string>()
      const covered = new Set<string>()
      const selected: string[] = []
      for (const diversify of [true, false]) {
        for (const item of pool) {
          if (selected.length === 3) break
          if (keys.has(item.key) || (item.rawKey && rawKeys.has(item.rawKey))
            || (diversify && item.sessions.every(id => covered.has(id))) || !fits([...selected, item.json])) continue
          keys.add(item.key)
          item.sessions.forEach(id => covered.add(id))
          selected.push(item.json)
        }
      }
      if (selected.length) onUsed()
      return selected
    },
  }
}
