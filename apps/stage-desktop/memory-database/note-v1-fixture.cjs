const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [a, b] = [uid(1), uid(2)]
const ref = n => ({ sessionId: 'fictional-session', messageIndex: n,
  digest: createHash('sha256').update(JSON.stringify({ role: 'user', content: `虚构消息 ${n}` })).digest('hex') })
const sources = (n = 0) => ({ origins: [{ reflectionId: `fictional-reflection-${n}` }], evidence: [ref(n)] })
const emptySources = { origins: [], evidence: [] }
const meaning = { content: '虚构温室决定使用蓝灯。', subject: '月球温室', basis: 'direct', eventTime: null,
  context: '测试场景', keywords: ['蓝灯'], tags: [] }
const add = { id: a, operationId: uid(101), action: 'ADD', reason: '固定虚构产物', sources: sources(), meaning }
const change = (n, action, expectedVersion, fields = {}) => ({ id: a, operationId: uid(n), action, expectedVersion,
  reason: '虚构变更', sources: emptySources, ...fields })
const update = change(103, 'UPDATE', 1, { sources: sources(1), meaning: { ...meaning, basis: 'mixed', uncertainty: '日期精度仅到天',
  content: '虚构更正：当时用蓝灯的范围只包含东区。', eventTime: { kind: 'date', date: '2024-02-29' } } })
const supersede = change(104, 'SUPERSEDE', 2, { sources: sources(2), newId: b, transition: 'explicit-same-scope-change',
  meaning: { ...meaning, content: '虚构温室明确改用红灯。', eventTime: { kind: 'date-range', start: '2025-01-02', end: '2025-01-04' } } })
const retract = change(105, 'RETRACT', 3)
const code = code => ({ code })

async function writeNoteFixture(store) {
  await assert.rejects(store.createNote({ id: a, content: 'old endpoint', createdAt: 0 }), code('unknown-operation'))
  await assert.rejects(store.transaction([{ type: 'addEvidence', noteId: a, evidence: ref(0) }]), code('unknown-operation'))
  await assert.rejects(store.applyNoteOperation({ ...add, sources: emptySources }), code('missing-grounds'))
  await assert.rejects(store.applyNoteOperation({ ...add, unexpected: true }), code('invalid-payload'))
  await assert.rejects(store.applyNoteOperation({ ...add, id: uid(1).replace('8000', 'A000') }), code('invalid-payload'))
  for (const eventTime of [{ kind: 'date', date: '2025-02-29' }, { kind: 'date-range', start: '2025-02-01', end: '2025-01-01' },
    { kind: 'instant', epochMs: '2025-01-02T00:00:00' }, { kind: 'date', date: '2025-01-01', offset: '+08:00' }]) {
    await assert.rejects(store.applyNoteOperation({ ...add, meaning: { ...meaning, eventTime } }), code('invalid-payload'))
  }
  await assert.rejects(store.applyNoteOperation({ ...add, meaning: { ...meaning, basis: 'inferred' } }), code('invalid-payload'))
  await assert.rejects(store.applyNoteOperation(change(102, 'NOOP', 1, { sources: sources(1) })), code('note-missing'))
  const receipt = await store.applyNoteOperation(add)
  assert.deepEqual(receipt.affectedNotes, [{ id: a, version: 1 }])
  assert.deepEqual(await store.getNoteV1(a), { ...meaning, id: a, createdAt: receipt.changedAt, status: 'active', version: 1 })
  assert.deepEqual(await store.applyNoteOperation({ ...add, sources: { origins: sources().origins,
    evidence: [ref(0), { digest: ref(0).digest, sessionId: ref(0).sessionId, messageIndex: 0 }] } }), receipt)
  await assert.rejects(store.applyNoteOperation({ ...add, reason: '不同 payload' }), code('operation-id-conflict'))
  await assert.rejects(store.applyNoteOperation({ ...add, operationId: uid(102) }), code('note-id-conflict'))
  assert.equal(await store.getOperationReceipt(uid(102)), null)
  const first = await store.getRevision(a, 1)
  assert.equal(first.operationId, add.operationId)
  assert.equal(first.action, 'ADD')
  assert.equal(first.reason, add.reason)
  assert.deepEqual(first.grounds, add.sources)
  assert.equal(first.snapshot.eventTime, null)
  assert.equal((await store.applyNoteOperation(change(102, 'NOOP', 1, { sources: sources() }))).links, undefined)
  for (let n = 5; n >= 1; n--) {
    const receipt = await store.applyNoteOperation(change(110 + n, 'NOOP', 1, { sources: sources(n) }))
    assert.deepEqual(receipt.links, sources(n))
    assert.deepEqual(receipt.affectedNotes, [{ id: a, version: 1 }])
  }
  const page = await store.getVersionSourceChanges(a, 1)
  assert.deepEqual(page.changes.map(receipt => receipt.operationId), [111, 112, 113, 114].map(uid))
  assert.equal(page.nextCursor, uid(114))
  const rest = await store.getVersionSourceChanges(a, 1, page.nextCursor)
  assert.deepEqual(rest.changes.map(receipt => receipt.operationId), [uid(115)])
  assert.equal(rest.nextCursor, null)
  assert.equal((await store.applyNoteOperation(change(116, 'NOOP', 1, { sources: sources(1) }))).links, undefined)
  assert.equal(await store.getRevision(a, 2), null)
  await assert.rejects(store.applyNoteOperation({ ...update, meaning }), code('no-semantic-change'))
  await assert.rejects(store.applyNoteOperation({ ...update, sources: emptySources }), code('missing-grounds'))
  const concurrent = await Promise.allSettled([store.applyNoteOperation(update),
    store.applyNoteOperation({ ...update, operationId: uid(120), meaning: { ...meaning, content: '竞争更新' } })])
  assert.equal(concurrent[0].status, 'fulfilled')
  assert.equal(concurrent[1].reason.code, 'stale-version')
  assert.equal(await store.getOperationReceipt(uid(120)), null)
  await assert.rejects(store.applyNoteOperation(change(121, 'NOOP', 1, { sources: sources(5) })), code('stale-version'))
  assert.deepEqual((await store.getRevision(a, 2)).grounds, sources(1))
  assert.deepEqual((await store.getVersionSourceChanges(a, 2)).changes, [])
  assert.deepEqual(await store.getRevision(a, 1), first)
  await assert.rejects(store.applyNoteOperation({ ...supersede, meaning: { ...supersede.meaning, subject: '另一主体' } }), code('transition-grounds'))
  await assert.rejects(store.applyNoteOperation({ ...supersede, newId: a }), code('note-id-conflict'))
  const replacement = await store.applyNoteOperation(supersede)
  assert.deepEqual(replacement.affectedNotes, [{ id: b, version: 1 }, { id: a, version: 3 }])
  assert.equal((await store.getNoteV1(a)).status, 'superseded')
  await assert.rejects(store.applyNoteOperation(change(122, 'UPDATE', 3, { meaning, sources: sources() })), code('invalid-transition'))
  await store.applyNoteOperation(retract)
  await assert.rejects(store.applyNoteOperation({ ...retract, operationId: uid(123), expectedVersion: 4 }), code('invalid-transition'))
  const instant = { kind: 'instant', epochMs: Date.parse('2025-01-02T00:15:00+08:00') }
  await store.applyNoteOperation({ ...add, id: uid(3), operationId: uid(124), meaning: { ...meaning, eventTime: instant } })
  assert.deepEqual((await store.getNoteV1(uid(3))).eventTime, instant)
  await verifyNoteFixture(store)
}

async function verifyNoteFixture(store) {
  const [first, second, third, last, next] = await Promise.all([
    store.getRevision(a, 1), store.getRevision(a, 2), store.getRevision(a, 3), store.getRevision(a, 4), store.getRevision(b, 1),
  ])
  assert.deepEqual([first, second, third, last].map(r => r.snapshot.status), ['active', 'active', 'superseded', 'retracted'])
  assert([second, third, last].every(r => r.snapshot.createdAt === first.snapshot.createdAt))
  assert.equal(second.snapshot.uncertainty, update.meaning.uncertainty)
  assert.deepEqual(second.snapshot.eventTime, update.meaning.eventTime)
  assert.equal(third.successorId, b)
  assert.equal(next.operationId, third.operationId)
  assert.deepEqual(next.snapshot.eventTime, supersede.meaning.eventTime)
  assert.deepEqual(await store.getNoteV1(b), next.snapshot)
  assert.deepEqual(await store.getNoteV1(a), last.snapshot)
  assert.equal((await store.getVersionSourceChanges(a, 1)).changes.length, 4)
  const receipt = await store.getOperationReceipt(add.operationId)
  assert.deepEqual(await store.applyNoteOperation(add), receipt)
  assert.deepEqual(await store.applyNoteOperation(supersede), await store.getOperationReceipt(supersede.operationId))
}

module.exports = { uid, sources, add, change, supersede, writeNoteFixture, verifyNoteFixture }
