const assert = require('node:assert/strict')
const { test } = require('node:test')
const { formationInput, parseNoteProposals } = require('./note-formation-contract.mjs')
const speakers = require('./memory-subjects.json')

const row = (i, content, scope = 'current', role = 'user') => ({
  ref: { sessionId: 'fixture-' + i, messageIndex: 0, digest: String(i).repeat(64) },
  message: { role, content, createdAt: i }, scope,
})
const context = {
  speakers, notes: [{ id: 'test-note', version: 2, subject: speakers.user.subject, kind: 'fact', basis: 'direct', content: '旧采购状态', eventTime: null }],
  evidence: [
    row(1, '去年考虑购买手碟但没有买，现在已经买了，尚未开始练习。'),
    row(2, '原本计划练习，但没有开始。', 'history'),
    row(3, '我会让手碟飞起来。', 'current', 'assistant'),
    row(4, '2026-02-20 完成练习。'),
  ],
}
const proposal = {
  action: 'ADD', target: null, reason: '用户报告了状态变化',
  draft: {
    content: '用户报告去年未购买手碟，现在已购买但尚未练习。', kind: 'fact', basis: 'direct',
    subject: 'S1', eventTime: null, tags: ['手碟'],
    sources: [{ label: 'E1', quote: context.evidence[0].message.content }],
  },
}
const parse = (item, source = context) => parseNoteProposals(JSON.stringify({ items: [item] }), source)[0]

test('projects temporary labels and binds a v2 draft to exact source, subject and target', () => {
  const request = formationInput(context)
  const input = JSON.parse(request.messages[1].content)
  assert.equal(input.evidence[1].scope, 'history')
  assert.equal(input.candidates[0].subjectAnchor, 'S1')
  assert.doesNotMatch(request.messages[1].content, /fixture-|test-note|digest|version|reflectionId/)
  assert.deepEqual(parseNoteProposals('{"items":[]}', context), [])
  assert.equal(parse(proposal).draft.meaning.eventTime, null)
  assert.equal(parse(proposal).draft.meaning.content, proposal.draft.content)
  assert.deepEqual(parse({ ...proposal, action: 'UPDATE', target: 'N1' }).target, context.notes[0])
  assert.equal(parse({ ...proposal, draft: { ...proposal.draft, subject: 'S3' } }).draft.confirmed, false)
})

test('supports multi-experience inference and requires distinct current-grounded user reports', () => {
  const draft = { ...proposal.draft, kind: 'pattern', basis: 'inferred', uncertainty: '只覆盖两个报告',
    content: '在两次用户报告中，计划未立即转为练习。' }
  const history = { label: 'E2', quote: context.evidence[1].message.content }
  assert.throws(() => parse({ ...proposal, draft }), /insufficient-evidence/)
  assert.throws(() => parse({ ...proposal, draft: { ...draft, sources: [history] } }), /current-source/)
  const result = parse({ ...proposal, draft: { ...draft, sources: [...draft.sources, history] } })
  assert.equal(result.draft.citations.length, 2)
  assert.equal(result.draft.meaning.kind, 'pattern')
})

test('rejects forged labels, quotes, dates, identities and v1 fields', () => {
  for (const [patch, reason] of [
    [{ subject: 'S99' }, /draft-subject/],
    [{ subject: 'profile-user' }, /draft-subject/],
    [{ sources: [{ label: 'E99', quote: '手碟' }] }, /draft-quote/],
    [{ sources: [{ label: 'E1', quote: '从未出现的引文' }] }, /draft-quote/],
    [{ eventTime: { kind: 'date', date: '2026-02-30' } }, /draft-date/],
    [{ eventTime: { kind: 'date', date: '2026-02-20' } }, /not-in-quote/],
    [{ context: 'obsolete' }, /draft-fields/],
  ]) assert.throws(() => parse({ ...proposal, draft: { ...proposal.draft, ...patch } }), reason)
  assert.throws(() => parse({ ...proposal, action: 'UPDATE', target: 'N99' }), /proposal-target/)
  assert.throws(() => parse({ ...proposal, related: ['N99'] }), /proposal-related/)
  assert.throws(() => parse({ ...proposal, origin: 'O1' }), /proposal-fields/)
  const time = { kind: 'date', date: '2026-02-20' }
  assert.deepEqual(parse({ ...proposal, draft: { ...proposal.draft, eventTime: time,
    sources: [{ label: 'E4', quote: '2026-02-20 完成练习' }] } }).draft.meaning.eventTime, time)
})

test('assistant-only speech requires a literal attributed event', () => {
  const quote = context.evidence[2].message.content
  const draft = { ...proposal.draft, subject: 'S2', sources: [{ label: 'E3', quote }] }
  assert.throws(() => parse({ ...proposal, draft }), /assistant-scope/)
  assert.equal(parse({ ...proposal, draft: { ...draft, kind: 'event', content: speakers.assistant.prefix + quote } }).draft.meaning.kind, 'event')
})
