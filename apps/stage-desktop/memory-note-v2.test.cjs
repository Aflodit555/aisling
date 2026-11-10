const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { test } = require('node:test')
const { startWorker } = require('./memory-database/client.cjs')
const { NOTE_V2_FILE } = require('./memory-database/protocol.cjs')
const { createMemoryDatabaseStore, createNoteV2Store } = require('./memory-database/store.cjs')

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const subject = 'fixture-user'
const meaning = { subject, content: '用户报告第一轮实验已完成。', kind: 'fact', basis: 'direct', eventTime: null }
const message = content => ({ role: 'user', content, createdAt: 1 })
const session = (id, ...messages) => ({ id, messages })
const ref = (session, messageIndex = 0) => ({
  sessionId: session.id, messageIndex,
  digest: createHash('sha256').update(JSON.stringify(session.messages[messageIndex])).digest('hex'),
})
const add = (evidence, patch = {}) => ({
  action: 'ADD', operationId: randomUUID(), id: randomUUID(), reason: 'synthetic example',
  meaning: { ...meaning, ...patch }, sources: { evidence },
})
const change = (note, action, evidence, fields = {}) => ({
  action, id: note.id, operationId: randomUUID(), reason: 'synthetic change', expectedVersion: 1,
  sources: { evidence }, ...fields,
})
const erasure = (evidence, sessionIds = []) => ({ operationId: randomUUID(), evidence, sessionIds })

function fixture(name, work) {
  test(name, { skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to prepared resources', timeout: 60_000 }, async () => {
    const artifacts = resolve(__dirname, '../../artifacts/memory-note-only-p0')
    mkdirSync(artifacts, { recursive: true })
    const directory = realpathSync(mkdtempSync(join(artifacts, 'test-')))
    const config = { node: join(resources, 'runtime/node.exe'), entry: join(resources, 'worker.cjs'), file: join(directory, NOTE_V2_FILE) }
    const sessions = []
    const authority = {
      readData: () => ({ 'aisling.conversations.v1': JSON.stringify({ sessions }) }),
      isSubjectConfirmed: value => value === subject,
    }
    const store = createNoteV2Store(async () => config, () => {}, authority)
    try { await work({ store, config, directory, sessions, authority }) }
    finally { await store.close() }
  })
}

fixture('v2 accepts verified direct and inferred Notes with no Origin, and requires source and identity checks', async ({ store, sessions }) => {
  const first = session('first', message('第一轮实验已完成。'))
  const second = session('second', message('第二轮也先查阅资料再实现。'), { ...message('助手复述。'), role: 'assistant' })
  sessions.push(first, second)
  await store.open()
  const fact = add([ref(first)])
  await store.applyNoteOperation(fact)
  const inferred = add([ref(first), ref(second)], {
    kind: 'pattern', basis: 'inferred', uncertainty: '仅覆盖两次实验。', content: '两次实验中可能有先调研再实现的倾向。',
  })
  const receipt = await store.applyNoteOperation(inferred)
  assert.deepEqual(await store.applyNoteOperation({ ...inferred, sources: { evidence: [...inferred.sources.evidence].reverse() } }), receipt)
  assert.equal((await store.getNoteV2(fact.id)).kind, 'fact')
  assert.equal((await store.getNoteV2(inferred.id)).basis, 'inferred')
  assert.deepEqual((await store.getRevision(fact.id, 1)).grounds, { evidence: [ref(first)] })

  await assert.rejects(store.applyNoteOperation(add([])), { code: 'invalid-payload' })
  await assert.rejects(store.applyNoteOperation(add([ref(first)], { subject: 'unconfirmed' })), { code: 'subject-unconfirmed' })
  await assert.rejects(store.applyNoteOperation(add([{ ...ref(first), digest: '0'.repeat(64) }])), { code: 'invalid-evidence' })
  await assert.rejects(store.applyNoteOperation(add([ref(first), ref(first)], inferred.meaning)), { code: 'invalid-payload' })
  await assert.rejects(store.applyNoteOperation(add([ref(first), ref(second)], { basis: 'mixed' })), { code: 'invalid-payload' })
  await assert.rejects(store.applyNoteOperation(add([ref(first), ref(second, 1)], inferred.meaning)), { code: 'insufficient-evidence' })
  await assert.rejects(store.applyNoteOperation(add([ref(second, 1)])), { code: 'insufficient-evidence' })
  await assert.rejects(store.applyNoteOperation({ ...fact, reason: 'different command' }), { code: 'operation-id-conflict' })

  assert.equal((await store.listRecallHeads()).notes.length, 2)
  const changed = ref(first)
  first.messages[0].createdAt = 2
  assert.deepEqual((await store.listRecallHeads()).notes, [])
  assert.equal((await store.eraseSources(erasure([changed]))).notes, 2)
  assert.equal(await store.getNoteV2(fact.id), null)
  assert.equal(await store.getOperationReceipt(receipt.operationId), null)
})

fixture('v2 revisions, NOOP and Session erasure cover cumulative grounds and preserve independent Notes', async ({ store, sessions }) => {
  const old = session('old', message('初次报告。'))
  const shared = session('shared', message('新进展。'))
  const supplements = session('supplements', ...Array.from({ length: 18 }, (_, i) => message('补证 ' + i)))
  const independent = session('independent', message('无关报告。'))
  sessions.push(old, shared, supplements, independent)
  await store.open()
  const original = add([ref(old)])
  const another = add([ref(shared)], { content: '另一条认识。' })
  const kept = add([ref(independent)])
  for (const command of [original, another, kept]) await store.applyNoteOperation(command)
  const update = change(original, 'UPDATE', [ref(shared)], { meaning: { ...meaning, content: '更新后的报告。' } })
  await store.applyNoteOperation(update)
  assert.equal((await store.getRevision(original.id, 1)).snapshot.content, meaning.content)
  assert.equal((await store.getRevision(original.id, 2)).snapshot.content, update.meaning.content)
  await assert.rejects(store.applyNoteOperation({ ...update, operationId: randomUUID() }), { code: 'stale-version' })

  const extras = supplements.messages.map((_, i) => ref(supplements, i))
  const firstNoop = change(original, 'NOOP', extras.slice(0, 12), { expectedVersion: 2 })
  await store.applyNoteOperation(firstNoop)
  const lastNoop = change(original, 'NOOP', extras.slice(12), { expectedVersion: 2 })
  await store.applyNoteOperation(lastNoop)
  const duplicate = change(original, 'NOOP', [extras.at(-1)], { expectedVersion: 2 })
  assert.equal((await store.applyNoteOperation(duplicate)).links, undefined)
  assert.equal((await store.getNoteV2(original.id)).version, 2)
  assert.equal(await store.getRevision(original.id, 3), null)
  assert.equal((await store.getVersionSourceChanges(original.id, 2)).changes.length, 2)

  const ids = async () => (await store.listRecallHeads()).notes.map(head => head.note.id).sort()
  assert.deepEqual(await ids(), [original.id, another.id, kept.id].sort())
  // The last lexically ordered source is beyond the first cumulative Evidence page.
  const staleSupplement = supplements.messages[9]
  supplements.messages[9] = message('补证已修改。')
  assert.deepEqual(await ids(), [another.id, kept.id].sort())
  supplements.messages[9] = staleSupplement
  const removed = old.messages.pop()
  assert.deepEqual(await ids(), [another.id, kept.id].sort())
  old.messages.push(removed)

  sessions.splice(sessions.indexOf(shared), 1)
  assert.deepEqual(await ids(), [kept.id])
  const erase = erasure([], [shared.id])
  const result = await store.eraseSources(erase)
  assert.equal(result.notes, 2)
  await store.close()
  await store.open()
  assert.deepEqual(await store.eraseSources(erase), result)
  assert.deepEqual((await store.erasedNoteIds(erase.operationId)).ids, [original.id, another.id].sort())
  assert.equal(await store.getRevision(original.id, 1), null)
  assert.equal(await store.getRevision(original.id, 2), null)
  assert.equal(await store.getOperationReceipt(lastNoop.operationId), null)
  assert.deepEqual(await ids(), [kept.id])
  sessions.push(shared)
  await assert.rejects(store.applyNoteOperation(add([ref(shared)])), { code: 'erased' })
})

fixture('v2 supersede, retract and precise evidence erasure preserve lifecycle history until erase', async ({ store, sessions }) => {
  const old = session('old', message('采用旧方案。'))
  const next = session('next', message('改用新方案。'))
  const supplement = session('supplement', message('独立补证。'))
  sessions.push(old, next, supplement)
  await store.open()
  const original = add([ref(old)])
  const independent = add([ref(next)], { content: '同一消息支持另一条认识。' })
  await store.applyNoteOperation(original)
  await store.applyNoteOperation(independent)
  await store.applyNoteOperation(change(original, 'NOOP', [ref(supplement)]))
  const replace = change(original, 'SUPERSEDE', [ref(next)], {
    newId: randomUUID(), transition: 'explicit-same-scope-change', meaning: { ...meaning, content: '采用新方案。' },
  })
  await store.applyNoteOperation(replace)
  assert.equal((await store.getNoteV2(original.id)).status, 'superseded')
  assert.equal((await store.getRevision(original.id, 2)).successorId, replace.newId)
  await store.applyNoteOperation(change({ id: replace.newId }, 'RETRACT', []))
  assert.equal((await store.getNoteV2(replace.newId)).status, 'retracted')
  assert.deepEqual((await store.listRecallHeads()).notes.map(head => head.note.id), [independent.id])
  const removed = ref(supplement)
  sessions.splice(sessions.indexOf(supplement), 1)
  assert.equal((await store.eraseSources(erasure([removed]))).notes, 2)
  assert.equal(await store.getNoteV2(original.id), null)
  assert.equal(await store.getNoteV2(replace.newId), null)
  assert.equal(await store.getOperationReceipt(replace.operationId), null)
  assert.equal((await store.getNoteV2(independent.id)).status, 'active')
})

fixture('v2 rolls back a late receipt failure and recovers a committed receipt after reply loss', async ({ store, config, directory, sessions }) => {
  const original = session('first', message('原报告。'))
  const next = session('second', message('显式取代原报告。'))
  sessions.push(original, next)
  const first = add([ref(original)])
  const replace = change(first, 'SUPERSEDE', [ref(next)], {
    newId: randomUUID(), transition: 'explicit-same-scope-change', meaning: { ...meaning, content: '新报告。' },
  })
  const faultyEntry = join(directory, 'rollback.cjs')
  writeFileSync(faultyEntry, `
    const api = require(${JSON.stringify(join(resources, 'node_modules/@ladybugdb/core'))});
    const prepare = api.Connection.prototype.prepare;
    let receipts = 0;
    api.Connection.prototype.prepare = function (statement) {
      if (statement.includes('CREATE(:MemoryErasure')) throw new Error('injected erase receipt failure');
      if (statement.includes('CREATE (:NoteOperation') && ++receipts === 2)
        statement = statement.replace('operationId: $operationId', "operationId: CASE WHEN $operationId <> '' THEN '${first.operationId}' ELSE $operationId END");
      return prepare.call(this, statement);
    };
    require(${JSON.stringify(config.entry)});
  `)
  const faulty = startWorker({ ...config, entry: faultyEntry })
  try {
    await faulty.ready
    await faulty.request('applyNoteOperation', [first])
    await assert.rejects(faulty.request('applyNoteOperation', [replace]), /duplicat|primary key/i)
    assert.deepEqual((await faulty.request('listNoteEvidence', [first.id, ''])).value.evidence, first.sources.evidence)
    await assert.rejects(faulty.request('eraseSources', [erasure(first.sources.evidence)]), /injected erase receipt failure/)
    assert.deepEqual((await faulty.request('listNoteEvidence', [first.id, ''])).value.evidence, first.sources.evidence)
    assert.equal((await faulty.request('getOperationReceipt', [first.operationId])).value.operationId, first.operationId)
  } finally { await faulty.close() }
  await store.open()
  assert.equal((await store.getNoteV2(first.id)).status, 'active')
  assert.equal(await store.getNoteV2(replace.newId), null)
  assert.equal(await store.getRevision(first.id, 2), null)
  assert.equal(await store.getOperationReceipt(replace.operationId), null)
  await store.close()

  const barrier = join(directory, 'committed')
  const crashEntry = join(directory, 'hold-reply.cjs')
  writeFileSync(crashEntry, `
    const send = process.stdout.write.bind(process.stdout);
    process.stdout.write = (line, callback) => {
      const packet = JSON.parse(line);
      if (packet.requestId !== 1 || !packet.ok) return send(line, callback);
      require('node:fs').writeFileSync(${JSON.stringify(barrier)}, 'committed');
      return true;
    };
    require(${JSON.stringify(config.entry)});
  `)
  const worker = startWorker({ ...config, entry: crashEntry })
  try {
    await worker.ready
    const pending = assert.rejects(worker.request('applyNoteOperation', [replace]), { code: 'outcome-unknown' })
    for (let i = 0; i < 120 && !existsSync(barrier); i++) await sleep(25)
    assert(existsSync(barrier))
    process.kill(worker.pid, 'SIGKILL')
    await pending
    await worker.closed
  } finally { await worker.close().catch(() => {}) }
  await store.open()
  const recovered = await store.getOperationReceipt(replace.operationId)
  assert.equal(recovered.affectedNotes.length, 2)
  assert.deepEqual(await store.applyNoteOperation(replace), recovered)
  assert.equal((await store.getRevision(first.id, 2)).successorId, replace.newId)
})

fixture('v1 and v2 reject each other’s payloads and physical schemas', async ({ store, config, directory, sessions, authority }) => {
  const source = session('first', message('来源。'))
  sessions.push(source)
  const v2 = add([ref(source)])
  const { kind, ...v1Meaning } = v2.meaning
  const v1 = { ...v2, meaning: v1Meaning, sources: { evidence: [ref(source)], origins: [{ reflectionId: 'legacy' }] } }
  const v1File = join(directory, 'note-v1.lbdb')
  const legacy = createMemoryDatabaseStore(async () => ({ ...config, file: v1File }), () => {})
  try {
    await legacy.open()
    await assert.rejects(legacy.applyNoteOperation(v2), { code: 'invalid-payload' })
    await legacy.applyNoteOperation(v1)
    assert.deepEqual((await legacy.getRevision(v1.id, 1)).grounds, v1.sources)
  } finally { await legacy.close() }
  const wrong = createNoteV2Store(async () => ({ ...config, file: v1File }), () => {}, authority)
  try { await assert.rejects(wrong.open(), { code: 'unexpected-schema' }) }
  finally { await wrong.close() }
  const wrongLegacy = createMemoryDatabaseStore(async () => config, () => {})
  try { await assert.rejects(wrongLegacy.open(), { code: 'unexpected-schema' }) }
  finally { await wrongLegacy.close() }

  mkdirSync(config.file)
  try { await assert.rejects(store.open(), /isolated Note v2 test file/) }
  finally { await store.close() }
  const copied = join(directory, 'copied')
  mkdirSync(copied)
  copyFileSync(v1File, join(copied, NOTE_V2_FILE))
  const mismatched = startWorker({ ...config, file: join(copied, NOTE_V2_FILE) })
  try { await assert.rejects(mismatched.ready, /schema mismatch/) }
  finally { await mismatched.close() }

  const v2Directory = join(directory, 'v2')
  mkdirSync(v2Directory)
  const v2File = join(v2Directory, NOTE_V2_FILE)
  const worker = startWorker({ ...config, file: v2File })
  try {
    assert.equal((await worker.ready).schema, 'note-v2')
    await assert.rejects(worker.request('applyNoteOperation', [v1]), { code: 'invalid-payload' })
    await assert.rejects(worker.request('getOrigins', [v1.id]), { code: 'unknown-operation' })
    await worker.request('applyNoteOperation', [v2])
  } finally { await worker.close() }
  copyFileSync(v2File, join(copied, 'note-v1.lbdb'))
  const backwards = startWorker({ ...config, file: join(copied, 'note-v1.lbdb') })
  try { await assert.rejects(backwards.ready, /schema mismatch/) }
  finally { await backwards.close() }

  const renamed = join(copied, 'note-v2.lbdb')
  copyFileSync(v2File, renamed)
  const runtime = startWorker({ ...config, file: renamed })
  try { await assert.rejects(runtime.ready, /schema mismatch/) }
  finally { await runtime.close() }
})
