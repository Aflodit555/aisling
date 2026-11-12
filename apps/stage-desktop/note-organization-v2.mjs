import { rankNoteHeads, terms } from './memory-text.mjs'
import { authorizeSemantic } from './note-semantic-contract.mjs'

const normalized = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim().replace(/[。.]+$/u, '')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const scopeOf = note => note.state && normalized(note.state.scope)
const changeCue = /现在|开始|暂停|停止|重新|恢复|不再|改为|继续|\b(?:now|started|paused|stopped|resumed|changed|continue)\b/iu
const hypothetical = /如果|假如|打算|准备|计划|想要|曾经|以前|去年|上周|上个月|昨天|当时|并未|没有|并不|\b(?:if|plan|intend|used to|did not|last month|last week|yesterday)\b/iu
const correction = /更正|纠正|说错|口误|不是.+而是|\b(?:correction|correct|meant)\b/iu
const withdrawal = /撤回|收回|撤销|\b(?:retract|withdraw)\b/iu
const clauses = text => text.split(/[，。！？；,\n!?;]/u).map(part => normalized(part)).filter(Boolean)
const question = /[?？]|是否|能否|(?:吗|呢)[。.!！?？]?$/u

/** @param {import('./memory-database/store').NoteV2Store} store @param {() => string} stamp
 * @param {(() => (ref: import('./memory-database/store').EvidenceRef) => unknown)} [currentLookup] */
export function createOrganizationIndex(store, stamp, currentLookup) {
  /** @type {{ stamp: string; heads: Awaited<ReturnType<typeof store.listRecallHeads>>['notes']; cursor: string; complete: boolean; pages: number } | undefined} */
  let index
  return async function read() {
    const current = stamp()
    if (index?.stamp !== current) index = { stamp: current, heads: [], cursor: '', complete: false, pages: 0 }
    const deadline = performance.now() + 200
    // shortcut: at most 2048 heads; larger profiles explicitly remain incomplete until indexed search is introduced.
    for (let page = 0; page < 64 && !index.complete && index.pages < 512 && performance.now() < deadline; page++) {
      const result = await store.listRecallHeads(index.cursor)
      index.heads.push(...result.notes)
      index.pages++
      index.complete = !result.nextCursor
      if (result.nextCursor) {
        if (result.nextCursor <= index.cursor) throw new Error('invalid-candidate-cursor')
        index.cursor = result.nextCursor
      }
    }
    if (!currentLookup) return index
    const lookup = currentLookup(), checked = new Map()
    const valid = ref => {
      const key = JSON.stringify(ref)
      if (!checked.has(key)) checked.set(key, !!lookup(ref))
      return checked.get(key)
    }
    const heads = index.heads.filter(head => head.cumulativeEvidence.every(valid))
    return { ...index, heads, complete: index.complete && heads.length === index.heads.length }
  }
}

export function sameRecognition(a, b) {
  return a.subject === b.subject && a.kind === b.kind && a.basis === b.basis
    && normalized(a.content) === normalized(b.content) && same(a.eventTime, b.eventTime)
    && same(a.state, b.state) && same(a.uncertainty, b.uncertainty)
}

/** Metadata/recent heads are only recall candidates, never evidence of a semantic relation. */
export function mergeOrganizationCandidates(query, heads, focus = undefined, related = []) {
  const eligible = focus ? heads.filter(head => head.note.id !== focus.id && head.note.subject === focus.subject) : heads
  const ranked = rankNoteHeads(query, eligible)
  const metadata = eligible.filter(head => related.includes(head.note.id)
    || focus?.state?.scope && head.note.state?.scope === focus.state.scope
    || (head.note.tags ?? []).some(tag => query.includes(tag))).slice(0, 5)
  const recent = [...eligible].filter(head => head.note.basis === 'direct' && (!focus || head.note.kind === focus.kind))
    .sort((a, b) => b.note.createdAt - a.note.createdAt || a.note.id.localeCompare(b.note.id)).slice(0, 2)
  return [...new Map([...ranked.slice(0, 3), ...metadata, ...recent, ...ranked.slice(3)]
    .map(head => [head.note.id, head])).values()].slice(0, focus ? 4 : 5)
}

function userQuotes(proposal, lookup) {
  return proposal.draft.citations.filter(c => {
    const message = lookup(c.ref)
    return message?.role === 'user' && (normalized(message.content) === normalized(c.quote)
      || clauses(message.content).includes(normalized(c.quote)))
  }).map(c => c.quote)
}

export function groundedState(note, quotes) {
  return note.basis === 'direct' && note.state && quotes.some(quote => quote.includes(note.state.scope)
    && quote.includes(note.state.value) && !hypothetical.test(quote) && !question.test(quote))
}

function literal(note, quotes) {
  const content = note.content.replace(/^用户(?:报告|自述|陈述)[：: ]*/u, '')
  const speakerless = value => note.subject === 'profile-user' ? value.replace(/^(\d{4}-\d{2}-\d{2}\s*)?我(?!们|的)/u, '$1') : value
  return !/[,，;；\n。.!！?？]|并且|同时|但是|而且|\b(?:and|but|also)\b/iu.test(content.replace(/[。.!！?？]$/u, ''))
    && quotes.some(quote => (note.kind === 'open-question' || !question.test(quote))
      && (speakerless(normalized(quote)) === speakerless(normalized(content))
        || clauses(quote).some(clause => speakerless(clause) === speakerless(normalized(content)))))
}

/** Model interpretation proposes meaning; Main grants only these source-checkable operations. */
export function authorizeOrganization(proposal, { heads, complete, lookup }) {
  if (!complete || !proposal.draft?.confirmed) return false
  const note = proposal.draft.meaning, target = proposal.target
  const quotes = userQuotes(proposal, lookup)
  const peers = heads.map(head => head.note).filter(peer => peer.subject === note.subject)
  const statePeers = peers.filter(peer => scopeOf(note) && scopeOf(peer) === scopeOf(note))
  const supported = literal(note, quotes) && (!note.state || groundedState(note, quotes))
  const semantic = authorizeSemantic(proposal, { complete, lookup })
  if (proposal.action === 'NOOP') return !!target && sameRecognition(note, target) && supported || semantic
  if (proposal.action === 'ADD') {
    if (peers.some(peer => sameRecognition(peer, note))) return false
    if (quotes.some(q => correction.test(q) || withdrawal.test(q))) return false
    if (semantic) return true
    if (statePeers.some(peer => peer.state.value === note.state.value)) return false
    if (statePeers.length && (!groundedState(note, quotes) || !quotes.some(q => changeCue.test(q)))) return false
    if (note.basis === 'direct' && !note.state && note.kind !== 'event') {
      const words = new Set(terms(note.content).filter(word => word.length > 1 && !['用户', '报告', '陈述', '自述'].includes(word)))
      const overlaps = peers.some(peer => {
        if (peer.kind !== note.kind) return false
        const other = new Set(terms(peer.content).filter(word => word.length > 1))
        const shared = [...words].filter(word => other.has(word)).length
        return shared >= 2 && shared / Math.max(1, Math.min(words.size, other.size)) >= .6
      })
      // Similarity only withholds a write; it never proves identity, conflict or a graph edge.
      if (overlaps) return false
    }
    if (note.basis === 'direct') return supported || (!quotes.length && note.kind === 'event'
      && proposal.draft.citations.length === 1 && lookup(proposal.draft.citations[0].ref)?.role === 'assistant'
      && note.content === 'Aisling 发言：' + lookup(proposal.draft.citations[0].ref).content)
    // Inferences stay explicitly uncertain and cannot silently replace a prior interpretation.
    const sessions = new Set(proposal.draft.citations.filter(c => lookup(c.ref)?.role === 'user').map(c => c.ref.sessionId))
    const shared = (note.tags ?? []).filter(tag => quotes.every(quote => quote.includes(tag)))
    return note.kind === 'pattern' && !!note.uncertainty && sessions.size >= 2 && quotes.length >= 2 && shared.length > 0
      && !peers.some(peer => peer.kind === 'pattern' && (peer.tags ?? []).some(tag => shared.includes(tag)))
  }
  if (!target || target.basis !== 'direct' || note.basis !== 'direct' || target.kind !== note.kind
    || !scopeOf(note) || scopeOf(note) !== scopeOf(target)) return false
  const controls = quotes.filter(q => !hypothetical.test(q) && !/[?？]|是否|能否|(?:不要|不必|并非|不是|别|不想|不会|不).{0,8}(?:撤回|收回|撤销|更正|纠正|从)|\b(?:if|not|don't|never)\b/iu.test(q))
  const namesOld = quote => quote.includes(target.state.value) && quote.includes(note.state.scope)
  if (proposal.action === 'RETRACT') return controls.some(q => /^(?:(?:我(?:现在|决定)?|现在|请)?(?:撤回|收回|撤销)|(?:i\s+)?(?:retract|withdraw)\b)/iu.test(q) && namesOld(q))
  if (!supported) return false
  if (proposal.action === 'UPDATE') return controls.some(q => correction.test(q) && namesOld(q))
  if (proposal.action === 'SUPERSEDE') return note.state.value !== target.state.value && controls.some(q => namesOld(q)
    && (q.includes('从' + target.state.value + '改为' + note.state.value)
      || q.includes('from ' + target.state.value + ' to ' + note.state.value)))
  return false
}

function eventOrder(note) {
  const time = note.eventTime
  if (time?.kind === 'date') return [Date.parse(time.date), Date.parse(time.date)]
  if (time?.kind === 'instant') return [time.epochMs, time.epochMs]
  if (time?.kind === 'date-range') return [Date.parse(time.start), Date.parse(time.end)]
}

function reportOrder(head, lookup) {
  const refs = head.grounds.evidence
  const messages = refs.map(lookup)
  if (!refs.length || messages.some(m => !m)) return undefined
  if (refs.every(ref => ref.sessionId === refs[0].sessionId))
    return { session: refs[0].sessionId, position: Math.max(...refs.map(ref => ref.messageIndex)) }
}

/** Only original, literal state reports create edges; tags/similarity never create a relation. */
export function planNoteRelation(first, second, lookup) {
  if (first.note.id === second.note.id || first.note.subject !== second.note.subject
    || !scopeOf(first.note) || scopeOf(first.note) !== scopeOf(second.note)) return null
  const quotes = head => head.grounds.evidence.filter(ref => lookup(ref)?.role === 'user').map(ref => lookup(ref).content)
  if (!groundedState(first.note, quotes(first)) || !groundedState(second.note, quotes(second))) return null
  let from = first, to = second, order
  const a = eventOrder(first.note), b = eventOrder(second.note)
  if (a && b && (a[1] < b[0] || b[1] < a[0])) {
    if (b[1] < a[0]) [from, to] = [second, first]
    order = 'event'
  } else {
    const x = reportOrder(first, lookup), y = reportOrder(second, lookup)
    if (x && y && x.session === y.session && x.position !== y.position) {
      if (y.position < x.position) [from, to] = [second, first]
    } else {
      const times = head => head.grounds.evidence.map(ref => lookup(ref)?.createdAt)
      const xTimes = times(first), yTimes = times(second)
      if (![...xTimes, ...yTimes].every(t => Number.isSafeInteger(t) && t > 0)) return null
      if (Math.max(...xTimes) < Math.min(...yTimes)) { /* first report precedes second */ }
      else if (Math.max(...yTimes) < Math.min(...xTimes)) [from, to] = [second, first]
      else return null
    }
    order = 'report'
  }
  const later = quotes(to)
  const type = from.note.state.value === to.note.state.value ? 'CONTINUES' : 'STATE_CHANGE'
  if (!later.some(q => changeCue.test(q) && !correction.test(q) && !withdrawal.test(q))) return null
  if (type === 'CONTINUES' && !later.some(q => /继续|重新|恢复|\b(?:continue|resume|again)\b/iu.test(q))) return null
  const evidence = [...new Map([...from.grounds.evidence, ...to.grounds.evidence]
    .map(ref => [JSON.stringify(ref), ref])).values()]
  if (evidence.length > 12) return null
  return { type, from: from.note.id, to: to.note.id, fromVersion: from.note.version, toVersion: to.note.version,
    basis: order === 'event' ? 'direct' : 'inferred', order,
    ...(order === 'report' && { uncertainty: '仅能确认报告先后；不据此推定事件日期或当前仍然有效。' }),
    reason: type === 'STATE_CHANGE' ? '同一明确状态范围的有序原始报告。' : '同一明确范围的继续或恢复报告。',
    sources: { evidence } }
}
