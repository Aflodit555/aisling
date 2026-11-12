import { rankNoteHeads, safeText, terms } from './memory-text.mjs'

export const projectionVersion = 1
export function buildNoteEmbeddingText(note) {
  const tags = [...new Set((note.tags ?? []).map(tag => tag.normalize('NFKC').trim()).filter(tag => tag.length > 1))].sort()
  return JSON.stringify({ content: note.content.normalize('NFKC').trim(), subject: note.subject, kind: note.kind,
    ...(note.state && { state: {scope: note.state.scope.normalize('NFKC').trim(),value: note.state.value.normalize('NFKC').trim()} }), ...(tags.length && { tags }) })
}

/** Scores from different channels never share a numeric scale. */
export function discoverCandidates(query, heads, vectors = [], focus = undefined, complete = true) {
  const eligible = heads.filter(head => head.note.id !== focus?.id && safeText(head.note.content))
  const known = new Map(eligible.map(head => [head.note.id, head]))
  const tokens = new Set(terms(query).filter(t => t.length > 1))
  const metadata = eligible.map(head => ({ head, score: (head.note.tags ?? []).filter(tag => tag.length > 1 && query.includes(tag)).length * 2
    + (head.note.state && query.includes(head.note.state.scope) ? 2 : 0)
    + (focus && head.note.subject === focus.subject ? .1 : 0) + (focus && head.note.kind === focus.kind ? .1 : 0) }))
    .filter(item => item.score >= 1 || focus && [...tokens].some(t => terms(item.head.note.content).includes(t)))
    .sort((a,b) => b.score - a.score || a.head.note.id.localeCompare(b.head.note.id)).slice(0, 8).map(item => item.head)
  const embedding = vectors.filter(hit => known.get(hit.noteId)?.note.version === hit.noteVersion && hit.score >= .3)
    .map(hit => known.get(hit.noteId)).slice(0, 12)
  const channels = { bm25: rankNoteHeads(query, eligible), embedding, metadata }
  const fused = new Map()
  for (const [channel, entries] of Object.entries(channels)) for (const [i, head] of entries.entries()) {
    const item = fused.get(head.note.id) ?? { head, score: 0, channels: [] }
    if (item.channels.includes(channel)) continue
    item.score += 1 / (60 + i + 1); item.channels.push(channel); fused.set(head.note.id, item)
  }
  return { complete, candidates: [...fused.values()].sort((a,b) => b.score - a.score || a.head.note.id.localeCompare(b.head.note.id)).slice(0, 10) }
}
