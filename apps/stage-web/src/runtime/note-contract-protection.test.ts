import { expect, it, vi } from 'vitest'
import { parseNoteProposals, type NoteFormationContext } from '../../../stage-desktop/note-formation-contract.mjs'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef } from './formation-evidence'
import { createNoteFormation, type NoteFormationBridge } from './note-formation'
import speakers from '../../../stage-desktop/memory-subjects.json'

async function fixture() {
  const session: ConversationSession = { id: 'draft-session', title: '', createdAt: 1, updatedAt: 1, messages: [
    { role: 'user', content: '温室门牌更正为 R8。仓库门铃改为木铃。温室检修日期为2026-04-01至2026-04-03。' },
    { role: 'assistant', content: '我承诺替你订货，尚未执行。' },
  ] }
  const refs = await Promise.all(session.messages.map((message, i) => sourceRef(session.id, i, message)))
  const context: NoteFormationContext = { speakers, notes: ['温室', '仓库'].map((subject, i) => ({ id: 'note-' + i,
    subject, version: 2, createdAt: 1, status: 'active', kind: 'fact', basis: 'direct', eventTime: null, content: subject + '原记录' })),
    evidence: refs.map((ref, i) => ({ ref, message: { role: session.messages[i]!.role, content: session.messages[i]!.content! }, scope: 'current' })) }
  const draft = { content: '温室门牌更正为 R8。', subject: 'S3', eventTime: null, kind: 'fact', basis: 'direct',
    tags: ['不作为主体的标签'], sources: [{ label: 'E1', quote: '温室门牌更正为 R8。' }] }
  const wire = { action: 'ADD', target: null, reason: 'Synthetic original evidence', draft }
  const parse = (value: unknown = wire, ctx = context) => parseNoteProposals(JSON.stringify({ items: [value] }), ctx)[0]!
  return { session, refs, context, wire, parse }
}

it('binds subject identity and target to supplied Notes instead of tags or free-text labels', async () => {
  const f = await fixture(), proposal = f.parse()
  expect(proposal.draft?.meaning.subject).toBe('温室')
  expect(proposal.draft?.confirmed).toBe(true)
  expect(() => f.parse({ ...f.wire, draft: { ...f.wire.draft, subject: '温室入口门牌' } })).toThrow('draft-subject')
  expect(() => f.parse({ ...f.wire, action: 'UPDATE', target: 'N2' })).toThrow('draft-subject')
  expect(() => f.parse({ ...f.wire, action: 'UPDATE', target: 'N99' })).toThrow('proposal-target')
})

it('keeps explicitly proposed atomic pieces attached only to their own original citations', async () => {
  const f = await fixture()
  const second = { ...f.wire, draft: { ...f.wire.draft, subject: 'S4', content: '仓库门铃改为木铃。', sources: [{ label: 'E1', quote: '仓库门铃改为木铃。' }] } }
  const output = parseNoteProposals(JSON.stringify({ items: [f.wire, second] }), f.context)
  expect(output.map(p => p.draft?.meaning.subject)).toEqual(['温室', '仓库'])
  expect(output.every(p => p.draft?.citations.length === 1)).toBe(true)
  expect(output.every(p => !p.related.length && !('origins' in p.draft!))).toBe(true)
  expect(() => f.parse(second, { ...f.context, evidence: f.context.evidence.slice(1) })).toThrow()
  expect(() => f.parse(f.wire, { ...f.context, evidence: f.context.evidence.map(e => ({ ...e, scope: 'history' })) })).toThrow('draft-current-source')
})

it('keeps event time unknown unless the selected quotation explicitly contains valid event dates', async () => {
  const f = await fixture()
  expect(f.parse().draft?.meaning.eventTime).toBeNull()
  const eventTime = { kind: 'date-range', start: '2026-04-01', end: '2026-04-03' }
  const value = { ...f.wire, draft: { ...f.wire.draft, eventTime, sources: [{ label: 'E1', quote: '温室检修日期为2026-04-01至2026-04-03。' }] } }
  expect(f.parse(value).draft?.meaning.eventTime).toEqual(eventTime)
  for (const time of [{ kind: 'date', date: '2026-09-21' }, { ...eventTime, end: '2026-03-01' }, { kind: 'instant', epochMs: 1790000000000 }])
    expect(() => f.parse({ ...value, draft: { ...value.draft, eventTime: time } })).toThrow()
  expect(() => f.parse({ ...f.wire, draft: { ...f.wire.draft, eventTime } })).toThrow('draft-date-not-in-quote')
})

it('rejects fabricated quotes, labels, fields and assistant speech promoted to facts or fulfilled promises', async () => {
  const f = await fixture()
  for (const sources of [[{ label: 'E9', quote: 'R8' }], [{ label: 'E1', quote: '没有这句话' }]])
    expect(() => f.parse({ ...f.wire, draft: { ...f.wire.draft, sources } })).toThrow('draft-quote')
  expect(() => f.parse({ ...f.wire, draft: { ...f.wire.draft, id: 'invented-id' } })).toThrow('draft-fields')
  const speech = { ...f.wire, draft: { ...f.wire.draft, subject: 'S2', kind: 'event', content: speakers.assistant.prefix + f.session.messages[1]!.content,
    sources: [{ label: 'E2', quote: f.session.messages[1]!.content }] } }
  expect(f.parse(speech).draft?.meaning.content).toContain('尚未执行')
  expect(() => f.parse({ ...speech, draft: { ...speech.draft, kind: 'fact' } })).toThrow('draft-assistant-scope')
  expect(() => f.parse({ ...speech, draft: { ...speech.draft, content: '助手已经完成订货。' } })).toThrow('draft-assistant-scope')
  expect(() => f.parse({ ...f.wire, draft: { ...f.wire.draft, kind: 'pattern', uncertainty: '尚待验证' } })).toThrow('draft-insufficient-evidence')
})

it('rejects changed original bytes before calling a Provider or submitting a Note', async () => {
  const f = await fixture(); let claimed = false
  f.session.messages[0] = { role: 'user', content: '原始内容已经更改' }
  const bridge: NoteFormationBridge = { delivered: vi.fn(async () => {}), flush: vi.fn(async () => {}),
    next: vi.fn(async () => claimed ? null : (claimed = true, { id: 'guard', attempt: 1, sessionId: f.session.id, refs: [f.refs[0]!] })),
    prepare: vi.fn(async () => f.context), submit: vi.fn(async () => {}), fail: vi.fn(async () => {}) }
  const complete = vi.fn(async () => ({ text: '{"items":[]}' }))
  const runner = createNoteFormation(bridge, () => [f.session], () => undefined)
  try {
    runner.setProvider({ id: 'synthetic', complete })
    await vi.waitFor(() => expect(bridge.fail).toHaveBeenCalledWith('guard', 1, expect.objectContaining({ code: 'source-changed' })))
    expect(complete).not.toHaveBeenCalled(); expect(bridge.submit).not.toHaveBeenCalled()
  } finally { runner.setProvider(undefined) }
})
