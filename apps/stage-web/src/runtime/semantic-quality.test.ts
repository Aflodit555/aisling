import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as history from './formation-evidence'
import cases from './semantic-quality-cases.json'
import { formationInput, limits } from '../../../stage-desktop/note-formation-contract.mjs'
import { discoverCandidates } from '../../../stage-desktop/note-candidates.mjs'
import speakers from '../../../stage-desktop/memory-subjects.json'
import type { ConversationSession } from '../conversation/conversation-store'

it('measures fixed source coverage and candidate reach without pretending fixtures are LLM judgments', async () => {
  const rows = []
  for (const item of cases) {
    const start = performance.now()
    const make = (id: string, texts: string[]): ConversationSession => ({ id, title: '', createdAt: 0, updatedAt: 0,
      messages: texts.map(content => ({ role: 'user', content })) })
    const active = make('active', [...(item.previous ?? []), item.current])
    active.messages[active.messages.length - 1] = { ...active.messages.at(-1)!, role: item.role === 'assistant' ? 'assistant' : 'user' }
    const sessions = [active, make('past', item.history ?? [])]
    const index = active.messages.length - 1, message = active.messages[index]!
    const current = [{ ref: await history.sourceRef(active.id, index, message), message }]
    const fits = (sources: history.FormationEvidence[]) => formationInput({ notes: [], speakers, evidence: sources.map(e => ({
      ...e, message: e.message as never, scope: e.scope === 'related-history' ? 'history' : 'current',
    })) })
    const select = process.env.SEMANTIC_BASELINE ? history.withRelatedHistory
      : (history as typeof history & { withNoteHistory?: typeof history.withRelatedHistory }).withNoteHistory ?? history.withRelatedHistory
    const evidence = await select(active.id, current, () => sessions, fits)
    const input = fits(evidence)
    // Baseline query was current-only; the revision uses exactly the supplied context.
    const query = (process.env.SEMANTIC_BASELINE ? current : evidence).map(e => e.message.content).join('\n')
    const heads = (item.notes ?? []).map((content, i) => ({ note: { id: 'note-' + i, version: 1, content, subject: 'profile-user', tags: [] } }))
    const candidates = discoverCandidates(query, heads as never).candidates
    const anchor = item.expected.anchor
    const bytes = new TextEncoder().encode(JSON.stringify(input.messages)).length
    expect(bytes).toBeLessThanOrEqual(limits.inputBytes)
    rows.push({ id: item.id, anchorRequired: !!anchor, anchorSeen: !anchor || evidence.some(e => e.message.content === anchor),
      candidateRequired: !!item.expected.candidate, candidateHit: candidates.length > 0,
      sources: evidence.length, inputBytes: bytes, ms: performance.now() - start,
      semanticAccuracy: null, independentMeaning: null, unsupportedClaims: null, relationAccuracy: null, authorization: null })
  }
  const result = { cases: rows.length, anchors: rows.filter(r => r.anchorRequired).length,
    anchorsSeen: rows.filter(r => r.anchorRequired && r.anchorSeen).length,
    candidates: rows.filter(r => r.candidateRequired).length, candidatesHit: rows.filter(r => r.candidateRequired && r.candidateHit).length, rows }
  if (process.env.SEMANTIC_RESULT) fs.writeFileSync(path.resolve(process.env.SEMANTIC_RESULT), JSON.stringify(result, null, 2))
  if (!process.env.SEMANTIC_BASELINE) expect(result.anchorsSeen).toBe(result.anchors)
  expect(rows.find(r => r.id === 'lexical-miss')!.sources).toBe(1)
})


it('bounds nearby history, preserves roles/corrections, and never includes later or unsafe messages', async () => {
  const messages = ['较远的旧对象', '我要做纸箱猫窝。', '可以试试木箱。', '不，仍用纸箱。', '暂不更换。', '这个方案后来失败了。', '未来不能提前看到。']
    .map((content, i) => ({ role: i === 2 ? 'assistant' as const : 'user' as const, content }))
  const active: ConversationSession = { id: 'bounded', title: '', createdAt: 0, updatedAt: 0, messages }
  const current = [{ ref: await history.sourceRef(active.id, 5, messages[5]!), message: messages[5]! }]
  const selected = await history.withNoteHistory(active.id, current, () => [active], () => {})
  expect(selected.map(e => e.ref.messageIndex)).toEqual([5, 1, 2, 3, 4])
  expect(selected[2]!.message.role).toBe('assistant')
  expect(await history.withNoteHistory(active.id, current, () => [active], e => { if (e.length > 1) throw Error('budget') })).toEqual(current)
  messages[3]!.content = 'apiKey secret omitted'
  expect(await history.withNoteHistory(active.id, current, () => [active], () => {})).toEqual(current)
  messages[3]!.content = '不，仍用纸箱。'
  Object.assign(messages[2]!, { toolCallId: 'tool' })
  expect(await history.withNoteHistory(active.id, current, () => [active], () => {})).toEqual(current)
  expect(await history.withNoteHistory(active.id, current, () => [active, active], () => {})).toEqual(current)
  const long = { ...active, messages: messages.map((m, i) => ({ ...m, toolCallId: undefined, content: i < 5 ? '明'.repeat(1000) : m.content })) }
  expect(await history.withNoteHistory(active.id, current, () => [long], sources => formationInput({ notes: [], speakers,
    evidence: sources.map(e => ({ ...e, message: e.message as never, scope: e.scope === 'related-history' ? 'history' : 'current' })) }))).toEqual(current)
})
