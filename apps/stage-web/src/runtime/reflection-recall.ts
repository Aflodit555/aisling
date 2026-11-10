import { isValidTimestamp, type ConversationMessage } from '@aisling/core'
import type { ReflectionCandidateDiagnostic } from '@aisling/core/legacy-recall'
import type { ConversationSession } from '../conversation/conversation-store'
import { recallQuery, safeText, terms } from './memory-recall'
import { reflectionEvidence, sourceRef, type FormationEvidence } from './reflection-formation'
import { validReflection, type Reflection, type ReflectionState } from './reflection-store'

export const REFLECTION_RECALL_LIMITS = { topK: 3, chars: 1500, bytes: 4500, minScore: 1, minTerms: 2 } as const

const patternQueries = new Set(terms('共同 相似 共性 模式 规律 pattern similar').filter(t => t.length > 1))
const genericTopics = new Set([...patternQueries, '经历', '经验', '情况', '状态', '偏好', '兴趣', '计划', '事实', '问题'])
const boilerplate = new Set(terms('用户 报告 之前 现在 当前 目前 已经 当时 可能 觉得 只是 自己 这个 那个 这些 那些 什么 怎么 是否 还有 的 我 你 了 是 在 和 与'))
const searchTerms = (text: string) => terms(text).filter(t => !boilerplate.has(t))
const fitsEvidence = (items: readonly string[]) => {
  const packed = `[${items.join(',')}]`
  return items.length <= REFLECTION_RECALL_LIMITS.topK && packed.length <= REFLECTION_RECALL_LIMITS.chars
    && new TextEncoder().encode(packed).length <= REFLECTION_RECALL_LIMITS.bytes
}
const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size && b.size ? [...a].filter(t => b.has(t)).length / Math.min(a.size, b.size) : 0

export interface ReflectionSelectionCandidate {
  json: string
  score: number
  kind: Reflection['kind']
  userReports: number
  sources: ReadonlySet<string>
  textTerms: ReadonlySet<string>
  topics: ReadonlySet<string>
}
const repeats = (a: ReflectionSelectionCandidate, b: ReflectionSelectionCandidate) =>
  a.kind === b.kind && overlap(a.sources, b.sources) === 1 && overlap(a.textTerms, b.textTerms) >= 0.7

/** At most six verified candidates: 41 nonempty subsets with at most three items. */
export function selectReflectionCandidates(pool: readonly ReflectionSelectionCandidate[], needsPattern: boolean,
  fits: (items: readonly string[]) => boolean = () => true): ReflectionSelectionCandidate[] {
  if (pool.length > REFLECTION_RECALL_LIMITS.topK * 2) throw new Error('Reflection selection pool exceeds limit')
  const maximum = Math.max(1, ...pool.map(c => c.score))
  let best: ReflectionSelectionCandidate[] = [], bestValue = 0, bestBytes = Infinity
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const group = pool.filter((_, i) => mask & (1 << i))
    if (group.length > REFLECTION_RECALL_LIMITS.topK) continue
    const items = group.map(c => c.json)
    if (!fitsEvidence(items) || !fits(items)) continue
    let value = group.reduce((n, c) => n + c.score / maximum, 0)
    // Reward a relevant pattern's breadth once, bounded by both distinct user reports and specific tags.
    if (needsPattern) value += Math.max(0, ...group.filter(c => c.kind === 'pattern')
      .map(c => Math.log2(Math.max(1, Math.min(c.userReports, c.topics.size)))))
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      if (repeats(group[i]!, group[j]!)) value -= Math.max(group[i]!.score, group[j]!.score) / maximum
    }
    const cost = new TextEncoder().encode(`[${items.join(',')}]`).length
    if (value > bestValue + 1e-9 || Math.abs(value - bestValue) <= 1e-9 && cost < bestBytes) {
      best = group; bestValue = value; bestBytes = cost
    }
  }
  return best
}

function reflectionIndex(state: ReflectionState) {
  const completed = new Set(state.batches.filter(b => b.status === 'completed').flatMap(b => b.organization
    ? b.organization.items.filter(i=>i.status==='applied').map(i=>i.reflectionId) : b.reflectionIds))
  const cIds=new Set(state.batches.filter(b=>b.organization).flatMap(b=>b.reflectionIds))
  const docs = state.reflections.filter(r => completed.has(r.id) && (!cIds.has(r.id)||r.recallEligible===true) && validReflection(r)).map(r => {
    const tokens = searchTerms(r.content), contentTerms = new Set(tokens)
    const tags = [...new Set(r.tags.map(tag => tag.normalize('NFKC').toLowerCase().trim()))].map(tag => new Set(searchTerms(tag)))
    const topicTags = tags.map(tag => [...tag].filter(t => t.length > 1 && !genericTopics.has(t)))
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    // Tags add topic coverage once, never repeated term frequency or confidence boilerplate.
    for (const tag of tags) for (const t of tag) if (!tf.has(t)) { tf.set(t, 1); tokens.push(t) }
    if (r.kind === 'pattern') for (const t of patternQueries) if (!tf.has(t)) { tf.set(t, 1); tokens.push(t) }
    return { r, tf, contentTerms, topicTags, length: tokens.length }
  })
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  return { docs, df, average: docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1) }
}

function reflectionQuery(query: string, session: ConversationSession | undefined): string {
  const anchored = recallQuery(query, session)
  if (anchored !== query || !/^(?:那|这|它们|这些|这种|从中).*(?:共同|相似|模式|规律|经验|启发)/u.test(query.trim())) return anchored
  for (const message of (session?.messages ?? []).slice(-12).reverse()) {
    if (message.role === 'user' && typeof message.content === 'string' && message.content !== query
      && message.content.length <= 300 && safeText(message.content) && !message.content.startsWith('[image]'))
      return `${message.content}\n${query}`
  }
  return query
}

/** Cache only validated persisted state; source messages are rechecked against each turn's snapshot. */
export function createReflectionRecall(read: () => ReflectionState) {
  let cached: { key: string; index: ReturnType<typeof reflectionIndex> } | undefined
  return {
    invalidate() { cached = undefined },
    retrieve(sessions: readonly ConversationSession[], activeId: string, query: string) {
      const start = performance.now()
      const selection: Array<ReflectionCandidateDiagnostic & { reflectionId: string }> = []
      const result = (candidates: string[], reason: string) => ({ candidates, reason, selection, durationMs: performance.now() - start })
      if (!safeText(query)) return result([], 'unsafe-query')
      let index: ReturnType<typeof reflectionIndex>
      try {
        // Recheck Main's erasure barrier even for legacy outputs whose deleted input was only context.
        const state = read(), key = JSON.stringify(state)
        if (!cached || cached.key !== key) cached = { key, index: reflectionIndex(state) }
        index = cached.index
      }
      catch { return result([], 'storage-error') }
      // Capture before the first await; a later Formation commit belongs to the next turn.
      const text = reflectionQuery(query, sessions.find(s => s.id === activeId))
      const queryTerms = new Set(searchTerms(text))
      const wantsPattern = terms(query).some(t => patternQueries.has(t))
      const needsPattern = wantsPattern || /(?:想|打算|准备|计划).*(?:但|却|迟迟|一直|没|未)|(?:这次|现在).*(?:还是|仍|没能)|矛盾|反例|例外|适用|过去.*经验/u.test(query)
      const { docs, df, average } = index
      if (!docs.length) return result([], 'empty')
      if (queryTerms.size < REFLECTION_RECALL_LIMITS.minTerms) return result([], 'no-match')
      const scored = docs.map(d => {
        let score = 0, matched = 0
        for (const t of queryTerms) {
          const tf = d.tf.get(t) ?? 0
          if (!tf) continue
          matched++
          score += Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
            * (/^[a-z0-9]+$/.test(t) ? 2 : 1) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / average))
        }
        const topical = [...queryTerms].some(t => t.length > 1 && !genericTopics.has(t) && d.contentTerms.has(t))
          || d.topicTags.filter(tag => tag.length && tag.every(t => queryTerms.has(t))).length >= 2
        return { ...d, score, matched, topical }
      }).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
      const ranked = scored.filter(d => d.topical && d.score >= REFLECTION_RECALL_LIMITS.minScore && d.matched >= REFLECTION_RECALL_LIMITS.minTerms)
      // A comparison gets one relevant pattern before individual facts can fill every slot.
      const pattern = wantsPattern ? ranked.find(d => d.r.kind === 'pattern') : undefined
      const shortlist = (pattern ? [pattern, ...ranked.filter(d => d !== pattern)] : ranked).slice(0, REFLECTION_RECALL_LIMITS.topK * 2)
      for (const d of [...shortlist, ...scored.filter(d => !shortlist.includes(d))].slice(0, REFLECTION_RECALL_LIMITS.topK * 2)) {
        selection.push({ label: `R${selection.length + 1}`, reflectionId: d.r.id, kind: d.r.kind, score: d.score,
          matched: d.matched, topical: d.topical, eligible: false, reason: shortlist.includes(d) ? 'invalid-source' : 'relevance' })
      }
      if (!ranked.length) return result([], 'no-match')
      return (async () => {
        const pool: Array<ReflectionSelectionCandidate & { diagnostic: typeof selection[number] }> = []
        const hashes = new Map<ConversationMessage, Promise<string>>()
        let reason = 'invalid-source'
        for (const { r, score } of shortlist) {
          const statement = `${r.content} ${r.tags.join(' ')} ${r.uncertainty ?? ''}`
          if (!safeText(statement)
            || [r.id, ...r.relatedReflectionIds, ...r.sourceRefs.map(ref => ref.sessionId)].some(id => statement.includes(id))) continue
          const evidence: FormationEvidence[] = []
          for (const ref of r.sourceRefs) {
            const session = sessions.find(s => s.id === ref.sessionId)
            const message = session?.messages[ref.messageIndex]
            if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
              || message.noteDerived || !safeText(message.content) || message.toolCalls?.length || message.toolCallId) break
            try {
              if (!hashes.has(message)) hashes.set(message, sourceRef(ref.sessionId, ref.messageIndex, message).then(ref => ref.digest))
              if (await hashes.get(message)! !== ref.digest) break
            }
            catch { break }
            evidence.push({ ref, message, sessionTime: { createdAt: session!.createdAt, updatedAt: session!.updatedAt } })
          }
          const userReports = new Set(evidence.filter(e => e.message.role === 'user').map(e => `${e.ref.sessionId}:${e.ref.messageIndex}`))
          const sourceCodes = new Set(evidence.flatMap(e => e.message.content?.match(/\b[ER]\d+\b/g) ?? []))
          if ((statement.match(/\b[ER]\d+\b/g) ?? []).some(code => !sourceCodes.has(code))) continue
          if (evidence.length !== r.sourceRefs.length
            || (['fact', 'preference', 'project-state'].includes(r.kind) && !userReports.size)
            || (r.kind === 'pattern' && (userReports.size < 2 || !r.uncertainty))) continue
          const sources = reflectionEvidence(evidence).map(({ conversation, position, role, sourceScope, time, sessionTime }) =>
            ({ conversation, position, role, sourceScope, time, ...(sessionTime ? { sessionTime } : {}) }))
          const candidate = JSON.stringify({ content: r.content, kind: r.kind, basis: r.basis, tags: r.tags,
            formedAt: isValidTimestamp(r.createdAt) ? new Date(r.createdAt).toISOString() : 'unknown',
            sources, ...(r.uncertainty ? { uncertainty: r.uncertainty } : {}) })
          const diagnostic = selection.find(d => d.reflectionId === r.id)!
          diagnostic.eligible = true
          diagnostic.chars = candidate.length; diagnostic.bytes = new TextEncoder().encode(candidate).length
          pool.push({ json: candidate, kind: r.kind, score, userReports: userReports.size, diagnostic,
            sources: new Set(r.sourceRefs.map(ref => `${ref.sessionId}:${ref.messageIndex}:${ref.digest}`)),
            textTerms: new Set(searchTerms(r.content).filter(t => t.length > 1)),
            topics: new Set(r.tags.map(tag => tag.normalize('NFKC').toLowerCase().trim())
              .filter(tag => searchTerms(tag).some(t => t.length > 1 && !genericTopics.has(t)))) })
        }
        const choose = (fits: (items: readonly string[]) => boolean = () => true) => {
          const chosen = selectReflectionCandidates(pool, needsPattern, fits)
          const items = chosen.map(c => c.json)
          for (const c of pool) {
            delete c.diagnostic.order
            const order = chosen.indexOf(c)
            c.diagnostic.reason = order >= 0 ? 'selected' : !fitsEvidence([c.json]) ? 'candidate-budget'
              : !fits([c.json]) ? 'context-budget' : items.length < REFLECTION_RECALL_LIMITS.topK && !fitsEvidence([...items, c.json]) ? 'candidate-budget'
                : items.length < REFLECTION_RECALL_LIMITS.topK && !fits([...items, c.json]) ? 'context-budget' : 'combination-value'
            if (order >= 0) c.diagnostic.order = order + 1
          }
          return items
        }
        const candidates = choose()
        if (pool.length && !candidates.length) reason = 'candidate-budget'
        return { ...result(candidates, candidates.length ? 'selected' : reason), select: choose }
      })()
    },
  }
}
