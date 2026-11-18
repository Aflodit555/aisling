const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { test } = require('node:test')
const { formationExamples, formationInput, parseNoteBatch } = require('./note-formation-contract.mjs')
const { authorizeOrganization, planNoteRelation } = require('./note-organization-v2.mjs')
const { semanticRelationPlan } = require('./note-semantic-contract.mjs')
const { discoverCandidates } = require('./note-candidates.mjs')
const speakers = require('./memory-subjects.json')
const { messageDigest } = require('./memory-evidence.cjs')
const entry = (text, index, scope = 'current') => ({ ref: { sessionId: 'synthetic', messageIndex: index,
  digest: messageDigest({ role: 'user', content: text }) }, message: { role: 'user', content: text }, scope })
const note = (id, value) => ({ id, version: 1, status: 'active', createdAt: 1, subject: 'profile-user', basis: 'direct', kind: 'project-state',
  content: `用户报告用${value}整理目录。`, eventTime: null, state: { scope: '整理目录', value } })
const results = {}

test('three complete Prompt examples match the unchanged Parser and authorization contract', () => {
  const a = entry('我现在暂停练习钢琴。', 1), old = entry('我之前开始练习钢琴。', 0, 'history')
  const prior = { ...note('prior', '开始'), content: old.message.content, state: { scope: '练习钢琴', value: '开始' } }
  const contexts = [
    { speakers, notes: [prior], candidatesComplete: true, noteGrounds: { prior: [old.ref] }, evidence: [a, old] },
    { speakers, notes: [], candidatesComplete: true, evidence: [entry('后来我改用木箱做猫窝。', 1), entry('之前我尝试用纸箱做猫窝，效果不好。', 0, 'history')] },
    { speakers, notes: [], candidatesComplete: true, evidence: [entry('之前我尝试用纸箱做猫窝，效果不好，后来我改用木箱做猫窝。', 0)] },
  ]
  const oldContract = process.env.COORDINATION_BASELINE
    ? require(path.join(path.dirname(process.env.COORDINATION_BASELINE), 'note-formation-contract.mjs')) : undefined
  results.contract = []
  for (const [i, context] of contexts.entries()) {
    const item = parseNoteBatch(JSON.stringify({ items: [formationExamples[i]] }), context)[0]
    assert(item.proposal, item.error)
    const previous = oldContract?.parseNoteBatch(JSON.stringify({ items: [formationExamples[i]] }), context)[0]
    if (oldContract) assert(previous.proposal, previous.error)
    results.contract.push({ scenario: i + 1, before: oldContract ? !!previous.proposal : null, after: !!item.proposal })
    assert(authorizeOrganization(item.proposal, { heads: context.notes.map(note => ({ note })), complete: true,
      lookup: ref => context.evidence.find(e => e.ref.digest === ref.digest)?.message }))
    const invalid = structuredClone(formationExamples[i]); invalid.semantic.relation = 'state-change'; invalid.semantic.target = null
    assert.throws(() => parseNoteBatch(JSON.stringify({ items: [invalid] }), context), /semantic-target/)
    const state = structuredClone(formationExamples[i]); state.draft.state = { scope: '不存在的状态维度', value: '完成' }
    assert.throws(() => parseNoteBatch(JSON.stringify({ items: [state] }), context), /draft-state/)
    assert(Buffer.byteLength(JSON.stringify(formationInput(context).messages)) <= 15000)
  }
  assert.equal(formationExamples[1].semantic.relation, 'independent')
})

test('relative replacement proof distinguishes event order from shared sources, topics, negation and contradictory dates', () => {
  const a = note('a', '方案A'), b = note('b', '方案B')
  const cases = [
    ['relative', '之前我用方案A整理目录，效果不好，后来我改用方案B整理目录。', true],
    ['no-order', '我用方案A整理目录，也用方案B整理目录。', false],
    ['topics', '之前我用方案A整理目录，后来我用方案B整理目录。', false],
    ['hypothetical', '假如之前我用方案A整理目录，后来我改用方案B整理目录。', false],
    ['negated', '之前我用方案A整理目录，后来我没有改用方案B整理目录。', false],
    ['ambiguous', '之前我用方案A和方案B整理目录，后来我改用方案B整理目录。', false],
    ['conflicting', '之前我用方案A整理目录，后来我改用方案B整理目录。之前我用方案B整理目录，后来我改用方案A整理目录。', false],
  ]
  const before = process.env.COORDINATION_BASELINE ? require(process.env.COORDINATION_BASELINE) : undefined
  const rows = cases.map(([id, text, expected]) => {
    const source = entry(text, 0), make = n => ({ note: n, grounds: { evidence: [source.ref] } })
    const args = ['STATE_CHANGE', '整理目录', make(a), make(b), [source.ref], () => source.message, '合成原文中的明确替换']
    const plan = semanticRelationPlan(...args)
    assert.equal(!!plan, expected, id)
    if (plan) { assert.equal(plan.from, 'a'); assert.equal(plan.to, 'b'); assert.equal(plan.order, 'event'); assert.match(plan.uncertainty, /相对|无绝对/) }
    const reverse = semanticRelationPlan('STATE_CHANGE', '整理目录', make(b), make(a), [source.ref], () => source.message, '反向输入')
    if (expected) assert.equal(reverse.from, 'a')
    const contradictory = semanticRelationPlan('STATE_CHANGE', '整理目录', make({ ...a, eventTime: { kind: 'date', date: '2026-01-02' } }),
      make({ ...b, eventTime: { kind: 'date', date: '2026-01-01' } }), [source.ref], () => source.message, '冲突日期')
    if (id === 'relative') assert.equal(contradictory, null)
    return { id, expected, before: before ? !!before.semanticRelationPlan(...args) : null, after: !!plan }
  })
  const source = entry('之前我用方案A整理目录，后来我改用方案B整理目录。', 0)
  const shared = n => ({ note: n, grounds: { evidence: [source.ref] } })
  const contrary = entry('更正之前的说法，并没有换用方案B。', 1)
  assert.equal(semanticRelationPlan('STATE_CHANGE', '整理目录', shared(a), shared(b), [source.ref, contrary.ref],
    ref => ref.messageIndex === 0 ? source.message : contrary.message, '更正不能被旧共享证据掩盖'), null)
  assert.equal(semanticRelationPlan('STATE_CHANGE', '整理目录', shared({ ...a, state: undefined }), shared({ ...b, state: undefined }), [source.ref], () => source.message, '无字面状态锚点'), null)
  results.temporal = rows
  const earlier = entry('我之前用方案A整理目录。', 0, 'history'), later = entry('我现在用方案B整理目录。', 1)
  const first = { note: a, grounds: { evidence: [earlier.ref] } }, second = { note: b, grounds: { evidence: [earlier.ref, later.ref] } }
  const lookup = ref => ref.messageIndex === 0 ? earlier.message : later.message
  assert.equal(planNoteRelation(first, second, lookup), null)
  results.overlapReport = { before: process.env.COORDINATION_BASELINE ? !!require(path.join(path.dirname(process.env.COORDINATION_BASELINE), 'note-organization-v2.mjs')).planNoteRelation(first, second, lookup) : null,
    after: !!planNoteRelation(first, second, lookup) }
})

test('frozen candidate comparison reports Top-5 hits and false candidates, including vector mistakes', () => {
  const scenarios = [
    { id: 'lexical', query: '图书馆蓝色椅子', docs: ['图书馆买了蓝色椅子', '工作室买了蓝色椅子'], target: [0], hits: [[0,.95],[1,.7]] },
    { id: 'paraphrase', query: '停止继续使用检索程序', docs: ['Cedar indexes catalogues.', 'Glass celebrates summer.'], target: [0], hits: [[0,.95],[1,.4]] },
    { id: 'cross-session', query: 'We ceased deploying the solution.', docs: ['青杉系统开始内测', 'Garnet exports receipts.'], target: [0], hits: [[0,.9]] },
    { id: 'different-events', query: '图书馆蓝色椅子', docs: ['工作室买了蓝色椅子', '图书馆买了蓝色椅子'], target: [1], hits: [[0,.97],[1,.8]] },
    { id: 'unrelated', query: '停止继续使用检索程序', docs: ['Glass celebrates summer.'], target: [], hits: [[0,.7]] },
    { id: 'missed-vector', query: '停止继续使用检索程序', docs: ['Cedar indexes catalogues.'], target: [0], hits: [[0,.2]] },
  ]
  results.retrieval = scenarios.map(s => {
    const heads = s.docs.map((content, i) => ({ note: { id: String(i), version: 1, content, subject: 'profile-user', tags: [] } }))
    const run = vectors => { const started = performance.now(); const found = discoverCandidates(s.query, heads, vectors).candidates.slice(0,5)
      return { targetHit: s.target.some(i => found.some(c => c.head.note.id === String(i))), falseCandidates: found.filter(c => !s.target.includes(Number(c.head.note.id))).length,
        channels: found.map(c => ({ id: c.head.note.id, channels: c.channels })), ms: performance.now() - started } }
    return { id: s.id, target: s.target, lexical: run([]), hybrid: run(s.hits.map(([i,score]) => ({ noteId: String(i), noteVersion: 1, score }))) }
  })
  assert(results.retrieval.find(r => r.id === 'paraphrase').hybrid.targetHit)
  assert(!results.retrieval.find(r => r.id === 'paraphrase').lexical.targetHit)
  assert(results.retrieval.find(r => r.id === 'unrelated').hybrid.falseCandidates > 0)
  if (process.env.COORDINATION_RESULT) fs.writeFileSync(process.env.COORDINATION_RESULT, JSON.stringify(results, null, 2))
})
