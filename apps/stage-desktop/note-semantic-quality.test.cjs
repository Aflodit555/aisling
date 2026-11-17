const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto'), { test } = require('node:test')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { messageDigest } = require('./memory-evidence.cjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES

for (const dated of [false, true]) test(`nearby context, receipts, restart and erasure retain old Notes; event dates supplied: ${dated}`, {
  skip: !resources && 'Prepared isolated Worker required', timeout: 60000,
}, async () => {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p3'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'context-'))), file = path.join(profile, 'aisling-store.json')
  const session = { id: 'context', messages: [(dated ? '2026-01-01 ' : '') + 'Cedar indexes catalogues.',
    (dated ? '2026-01-02 ' : '') + 'It is paused now.'].map(content => ({ role: 'user', content })) }
  const data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }) }
  fs.writeFileSync(file, JSON.stringify(data)); fs.writeFileSync(path.join(profile, 'memory-authority'), 'note-v2\n')
  const db = path.join(profile, 'memory-note-v2/note-v2.lbdb'); fs.mkdirSync(path.dirname(db))
  const readData = () => JSON.parse(fs.readFileSync(file)), writeData = value => fs.writeFileSync(file, JSON.stringify(value))
  const ref = i => ({ sessionId: session.id, messageIndex: i, digest: messageDigest(session.messages[i]) })
  const config = async () => ({ file: db, entry: path.join(resources, 'worker.cjs'), node: path.join(resources, 'runtime/node.exe') })
  const store = () => createNoteV2Store(config, () => {}, { readData, isSubjectConfirmed: () => true })
  let seeded = store(), original = randomUUID()
  try {
    await seeded.open(); await seeded.applyNoteOperation({ action: 'ADD', id: original, operationId: randomUUID(), reason: 'Synthetic original',
      meaning: { subject: 'profile-user', content: session.messages[0].content, kind: 'fact', basis: 'direct',
        eventTime: dated ? { kind: 'date', date: '2026-01-01' } : null }, sources: { evidence: [ref(0)] }, contextEvidence: [] })
  } finally { await seeded.close() }
  const start = () => createNoteFormationService({ profile, resources, readData, writeData, consent: () => true, autonomous: true })
  let service = start(), job
  try {
    await service.delivered(session.id, [1]); await service.flush(session.id); job = await service.next(false)
    await assert.rejects(service.prepare(job.id, job.attempt, [ref(1)]), /invalid-history/)
    await assert.rejects(service.prepare(job.id, job.attempt, [ref(0), ref(0)]), /invalid-history/)
    await assert.rejects(service.prepare(job.id, job.attempt, [{ ...ref(0), messageIndex: 7 }]), /invalid-history/)
    const context = await service.prepare(job.id, job.attempt, [ref(0)])
    assert.equal(context.notes[0].id, original)
    assert.deepEqual(context.evidence.map(e => [e.ref.messageIndex, e.scope]), [[1, 'current'], [0, 'history']])
  } finally { await service.close() }
  service = start()
  try {
    // A prepared attempt is interrupted, not silently regenerated or stripped of source fences.
    const jobs = JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json')))
    assert.equal(jobs.batches[0].failure.code, 'interrupted')
    await service.retry(job.id, job.attempt); job = await service.next(false)
    await service.prepare(job.id, job.attempt, [ref(0)])
    const sources = [{ label: 'E1', quote: session.messages[1].content }, { label: 'E2', quote: session.messages[0].content }]
    await service.submit(job.id, job.attempt, JSON.stringify({ items: [{ action: 'ADD', target: null, reason: 'Same named activity with a new report',
      draft: { content: 'Cedar catalogue indexing is paused now.', kind: 'fact', basis: 'direct', subject: 'S1',
        eventTime: dated ? { kind: 'date', date: '2026-01-02' } : null, tags: ['Cedar'], sources },
      semantic: { relation: 'state-change', target: 'N1', scope: 'Cedar catalogue indexing', sources, targetSources: [sources[1]] } }] }))
    await service.recover()
    const snapshot = await service.recallSnapshot()
    assert.equal(snapshot.notes.length, 2)
    assert.equal(snapshot.notes.find(h => h.note.id === original).note.content, session.messages[0].content)
    assert.equal(snapshot.notes.find(h => h.note.id === original).note.version, 1)
    const neighbors = await service.recallNeighbors([original], snapshot.version)
    // Shared anchor grounds cannot prove disjoint report order. Only explicit event dates resolve this case.
    assert.equal(neighbors.relations.length, dated ? 1 : 0)
    if (dated) {
      assert.equal(neighbors.relations[0].type, 'STATE_CHANGE')
      assert.equal(neighbors.relations[0].from, original)
    }
    const next = structuredClone(data); const edited = structuredClone(session); edited.messages[0].content = 'Original source changed.'
    next['aisling.conversations.v1'] = JSON.stringify({ sessions: [edited] })
    service.privacy.beforeConversationChange(readData(), next); writeData(next); await service.recover()
    assert.equal((await service.recallSnapshot()).notes.length, 0)
  } finally { await service.close() }
})
