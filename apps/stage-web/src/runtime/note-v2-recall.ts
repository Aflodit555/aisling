import { isValidTimestamp, type NoteRecallContext } from '@aisling/core'
import type { NoteV2Store, NoteRelation, NoteV2Revision } from '../../../stage-desktop/memory-database/store'
import { rankNoteHeads, safeText, terms } from '../../../stage-desktop/memory-text.mjs'
import type { ConversationSession } from '../conversation/conversation-store'
import { recallQuery } from './memory-recall'
import { sourceRef } from './formation-evidence'
import { discoverCandidates } from '../../../stage-desktop/note-candidates.mjs'
import speakers from '../../../stage-desktop/memory-subjects.json'

type Head = Awaited<ReturnType<NoteV2Store['listRecallHeads']>>['notes'][number]
export interface NoteV2RecallBridge {
  candidates?(query: string, version: string): Promise<{complete: boolean; vectorStatus: string; candidates: Array<{noteId: string; noteVersion: number; channels: string[]; score: number}>}>
  snapshot(): Promise<{ reason: 'ready'; version: string; notes: Pick<Head, 'note' | 'grounds'>[] }
    | { reason: 'disabled' | 'snapshot-changed' | 'index-incomplete' }>
  current(version: string): Promise<boolean>
  neighbors?(ids: string[], version: string, evolution?: boolean, history?: boolean): Promise<{ notes: Pick<Head, 'note' | 'grounds'>[]; relations: NoteRelation[];
    history?: Array<{ forId: string; revision: NoteV2Revision }>; paths?: Array<{noteId: string; steps: Array<{from: string; to: string; type: string; reason: string}>}> }>
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

async function originalSources(head: Pick<Head, 'note' | 'grounds'>, sessions: ConversationSession[]) {
  const sources = []
  for (const ref of head.grounds.evidence) {
    const matching = sessions.filter(session => session.id === ref.sessionId)
    const message = matching[0]?.messages[ref.messageIndex]
    if (matching.length !== 1 || !message || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.content !== 'string' || message.noteDerived || !safeText(message.content) || message.toolCalls?.length || message.toolCallId
      || (await sourceRef(ref.sessionId, ref.messageIndex, message)).digest !== ref.digest) return
    sources.push({ role: message.role, content: message.content, at: iso(message.createdAt) })
  }
  return sources.length ? sources : undefined
}

export async function prepareNoteV2Recall(bridge: NoteV2RecallBridge, sessions: ConversationSession[],
  activeId: string, query: string, enabled: () => boolean, onUsed: () => void): Promise<NoteRecallContext | undefined> {
  if (!safeText(query)) return
  const text = recallQuery(query, sessions.find(session => session.id === activeId))
  const topics = new Set(terms(text).filter(word => word.length > 1 && !broad.has(word)))
  const compares = terms(query).some(word => comparisons.has(word))
  const currentState = /现在|目前|当前|还在|\b(?:now|currently|still)\b/iu.test(query)
  const historical = /后来|过程|经历|以前|之前|曾经|更正|修正|\b(?:history|before|previous)\b/iu.test(query)
  if (!topics.size) return
  const snapshot = await bounded(bridge.snapshot(), 250)
  if (snapshot?.reason !== 'ready' || !enabled()) return
  const eligible = snapshot.notes.filter(({ note, grounds }) => note.status === 'active'
    && grounds.evidence.some(ref => ref.sessionId !== activeId)
    && (note.basis === 'direct' && note.kind !== 'pattern' || !!note.uncertainty)
    && safeText([note.content, note.uncertainty, ...(note.tags ?? [])].join(' ')))
  const exact = eligible.filter(({ note }) => terms([note.content, note.state?.scope, ...(note.tags ?? [])].join(' ')).some(word => topics.has(word)))
  const anchors = new Set(terms(text).filter(word => word.length === 1 && /\p{Script=Han}/u.test(word)
    && !'我你他她的了在现还正以前后来吗呢有是否学练这那为什么怎样个事最近又'.includes(word)))
  const heads = exact.length ? exact : eligible.filter(({ note }) => terms([note.content, ...(note.tags ?? [])].join(' ')).some(word => anchors.has(word)))
  const ranked = rankNoteHeads([...topics, ...(exact.length ? [] : anchors)].join(' '), heads)
  const origins = new Map<string,string[]>()
  // Lexical/metadata fallback is ready while the optional remote query runs in Main.
  const local = discoverCandidates(text, eligible)
  const hybrid = bridge.candidates ? await bounded(bridge.candidates(text, snapshot.version), 850).catch(() => undefined) : undefined
  if (!enabled()) return
  const merged = hybrid?.candidates ?? local.candidates.map(item => ({noteId: item.head.note.id, noteVersion: item.head.note.version, channels: item.channels}))
  if (bridge.candidates) {
    const known = new Map(eligible.map(head => [head.note.id,head]))
    const found = merged.flatMap(item => { const head = known.get(item.noteId)
      if (!head || head.note.version !== item.noteVersion) return []
      origins.set(item.noteId,item.channels); return [head] })
    ranked.splice(0,ranked.length,...[...new Map([...found,...ranked].map(head=>[head.note.id,head])).values()].slice(0,10))
  }
  const lexical = new Set(ranked.map(head => head.note.id))
  if (compares) {
    const [pattern] = rankNoteHeads([...topics].join(' '), heads.filter(({ note }) => note.kind === 'pattern'))
    if (pattern) ranked.splice(0, ranked.length, pattern, ...ranked.filter(head => head !== pattern))
  }
  let relations: NoteRelation[] = []
  let paths: NonNullable<Awaited<ReturnType<NonNullable<NoteV2RecallBridge['neighbors']>>>>['paths'] = []
  const histories = new Map<string, { revision: NoteV2Revision; sources: NonNullable<Awaited<ReturnType<typeof originalSources>>> }>()
  if (ranked.length && bridge.neighbors) {
    try {
      const graph = await bounded(bridge.neighbors(ranked.slice(0, 3).map(head => head.note.id), snapshot.version, currentState || historical, historical), 250)
      if (!enabled()) return
      if (graph) {
        const known = new Map(snapshot.notes.map(head => [head.note.id, head]))
        relations = graph.relations.filter(relation => relation.status === 'active'
          && known.get(relation.from)?.note.version === relation.fromVersion && known.get(relation.to)?.note.version === relation.toVersion)
          .slice(0, 16)
        paths = graph.paths?.filter(path => path.steps.length <= 2) ?? []
        const endpoints = new Set(relations.flatMap(relation => [relation.from, relation.to]))
        const availableExtras = graph.notes.filter(head => endpoints.has(head.note.id) && known.get(head.note.id)?.note.version === head.note.version
          && head.note.status === 'active' && head.grounds.evidence.some(ref => ref.sessionId !== activeId)
          && safeText([head.note.content, head.note.uncertainty, ...(head.note.tags ?? [])].join(' ')))
        const extra = availableExtras.filter(head => relations.some(relation => [relation.from,relation.to].includes(head.note.id) && (relation.type !== 'ASSOCIATED_WITH'
            || terms(relation.reason).some(term => topics.has(term))))
            || paths?.some(path => path.noteId === head.note.id && path.steps.some(step => terms(step.reason).some(term => topics.has(term)))))
          .sort((a,b) => (paths?.find(p=>p.noteId===a.note.id)?.steps.length ?? 1) - (paths?.find(p=>p.noteId===b.note.id)?.steps.length ?? 1)).slice(0, 6)
        // A semantic seed can have a useful differently-worded neighbour even when every lexical check misses.
        if (!extra.length && [...origins.values()].some(channels=>channels.includes('embedding')))
          extra.push(...availableExtras.filter(head=>!lexical.has(head.note.id)).slice(0,1))
        const ordered = [ranked[0]!, ...extra, ...ranked.slice(1)]
        ranked.splice(0, ranked.length, ...[...new Map(ordered.map(head => [head.note.id, head])).values()].slice(0, 12))
        if (historical) for (const item of (graph.history ?? []).slice(0, 3)) {
          const owner = known.get(item.forId), revision = item.revision
          if (!owner || revision.snapshot.subject !== owner.note.subject || revision.snapshot.status === 'retracted'
            || !safeText([revision.snapshot.content, revision.snapshot.uncertainty].join(' '))) continue
          const sources = await originalSources({ note: revision.snapshot, grounds: revision.grounds }, sessions)
          if (sources) histories.set(item.forId, { revision, sources })
        }
      }
    } catch { /* Optional one-hop expansion cannot remove lexical Recall. */ }
  }
  const verified = new Map<string, NonNullable<Awaited<ReturnType<typeof originalSources>>>>()
  for (const head of ranked) {
    const sources = await originalSources(head, sessions)
    if (sources) verified.set(head.note.id, sources)
  }
  relations = relations.filter(relation => verified.has(relation.from) && verified.has(relation.to))
  const temporal = relations.filter(relation => ['STATE_CHANGE', 'CONTINUES'].includes(relation.type)
    && (relation.order === 'event' || relation.order === 'report' && snapshot.notes.filter(head => [relation.from, relation.to].includes(head.note.id)).every(head => head.note.eventTime === null)))
  const depth = new Map(ranked.map(head => [head.note.id, 0]))
  let cycle = false
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (const relation of temporal) if ((depth.get(relation.to) ?? 0) <= (depth.get(relation.from) ?? 0)) {
      depth.set(relation.to, (depth.get(relation.from) ?? 0) + 1); changed = true
    }
    if (!changed) break
    if (pass === 7) cycle = true
  }
  if ((currentState || historical) && !cycle) ranked.sort((a, b) => currentState
    ? (depth.get(b.note.id) ?? 0) - (depth.get(a.note.id) ?? 0) : (depth.get(a.note.id) ?? 0) - (depth.get(b.note.id) ?? 0))
  const pool: Array<{ key: string; rawKey?: string; json: string; compact: string; plain: string; sessions: string[]; lexical: boolean }> = []
  for (const { note, grounds } of ranked) {
    const sources = verified.get(note.id)
    if (!sources) continue
    const [first] = sources
    const contentKey = normalized(note.content)
    const prefix = first!.role === 'user' ? speakers.user.prefix : speakers.assistant.prefix
    const speaker = first!.role === 'user' ? speakers.user.subject : speakers.assistant.subject
    const reported = first!.role === 'user' ? contentKey.replace(/^用户(?:自述|报告|陈述)[: ]*/u, '') : contentKey
    const original = normalized(first!.content)
    const speech = sources.length === 1 && note.basis === 'direct' && note.subject === speaker
      && (contentKey === original || contentKey === normalized(prefix + first!.content)
        || (reported !== contentKey && (reported === original || reported === original.replace(/^我/u, ''))))
    const links = relations.filter(relation => relation.from === note.id || relation.to === note.id).map(relation => {
      const other = snapshot.notes.find(head => head.note.id === (relation.from === note.id ? relation.to : relation.from))
      return { type: relation.type, direction: relation.type === 'CONFLICTS' ? 'unresolved' : relation.type === 'SUPPLEMENTS'
        ? relation.from === note.id ? 'adds-to' : 'has-detail' : relation.type === 'ASSOCIATED_WITH' ? 'associated' : relation.from === note.id ? 'later' : 'earlier',
        basis: relation.basis, order: relation.order, uncertainty: relation.uncertainty, reason: relation.reason, content: other?.note.content }
    })
    const incoming = temporal.filter(relation => relation.to === note.id), outgoing = temporal.filter(relation => relation.from === note.id)
    const unresolved = cycle || relations.some(relation => relation.type === 'CONFLICTS' && [relation.from, relation.to].includes(note.id))
    const evolution = (currentState || historical) && (incoming.length || outgoing.length || unresolved) ? {
      role: unresolved ? 'unresolved' : incoming.length && !outgoing.length ? 'latest-known-report' : 'earlier-experience',
      order: incoming.some(relation => relation.order === 'event') ? 'event' : 'report',
      uncertainty: '保留历史经历；最新报告不保证该状态现在仍有效。',
    } : undefined
    const previous = histories.get(note.id)
    const history = previous && { content: previous.revision.snapshot.content, basis: previous.revision.snapshot.basis,
      uncertainty: previous.revision.snapshot.uncertainty, eventTime: previous.revision.snapshot.eventTime,
      version: previous.revision.version, action: previous.revision.action, reason: previous.revision.reason,
      changedAt: iso(previous.revision.changedAt), sources: previous.sources.filter(source => source.content.length <= 800).slice(0, 2) }
    const plain = { kind: note.kind, content: note.content, subject: note.subject, basis: note.basis,
      uncertainty: note.uncertainty, eventTime: note.eventTime, storedAt: iso(note.createdAt),
      sources: sources.map(({ role, at }) => ({ role, at })), ...(note.state && { state: note.state }) }
    const path = paths?.find(path => path.noteId === note.id && path.steps.every(step => verified.has(step.from) && verified.has(step.to)
      && relations.some(link => link.type === step.type && [link.from,link.to].includes(step.from) && [link.from,link.to].includes(step.to))))
    const retrieval = bridge.candidates || path ? { kind: lexical.has(note.id) ? 'direct' : 'associated', channels: origins.get(note.id),
      ...(path && { path: path.steps.map(step => ({type: step.type, reason: step.reason})), uncertainty: '系统关联导航线索，不是事实证明。' }) } : undefined
    pool.push({
      key: JSON.stringify([note.subject, note.basis, contentKey]),
      rawKey: speech && !links.length ? first!.role + ':' + normalized(first!.content) : undefined,
      sessions: grounds.evidence.map(ref => ref.sessionId),
      lexical: lexical.has(note.id),
      plain: JSON.stringify(plain),
      compact: JSON.stringify({ ...plain, ...(evolution && { evolution }), ...(retrieval && {retrieval}) }),
      json: JSON.stringify({ ...plain, ...(links.length && { relations: links }),
        ...(evolution && { evolution }), ...(history && { previousRecognition: history }), ...(retrieval && {retrieval}) }),
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
      const anchor = pool.find(item => item.lexical && !(item.rawKey && rawKeys.has(item.rawKey)) && fits([item.plain]))
      let hasLexical = false
      for (const diversify of [true, false]) {
        for (const item of pool) {
          if (selected.length === 3) break
          if (keys.has(item.key) || (item.rawKey && rawKeys.has(item.rawKey))
            || (diversify && item.sessions.every(id => covered.has(id)))) continue
          const packed = [item.json, item.compact, ...(item.lexical ? [item.plain] : [])]
            .find(value => fits([...selected, value])
              && (hasLexical || item.lexical || !anchor || fits([...selected, value, anchor.plain])))
          if (!packed) continue
          keys.add(item.key)
          item.sessions.forEach(id => covered.add(id))
          selected.push(packed)
          hasLexical ||= item.lexical
        }
      }
      if (selected.length) onUsed()
      return selected
    },
  }
}
