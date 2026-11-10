const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { assertMemoryAuthority, canStartNoteV2 } = require('./memory-authority.cjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { startWorker } = require('./memory-database/client.cjs')
const { messageDigest, readConversationSessions } = require('./memory-evidence.cjs')

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p2')
const key = 'aisling.conversations.v1'
const subject = 'profile-user'
const message = content => ({ role: 'user', content })
const session = (id, ...contents) => ({ id, messages: contents.map(message) })
const dataFor = sessions => ({ [key]: JSON.stringify({ sessions, activeId: sessions.at(-1)?.id ?? null }) })
const source = (session, messageIndex = 0) => ({
  sessionId: session.id, messageIndex, digest: messageDigest(session.messages[messageIndex]),
})
const meaning = content => ({ content, subject, kind: 'fact', basis: 'direct', eventTime: null })
const add = (ref, content) => ({ operationId: randomUUID(), id: randomUUID(), reason: '合成记录',
  action: 'ADD', meaning: meaning(content), sources: { evidence: [ref] }, contextEvidence: [] })

function fixture(sessions) {
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'lifecycle-')))
  const conversations = path.join(profile, 'aisling-store.json')
  const journal = path.join(profile, 'memory-erasure.v1.json')
  const jobs = path.join(profile, 'note-formation-jobs.v1.json')
  const file = path.join(profile, 'memory-note-v2', 'note-v2.lbdb')
  const readData = () => JSON.parse(fs.readFileSync(conversations, 'utf8'))
  const writeData = data => fs.writeFileSync(conversations, JSON.stringify(data))
  writeData(dataFor(sessions))
  const runtime = (options = {}) => createNoteFormationService({
    profile, resources, readData, writeData, consent: () => true, authorize: () => true, ...options,
  })
  const config = (directory = resources) => ({ node: path.join(directory, 'runtime/node.exe'),
    entry: path.join(directory, 'worker.cjs'), file })
  const admin = (directory = resources) => createNoteV2Store(async () => config(directory),
    () => {}, { readData, isSubjectConfirmed: value => value === subject })
  function change(service, sessions) {
    const data = dataFor(sessions)
    service.privacy.beforeConversationChange(readData(), data)
    writeData(service.privacy.sanitizedData(data))
  }
  return { profile, file, journal, jobs, conversations, readData, runtime, config, admin, change }
}

async function propose(service, id, content) {
  for (let index = 0; index < 3; index++) await service.delivered(id, [index])
  const attempt = await service.next()
  assert(attempt)
  const context = await service.prepare(attempt.id, attempt.attempt, [])
  await service.submit(attempt.id, attempt.attempt, JSON.stringify({ items: [{
    action: 'ADD', target: null, reason: '合成形成',
    draft: { ...meaning(content), subject: 'S1', tags: ['手碟'],
      sources: [{ label: 'E1', quote: context.evidence[0].message.content }] },
  }] }))
  return { context, attempt }
}

const native = { skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to P2 Worker resources', timeout: 75_000 }

test('runtime approval defaults to review, and authority cannot be switched over legacy or pinned data', native, async () => {
  const input = session('input', '用户报告手碟已经购买。', '准备记录手碟。', '采购已经完成。')
  const f = fixture([input])
  assertMemoryAuthority(f.profile, false)
  assert.equal(canStartNoteV2(f.profile), true)
  assert(!fs.existsSync(path.join(f.profile, 'memory-authority')))
  const legacy = path.join(f.profile, 'aisling-reflections.v1.json')
  fs.writeFileSync(legacy, '{}')
  assert.equal(canStartNoteV2(f.profile), false)
  assert.throws(() => f.runtime(), /legacy-memory-profile/)
  fs.unlinkSync(legacy)
  const interrupted = path.join(f.profile, 'note-formation-jobs.v1.json')
  fs.writeFileSync(interrupted, '{}')
  assert.equal(canStartNoteV2(f.profile), false)
  assert.throws(() => assertMemoryAuthority(f.profile, false), /explicit-mode/)
  assert.throws(() => f.runtime(), /requires-migration/)
  fs.unlinkSync(interrupted)
  const service = f.runtime({ authorize: undefined })
  try {
    await propose(service, input.id, '用户报告手碟已购买。')
    assert.equal(await service.next(), null)
    assert.deepEqual((await service.listRecallHeads()).notes, [])
    const batch = JSON.parse(fs.readFileSync(f.jobs, 'utf8')).batches[0]
    assert.equal(batch.items[0].status, 'review')
    const { items } = await service.reviews()
    assert.equal(items.length, 1)
    const before = await service.recallSnapshot()
    assert.deepEqual(before.notes, [])
    assert.equal(await service.decide(items[0].key, true), 'applied')
    assert.equal(await service.decide(items[0].key, true), 'applied')
    assert.equal(service.recallCurrent(before.version), false)
    const after = await service.recallSnapshot()
    assert.equal(after.notes.length, 1)
    assert.equal(service.recallCurrent(after.version), true)
    const original = f.readData()
    fs.writeFileSync(f.conversations, JSON.stringify(dataFor([])))
    assert.equal(service.recallCurrent(after.version), false)
    fs.writeFileSync(f.conversations, JSON.stringify(original))
    f.change(service, [])
    assert.equal(service.recallCurrent(after.version), false)
    await service.recover()
    assert.equal(await service.decide(items[0].key, true), 'stale')
    assert.deepEqual((await service.recallSnapshot()).notes, [])
    assert.equal(canStartNoteV2(f.profile), true)
    assert.throws(() => assertMemoryAuthority(f.profile, false), /explicit-mode/)
  } finally { await service.close() }
})

test('intent survives Main death and unavailable Worker, and erases N descendants with intact direct evidence', native, async () => {
  const a = session('original', '用户报告手碟首次购买于春季。', '手碟已到家。', '采购情况已确认。')
  const b = session('descendant', '用户报告手碟现已开始练习。', '手碟练习已有进展。', '准备安排课程。')
  const f = fixture([a, b])
  const first = f.runtime()
  let aId, bId, staleCommand, attempt
  try {
    await propose(first, a.id, '用户报告手碟已购买。')
    await first.next()
    aId = (await first.listRecallHeads()).notes[0].note.id
    const result = await propose(first, b.id, '用户报告手碟现在开始练习。')
    attempt = result.attempt
    assert(result.context.notes.some(note => note.id === aId))
    await first.next()
    const candidate = (await first.listRecallHeads()).notes.find(head => head.note.id !== aId)
    bId = candidate.note.id
    assert.deepEqual(candidate.grounds.evidence, [source(b)])
    assert(candidate.cumulativeEvidence.some(ref => ref.sessionId === a.id))
    const item = JSON.parse(fs.readFileSync(f.jobs, 'utf8')).batches[1].items[0]
    staleCommand = { ...add(source(b), candidate.note.content), id: bId, operationId: item.operationId,
      contextEvidence: [source(a)] }
  } finally { await first.close() }

  const child = spawnSync(process.execPath, ['-e', [
    "const fs = require('node:fs')",
    'const { createNoteFormationService } = require(' + JSON.stringify(path.join(__dirname, 'note-formation.cjs')) + ')',
    'const profile = ' + JSON.stringify(f.profile),
    'const resources = ' + JSON.stringify(resources),
    'const file = ' + JSON.stringify(f.conversations),
    'const journal = ' + JSON.stringify(f.journal),
    "const readData = () => JSON.parse(fs.readFileSync(file, 'utf8'))",
    "const service = createNoteFormationService({profile,resources,readData,writeData() {},consent: () => true})",
    'const rename = fs.renameSync',
    'fs.renameSync = (from, to) => { rename(from,to); if (to === journal) process.exit(74) }',
    'service.privacy.beforeConversationChange(readData(), ' + JSON.stringify(dataFor([b])) + ')',
    'process.exit(1)',
  ].join('\n')], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.ifError(child.error)
  assert.equal(child.status, 74, child.stderr)
  assert.equal(readConversationSessions(f.readData()).length, 2)
  const steps = JSON.parse(fs.readFileSync(f.journal)).pending[0].steps

  const offline = f.runtime({ resources: path.join(f.profile, 'missing-resources') })
  try {
    await assert.rejects(offline.listRecallHeads(), /ENOENT/)
    assert.throws(() => offline.privacy.assertReadable(), /erasure-pending/)
    assert.deepEqual(offline.privacy.readJournal().pending[0].steps, steps)
    assert.deepEqual(readConversationSessions(offline.privacy.sanitizedData(f.readData())).map(s => s.id), [b.id])
  } finally { await offline.close() }

  const recovered = f.runtime()
  try {
    const durable = fs.readFileSync(f.journal, 'utf8')
    const corrupt = JSON.parse(durable)
    corrupt.blocked.sessions = []
    fs.writeFileSync(f.journal, JSON.stringify(corrupt))
    await assert.rejects(recovered.listRecallHeads(), /erase-journal-invalid/)
    fs.writeFileSync(f.journal, durable)
    await recovered.recover()
    await recovered.recover()
    assert.deepEqual((await recovered.listRecallHeads()).notes, [])
    assert.deepEqual(readConversationSessions(f.readData()).map(s => s.id), [b.id])
    assert.equal(recovered.privacy.pending(), false)
    assert(!fs.readFileSync(f.jobs, 'utf8').includes(attempt.id))
    await assert.rejects(recovered.submit(attempt.id, attempt.attempt, '{"items":[]}'), /stale-formation-attempt/)
  } finally { await recovered.close() }
  const worker = startWorker(f.config())
  try {
    await worker.ready
    assert.equal((await worker.request('getNoteV2', [aId])).value, null)
    assert.equal((await worker.request('getNoteV2', [bId])).value, null)
    assert.equal((await worker.request('getOperationReceipt', [staleCommand.operationId])).value, null)
    assert.equal((await worker.request('eraseSources', [steps[0]])).value.notes, 2)
    await assert.rejects(worker.request('applyNoteOperation', [staleCommand]), { code: 'erased' })
  } finally { await worker.close() }
})

test('summary edit erases shared, historical, supplemental and superseded dependents while preserving unrelated Notes', native, async () => {
  const shared = session('shared', '共享旧原话。', '共用备用证据。')
  const original = session('old', '独立历史证据。')
  const updated = session('new', '独立当前证据。')
  const extra = session('extra', '补充证据。')
  const keep = session('keep', '无关保留记录。')
  const f = fixture([shared, original, updated, extra, keep])
  const initialize = f.runtime()
  await initialize.recover()
  await initialize.close()
  const seed = f.admin()
  const a = add(source(shared), '共享认识甲。')
  const b = add(source(shared), '共享认识乙。')
  const c = add(source(original), '先前独立认识。')
  const d = add(source(shared, 1), '需要补证的认识。')
  const survivor = add(source(keep), '应保留认识。')
  const replacement = randomUUID()
  const change = (command, action, ref, fields = {}) => ({
    operationId: randomUUID(), id: command.id, expectedVersion: 1, reason: '合成修订', action,
    sources: { evidence: [ref] }, contextEvidence: [], ...fields,
  })
  const revision = change(c, 'UPDATE', source(updated), { meaning: meaning('更新后的独立认识。') })
  const noop = change(d, 'NOOP', source(extra))
  const replace = change(d, 'SUPERSEDE', source(updated), { newId: replacement, meaning: meaning('替代认识。'),
    transition: 'explicit-same-scope-change' })
  try {
    await seed.open()
    for (const command of [a, b, c, d, survivor, revision, noop, replace]) await seed.applyNoteOperation(command)
  } finally { await seed.close() }
  const service = f.runtime()
  try {
    const edited = structuredClone(shared)
    edited.messages[0].content = '修订后的原话。'
    f.change(service, [edited, updated, keep])
    await service.recover()
    const heads = await service.listRecallHeads()
    assert.deepEqual(heads.notes.map(head => head.note.id), [survivor.id])
  } finally { await service.close() }
  const reopened = f.admin()
  try {
    await reopened.open()
    for (const id of [a.id, b.id, c.id, d.id, replacement]) {
      assert.equal(await reopened.getNoteV2(id), null)
      assert.equal(await reopened.getRevision(id, 1), null)
    }
    for (const operation of [a, b, c, d, revision, noop, replace])
      assert.equal(await reopened.getOperationReceipt(operation.operationId), null)
  } finally { await reopened.close() }
})

test('runtime rolls back interrupted erasure, replays a lost erase reply, and seals a concurrent Formation commit', native, async () => {
  const a = session('rollback', '回滚验证一。', '回滚验证二。', '回滚验证三。')
  const b = session('ack', '回包验证一。', '回包验证二。', '回包验证三。')
  const c = session('race', '竞争验证一。', '竞争验证二。', '竞争验证三。')
  const f = fixture([a, b, c])
  const copied = path.join(f.profile, 'resources')
  fs.cpSync(resources, copied, { recursive: true })
  const entry = path.join(copied, 'worker.cjs')
  fs.renameSync(entry, path.join(copied, 'worker-real.cjs'))
  const fault = path.join(f.profile, 'fault')
  const reached = path.join(f.profile, 'worker-committed')
  const release = path.join(f.profile, 'worker-release')
  fs.writeFileSync(entry, [
    "const fs = require('node:fs')",
    'const fault = ' + JSON.stringify(fault),
    'const reached = ' + JSON.stringify(reached),
    'const release = ' + JSON.stringify(release),
    "const mode = () => fs.existsSync(fault) ? fs.readFileSync(fault, 'utf8') : ''",
    "const api = require('@ladybugdb/core')",
    'const prepare = api.Connection.prototype.prepare',
    'api.Connection.prototype.prepare = function(statement) {',
    "  if (mode() === 'rollback' && statement.includes('CREATE(:MemoryErasure')) process.exit(81)",
    '  return prepare.call(this, statement)',
    '}',
    'const send = process.stdout.write.bind(process.stdout)',
    'process.stdout.write = (line, callback) => {',
    '  const packet = JSON.parse(line)',
    "  if (mode() === 'erase-ack' && packet.ok && packet.result?.notes !== undefined && Number.isInteger(packet.result.notes)) process.exit(82)",
    "  if (mode() === 'hold-add' && packet.ok && packet.result?.action === 'ADD') {",
    "    fs.writeFileSync(reached, 'committed')",
    '    const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); send(line, callback) } }, 10)',
    '    return true',
    '  }',
    '  return send(line, callback)',
    '}',
    "require('./worker-real.cjs')",
  ].join('\n'))

  for (const [mode, removed, remaining] of [['rollback', a, [b, c]], ['erase-ack', b, [c]]]) {
    const service = f.runtime({ resources: copied })
    let noteId, operationId
    try {
      const { attempt } = await propose(service, removed.id, '用户报告了故障验证经历。')
      await service.next()
      const item = JSON.parse(fs.readFileSync(f.jobs, 'utf8')).batches.find(b => b.id === attempt.id).items[0]
      noteId = item.noteId
      operationId = item.operationId
      fs.writeFileSync(fault, mode)
      f.change(service, remaining)
      await assert.rejects(service.recover(), { code: 'outcome-unknown' })
      assert.equal(service.privacy.pending(), true)
      await assert.rejects(service.listRecallHeads(), { code: 'outcome-unknown' })
    } finally { await service.close() }
    const inspect = f.admin(copied)
    try {
      await inspect.open()
      assert.equal(Boolean(await inspect.getOperationReceipt(operationId)), mode === 'rollback')
      assert.equal(Boolean(await inspect.getNoteV2(noteId)), mode === 'rollback')
    } finally { await inspect.close() }

    fs.unlinkSync(fault)
    const retry = f.runtime({ resources: copied })
    try {
      await retry.recover()
      assert.equal(retry.privacy.pending(), false)
      assert.deepEqual((await retry.listRecallHeads()).notes, [])
    } finally { await retry.close() }
  }

  const racing = f.runtime({ resources: copied })
  try {
    const { attempt } = await propose(racing, c.id, '用户报告了写入与删除竞争。')
    fs.writeFileSync(fault, 'hold-add')
    const settlement = racing.next()
    for (let i = 0; i < 300 && !fs.existsSync(reached); i++) await delay(10)
    assert(fs.existsSync(reached))
    f.change(racing, [])
    assert.throws(() => racing.privacy.assertReadable(), /erasure-pending/)
    fs.writeFileSync(release, '')
    await settlement
    await racing.recover()
    assert.deepEqual((await racing.listRecallHeads()).notes, [])
    assert(!fs.readFileSync(f.jobs, 'utf8').includes(attempt.id))
  } finally { await racing.close() }
})
