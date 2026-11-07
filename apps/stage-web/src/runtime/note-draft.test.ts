import { expect, it } from 'vitest'
import { sourceRef } from './reflection-formation'
import { adaptReflectionDrafts, assertDraftTarget, type DraftProposal } from './note-draft'
import type { ConversationSession } from '../conversation/conversation-store'
import type { Reflection } from './reflection-store'

async function setup() {
  const session: ConversationSession = { id: 'draft-session', title: '', createdAt: 0, updatedAt: 0, messages: [
    { role: 'user', content: '温室门牌更正为 R8。仓库门铃改为木铃。检修日期为2026-04-01至2026-04-03。', createdAt: 1790000000000 },
    { role: 'assistant', content: '我承诺替你订货，尚未执行。' },
  ] }
  const evidence = await Promise.all(session.messages.map(async (message, i) => ({ label: `E${i + 1}`, ref: await sourceRef(session.id, i, message) })))
  const reflection: Reflection = { id: 'formation-product', version: 1, content: '用户报告门牌与门铃变化。', kind: 'fact', basis: 'direct',
    tags: ['不是主体的标签'], sourceRefs: evidence.map(e => e.ref), relatedReflectionIds: ['fallible-related'], createdAt: 1790000000100 }
  const target = { id: 'confirmed-note', version: 2, subject: '温室' }
  const subjects = [{ label: 'S1', subject: '温室', confirmed: true, targets: [target], mentions: [
    { label: 'E1', text: '温室' }, { label: 'E1', text: '检修日期' }, { label: 'E2', text: '替你订货' },
  ] }, { label: 'S2', subject: '仓库', confirmed: true, targets: [], mentions: [{ label: 'E1', text: '仓库' }] }]
  const context = { evidence, subjects, getSessions: () => [session] }
  const proposal: DraftProposal = { content: '温室门牌更正为 R8。', subject: 'S1', subjectDescription: '温室入口门牌', eventTime: null,
    kind: 'fact', basis: 'direct', tags: ['门牌'], sources: [{ label: 'E1', quote: '温室门牌更正为 R8。' }] }
  return { session, reflection, context, proposal, target }
}

it('uses confirmed subject identity, preserves a narrower description and never takes the first tag', async () => {
  const f = await setup(), [draft] = await adaptReflectionDrafts(f.reflection, [f.proposal], f.context)
  expect(draft).toMatchObject({ subject: '温室', subjectDescription: '温室入口门牌', eventTime: null,
    origins: [{ reflectionId: f.reflection.id }], evidence: [f.context.evidence[0]!.ref], sourceCategories: ['user-report'] })
  expect(() => assertDraftTarget(draft!, f.target)).not.toThrow()
  expect(() => assertDraftTarget(draft!, { ...f.target, subject: '仓库' })).toThrow('draft-target-not-confirmed')
  expect(() => assertDraftTarget(draft!, { ...f.target, version: 3 })).toThrow('draft-target-not-confirmed')
  expect(() => assertDraftTarget(draft!, { ...f.target, id: 'another-note' })).toThrow('draft-target-not-confirmed')
})

it('fails closed on unknown, duplicate or unconfirmed anchors instead of coercing free text', async () => {
  const f = await setup()
  for (const subjects of [[], [...f.context.subjects, f.context.subjects[0]!], [{ ...f.context.subjects[0]!, confirmed: false }]])
    await expect(adaptReflectionDrafts(f.reflection, [f.proposal], { ...f.context, subjects })).rejects.toThrow('subject-unconfirmed')
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, subject: '温室入口门牌' }], f.context)).rejects.toThrow('subject-unconfirmed')
})

it('maps explicitly proposed atomic pieces to their own quotes without inventing extra sources or relations', async () => {
  const f = await setup()
  const second: DraftProposal = { ...f.proposal, content: '仓库门铃改为木铃。', subject: 'S2', sources: [{ label: 'E1', quote: '仓库门铃改为木铃。' }] }
  const drafts = await adaptReflectionDrafts(f.reflection, [f.proposal, second], f.context)
  expect(drafts.map(d => d.content)).toEqual([f.proposal.content, second.content])
  expect(drafts.every(d => d.origins[0]!.reflectionId === f.reflection.id)).toBe(true)
  expect(drafts.every(d => d.evidence.length === 1)).toBe(true)
  expect(drafts[0]).not.toHaveProperty('relatedReflectionIds')
  await expect(adaptReflectionDrafts(f.reflection, [{ ...second, subject: 'S1' }], f.context)).rejects.toThrow('draft-subject-not-in-quote')
  await expect(adaptReflectionDrafts({ ...f.reflection, sourceRefs: [f.context.evidence[1]!.ref] }, [f.proposal], f.context))
    .rejects.toThrow('draft-source-outside-origin')
})

it('keeps unknown times null and only maps real dates from the selected quote', async () => {
  const f = await setup()
  expect((await adaptReflectionDrafts(f.reflection, [f.proposal], f.context))[0]!.eventTime).toBeNull()
  const time = { kind: 'date-range' as const, start: '2026-04-01', end: '2026-04-03' }
  const proposal = { ...f.proposal, content: '温室检修于2026-04-01至2026-04-03。', eventTime: time,
    sources: [{ label: 'E1', quote: '检修日期为2026-04-01至2026-04-03。' }] }
  expect((await adaptReflectionDrafts(f.reflection, [proposal], f.context))[0]!.eventTime).toEqual(time)
  for (const eventTime of [{ kind: 'date' as const, date: '2026-09-21' }, { ...time, end: '2026-03-01' }, { kind: 'instant' as const, epochMs: 1790000000000 }])
    await expect(adaptReflectionDrafts(f.reflection, [{ ...proposal, eventTime }], f.context)).rejects.toThrow()
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, eventTime: { kind: 'date', date: '2026-04-01' } }], f.context))
    .rejects.toThrow('draft-date-not-in-quote')
})

it('revalidates original source bytes and quote scope and rejects invented fields', async () => {
  const f = await setup()
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, sources: [{ label: 'E9', quote: 'R8' }] }], f.context)).rejects.toThrow()
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, sources: [{ label: 'E1', quote: '没有这句话' }] }], f.context)).rejects.toThrow('draft-quote-not-in-source')
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, id: 'model-id' } as DraftProposal], f.context)).rejects.toThrow('draft-fields')
  f.session.messages[0] = { ...f.session.messages[0]!, content: '改写原消息' }
  await expect(adaptReflectionDrafts(f.reflection, [f.proposal], f.context)).rejects.toThrow('draft-digest-mismatch')
})

it('preserves assistant speech boundaries and rejects a single report promoted to a pattern', async () => {
  const f = await setup()
  const speech = { ...f.proposal, content: '助手承诺订货但尚未执行。', kind: 'event' as const, sources: [{ label: 'E2', quote: '我承诺替你订货，尚未执行。' }] }
  expect((await adaptReflectionDrafts(f.reflection, [speech], f.context))[0]!.sourceCategories).toEqual(['assistant-speech'])
  await expect(adaptReflectionDrafts(f.reflection, [{ ...speech, kind: 'fact' }], f.context)).rejects.toThrow('draft-assistant-only-claim')
  await expect(adaptReflectionDrafts(f.reflection, [{ ...f.proposal, kind: 'pattern', uncertainty: '尚待验证' }], f.context)).rejects.toThrow('draft-pattern-evidence')
})
