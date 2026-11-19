const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { test } = require('node:test'), { randomUUID } = require('node:crypto')
const { publish, digest } = require('./publish-reflection-migration.cjs')
const transfer = require('./unify-memory-profile.cjs')
const { createNoteV2Store } = require('../apps/stage-desktop/memory-database/store.cjs')
const { operationFingerprint } = require('../apps/stage-desktop/memory-database/note-v1.cjs')
const { messageDigest } = require('../apps/stage-desktop/memory-evidence.cjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared native Worker required', timeout: 60000 }

async function fixture({ duplicate = false, blocked = false, question = false, enqueue = false } = {}) {
  const root = path.resolve(__dirname, '../artifacts/memory-v0.4.0-p4b/tests'); fs.mkdirSync(root, { recursive: true })
  const run = fs.realpathSync(fs.mkdtempSync(path.join(root, 'publish-'))), profile = path.join(run, 'profile'), id = randomUUID()
  fs.mkdirSync(profile); fs.mkdirSync(path.join(profile, 'legacy-profile-archive')); fs.mkdirSync(path.join(profile, 'memory-note-v2'))
  const message = { role: 'user', content: question ? '你知道吗？我喜欢安静的房间。' : '我喜欢安静的房间。' }
  const ref = { sessionId: 'synthetic', messageIndex: 0, digest: messageDigest(message) }
  const data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [{ id: ref.sessionId, messages: [message] }] }) }
  fs.writeFileSync(path.join(profile, 'aisling-store.json'), JSON.stringify(data))
  fs.writeFileSync(path.join(profile, 'memory-authority'), 'note-v2\n')
  fs.writeFileSync(path.join(profile, 'memory-erasure.v1.json'), JSON.stringify({ version: 2, pending: [], blocked: { sources: [], sessions: [] } }))
  if (enqueue) fs.writeFileSync(path.join(profile, 'note-formation-jobs.v1.json'), JSON.stringify({ version: 1, progress: { synthetic: 1 }, batches: [],
    organization: { cursor: '', bootstrapped: true, tasks: [{ id: randomUUID(), version: 1, status: 'completed', attempts: 1 }] } }))
  const original = { id: randomUUID(), content: message.content, sourceRefs: [ref] }
  fs.writeFileSync(path.join(profile, 'legacy-profile-archive/aisling-reflections.v1.json'), JSON.stringify({ version: 1, reflections: [original] }))
  const op = { action: 'ADD', id: randomUUID(), operationId: randomUUID(), reason: 'Synthetic original user evidence', meaning: {
    subject: 'profile-user', content: '用户表示喜欢安静的房间。', kind: 'preference', basis: 'direct', eventTime: null, tags: ['房间'] }, sources: { evidence: [ref] }, contextEvidence: [] }
  const admin = () => createNoteV2Store(async () => ({ node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'),
    file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }), () => {}, { readData: () => data, isSubjectConfirmed: () => true })
  const seed = admin(); try {
    await seed.open()
    if (duplicate) await seed.applyNoteOperation({ ...op, id: randomUUID(), operationId: randomUUID() })
    if (blocked) await seed.installErasureBarriers(['session:' + require('../apps/stage-desktop/memory-database/erasure.cjs').hash(ref.sessionId)])
  } finally { await seed.close() }
  const files = transfer.inventory(profile); transfer.copy(profile, path.join(run, 'backup/profile'), files)
  fs.writeFileSync(path.join(profile, '.p4b-isolated-profile.json'), JSON.stringify({ id, role: 'isolated-p4b-rehearsal' }))
  const { subject, ...meaning } = op.meaning, citations = [{ label: 'E1', quote: message.content }]
  const plan = { version: 1, id, kind: 'p4b-reviewed-reflection-migration', run, profile, rehearsalProfile: profile, resources, sourceFiles: files,
    records: [{ reviewId: 'R01', reflectionId: original.id, originalReflectionDigest: digest(original), category: 'A', approvedRefs: [ref], approvedContext: [] }],
    ...(enqueue && { postCommit: { registerImportedNotes: true } }),
    operations: [{ reviewIds: ['R01'], operation: op, wire: { action: 'ADD', target: null, reason: op.reason, draft: { ...meaning, subject: 'S1', sources: citations },
      semantic: { relation: 'independent', target: null, scope: '房间偏好', sources: citations, targetSources: [] } }, approved: null }], approval: { operations: [] } }
  return { plan, admin, profile, run }
}

test('publish receipts recover a lost successful reply and repeated execution creates no extra versions', native, async () => {
  const f = await fixture()
  await assert.rejects(publish({ plan: f.plan, mode: 'rehearse', checkpoint: phase => { if (phase === 'after-commit') throw Error('lost reply') } }), /lost reply/)
  assert.equal((await publish({ plan: f.plan, mode: 'rehearse' })).reused, 1)
  assert.equal((await publish({ plan: f.plan, mode: 'rehearse' })).applied, 0)
  const store = f.admin(); try { await store.open(); const page = await store.listRecallHeads(''); assert.equal(page.notes.length, 1); assert.equal(page.notes[0].note.version, 1) } finally { await store.close() }
  const changed = structuredClone(f.plan); changed.operations[0].operation.meaning.content = 'changed'
  await assert.rejects(publish({ plan: changed, mode: 'rehearse' }), /manifest changed/)
})

test('queue registration survives interruption without resetting P1 progress or losing existing tasks', native, async () => {
  const f = await fixture({ enqueue: true }), file = path.join(f.profile, 'note-formation-jobs.v1.json')
  const before = JSON.parse(fs.readFileSync(file))
  await assert.rejects(publish({ plan: f.plan, mode: 'rehearse', checkpoint: phase => { if (phase === 'after-jobs') throw Error('queue reply lost') } }), /queue reply lost/)
  const bytes = fs.readFileSync(file, 'utf8')
  const result = await publish({ plan: f.plan, mode: 'rehearse' })
  assert.equal(result.applied, 0); assert.equal(result.reused, 1); assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  const after = JSON.parse(bytes)
  assert.deepEqual(after.progress, before.progress); assert.deepEqual(after.batches, before.batches)
  assert(after.organization.tasks.some(task => JSON.stringify(task) === JSON.stringify(before.organization.tasks[0])))
  assert.equal(after.organization.tasks.length, 2)
  assert(after.embeddingPriority.includes(f.plan.operations[0].operation.id))
})

test('equivalent existing Notes are skipped without a duplicate Note or synthetic Receipt', native, async () => {
  const f = await fixture({ duplicate: true }), result = await publish({ plan: f.plan, mode: 'rehearse' })
  assert.equal(result.covered, 1); assert.equal(result.applied, 0)
  const store = f.admin(); try { await store.open(); assert.equal((await store.listRecallHeads('')).notes.length, 1); assert.equal(await store.getOperationReceipt(f.plan.operations[0].operation.operationId), null) } finally { await store.close() }
})

test('question-bearing sources require exact human approval; no automatic policy is relaxed', native, async () => {
  const f = await fixture({ question: true })
  await assert.rejects(publish({ plan: f.plan, mode: 'rehearse' }), /Explicit approval required/)
  const approved = await fixture({ question: true }), item = approved.plan.operations[0], op = item.operation
  item.approved = { operationId: op.operationId, noteId: op.id, fingerprint: operationFingerprint(op), content: op.meaning.content }
  approved.plan.approval = { answer: '明确批准两条迁移', operations: [item.approved] }
  assert.equal((await publish({ plan: approved.plan, mode: 'rehearse' })).applied, 1)
})

test('frozen source changes, deletion barriers, changed evidence and formal writes without wrapper proof fail closed', native, async () => {
  const f = await fixture(); fs.writeFileSync(path.join(f.profile, 'aisling-store.json'), '{}')
  await assert.rejects(publish({ plan: f.plan, mode: 'rehearse' }), /Frozen source changed/)
  const blocked = await fixture({ blocked: true })
  await assert.rejects(publish({ plan: blocked.plan, mode: 'rehearse' }), { code: 'erased' })
  const unreviewed = await fixture(), invalid = unreviewed.plan.operations[0].operation
  invalid.sources.evidence[0] = { ...invalid.sources.evidence[0], digest: 'f'.repeat(64) }
  await assert.rejects(publish({ plan: unreviewed.plan, mode: 'rehearse' }), /Unreviewed migration source/)
  const noGuard = await fixture()
  await assert.rejects(publish({ plan: noGuard.plan, mode: 'publish' }), /ENOENT|wrapper required/)
})
