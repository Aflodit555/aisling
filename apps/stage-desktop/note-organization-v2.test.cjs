const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { createOrganizationIndex, sameRecognition, authorizeOrganization, planNoteRelation } = require('./note-organization-v2.mjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { messageDigest, sourceMessageLookup } = require('./memory-evidence.cjs')
const { operationFingerprint } = require('./memory-database/note-v1.cjs')
const { spawnSync } = require('node:child_process')

const meaning = (content, value = '开始') => ({ content, subject: 'profile-user', basis: 'direct', kind: 'event',
  eventTime: null, tags: ['钢琴'], state: { scope: '练习钢琴', value } })
const refFor = (session, messageIndex) => ({ sessionId: session.id, messageIndex, digest: messageDigest(session.messages[messageIndex]) })
const headFor = (note, ref) => ({ note: { ...note, id: randomUUID(), version: 1, createdAt: 1, status: 'active' }, grounds: { evidence: [ref] } })
const proposal = (action, note, ref, quote, target = null) => ({ action, target, draft: { meaning: note,
  confirmed: true, citations: [{ ref, quote }] }, related: [], reason: '受控原文' })

test('autonomous grants are source-constrained for every lifecycle action, not model confidence', () => {
  const session = { id: 'policy', messages: [
    '我现在开始练习钢琴。', '我现在暂停练习钢琴。', '更正：练习钢琴从开始改为暂停。',
    '撤回：我现在开始练习钢琴。', '我计划暂停练习钢琴。',
  ].map((content, i) => ({ role: 'user', content, createdAt: i + 1 })) }
  const refs = session.messages.map((_, i) => refFor(session, i))
  const lookup = ref => session.messages[ref.messageIndex]
  const note = meaning(session.messages[0].content), target = headFor(note, refs[0]).note
  assert.equal(sameRecognition({ ...note, content: '练习3.5小时' }, { ...note, content: '练习35小时' }), false)
  const context = { heads: [], complete: true, lookup }
  const make = (action, i, value, targetNote = target) => proposal(action, meaning(i === 3 ? note.content : session.messages[i].content,
    value), refs[i], session.messages[i].content, targetNote)
  assert.equal(authorizeOrganization(proposal('ADD', note, refs[0], note.content), context), true)
  assert.equal(authorizeOrganization(proposal('ADD', note, refs[0], note.content), { ...context, complete: false }), false)
  assert.equal(authorizeOrganization(proposal('ADD', { ...note, content: '钢琴课程已经全部完成。' }, refs[0], note.content), context), false)
  const planned = { ...note, content: '暂停练习钢琴。' }
  delete planned.state
  assert.equal(authorizeOrganization(proposal('ADD', planned, refs[4], '暂停练习钢琴'), context), false)
  const ask = '我现在开始练习钢琴吗？'
  assert.equal(authorizeOrganization(proposal('ADD', { ...note, content: ask }, refs[0], ask),
    { ...context, lookup: () => ({ role: 'user', content: ask }) }), false)
  assert.equal(authorizeOrganization(proposal('ADD', note, refs[0], note.content), { ...context, heads: [{ note: target }] }), false)
  assert.equal(authorizeOrganization(make('NOOP', 0, '开始'), context), true)
  assert.equal(authorizeOrganization(make('NOOP', 1, '暂停'), context), false)
  assert.equal(authorizeOrganization(make('ADD', 1, '暂停', null), { ...context, heads: [{ note: target }] }), true)
  assert.equal(authorizeOrganization(make('ADD', 4, '暂停', null), context), false)
  assert.equal(authorizeOrganization(make('UPDATE', 2, '暂停'), context), true)
  assert.equal(authorizeOrganization(make('UPDATE', 1, '暂停'), context), false)
  assert.equal(authorizeOrganization(make('SUPERSEDE', 2, '暂停'), context), true)
  assert.equal(authorizeOrganization(make('SUPERSEDE', 1, '暂停'), context), false)
  assert.equal(authorizeOrganization(make('RETRACT', 3, '开始'), context), true)
  assert.equal(authorizeOrganization(make('RETRACT', 1, '暂停'), context), false)
  for (const quote of ['我不撤回练习钢琴开始。', '如果撤回练习钢琴开始。', '撤回练习钢琴开始吗？']) {
    const ref = refs[3]
    const denial = proposal('RETRACT', note, ref, quote, target)
    assert.equal(authorizeOrganization(denial, { ...context, lookup: () => ({ role: 'user', content: quote }) }), false)
  }
  assert.equal(authorizeOrganization({ ...make('UPDATE', 2, '暂停'), target: { ...target, state: { scope: '购买钢琴', value: '开始' } } }, context), false)
})

test('relations use original reports and explicit state dimensions, never tags, Context or inferred Notes', () => {
  const session = { id: 'relations', messages: ['我现在开始练习钢琴。', '我现在暂停练习钢琴。', '我现在重新开始练习钢琴。']
    .map((content, i) => ({ role: 'user', content, createdAt: i + 1 })) }
  const lookup = ref => session.messages[ref.messageIndex]
  const heads = session.messages.map((message, i) => headFor(meaning(message.content, i === 1 ? '暂停' : '开始'), refFor(session, i)))
  assert.equal(planNoteRelation(heads[0], heads[1], lookup).type, 'STATE_CHANGE')
  const back = planNoteRelation(heads[1], heads[0], lookup)
  assert.equal(back.from, heads[0].note.id)
  assert.equal(back.order, 'report')
  assert.equal(back.basis, 'inferred')
  assert(back.uncertainty)
  assert.equal(planNoteRelation(heads[0], heads[2], lookup).type, 'CONTINUES')
  assert.equal(planNoteRelation(heads[0], { ...heads[1], note: { ...heads[1].note, state: undefined } }, lookup), null)
  assert.equal(planNoteRelation(heads[0], { ...heads[1], note: { ...heads[1].note, basis: 'inferred' } }, lookup), null)
  const dated = heads.map((head, i) => ({ ...head, note: { ...head.note, eventTime: { kind: 'date', date: '2026-01-0' + (i + 1) } } }))
  assert.equal(planNoteRelation(dated[0], dated[1], lookup).order, 'event')
})

test('candidate indexing is resumable and reports a hard coverage limit instead of an empty complete search', async () => {
  let calls = 0
  const read = createOrganizationIndex({ async listRecallHeads() {
    calls++
    return { notes: Array.from({ length: 4 }, (_, i) => ({ note: { id: 'head-' + calls + '-' + i } })), nextCursor: String(calls).padStart(8, '0') }
  } }, () => 'fixed-snapshot')
  let index
  for (let i = 0; i < 10; i++) index = await read()
  assert.equal(index.heads.length, 2048)
  assert.equal(index.complete, false)
  assert.equal(calls, 512)
  assert.equal((await read()).complete, false)
  assert.equal(calls, 512)
})

test('a warm candidate index revalidates original sources without rescanning for ordinary conversation appends', async () => {
  let calls = 0, present = true
  const read = createOrganizationIndex({ async listRecallHeads() {
    calls++
    return { notes: [{ note: { id: 'known' }, cumulativeEvidence: [{ sessionId: 'source' }] }], nextCursor: null }
  } }, () => 'same-memory-generation', () => () => present)
  assert.equal((await read()).complete, true)
  assert.equal((await read()).heads.length, 1)
  assert.equal(calls, 1)
  present = false
  const invalidated = await read()
  assert.equal(invalidated.complete, false)
  assert.equal(invalidated.heads.length, 0)
  assert.equal(calls, 1)
})

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 90_000 }
function fixture() {
  const root = path.resolve(__dirname, '../../artifacts/memory-organization-v2')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'profile-')))
  const session = { id: 'piano', messages: [] }
  let data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }) }
  const readData = () => data
  const writeData = next => { data = next }
  const append = content => {
    session.messages.push({ role: 'user', content, createdAt: session.messages.length + 1 })
    data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }) }
    return refFor(session, session.messages.length - 1)
  }
  const service = opts => createNoteFormationService({ profile, resources, readData, writeData,
    consent: () => true, autonomous: true, ...opts })
  const admin = (directory = resources) => createNoteV2Store(async () => ({ node: path.join(directory, 'runtime/node.exe'),
    entry: path.join(directory, 'worker.cjs'), file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }),
  () => {}, { readData, isSubjectConfirmed: subject => subject === 'profile-user' })
  const jobs = () => JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8'))
  async function submit(runtime, content, value, action = 'ADD', targetId) {
    const ref = append(content)
    await runtime.delivered(session.id, [ref.messageIndex])
    await runtime.flush(session.id)
    const attempt = await runtime.next()
    assert(attempt)
    const context = await runtime.prepare(attempt.id, attempt.attempt, [])
    const targetIndex = context.notes.findIndex(note => note.id === targetId)
    await runtime.submit(attempt.id, attempt.attempt, JSON.stringify({ items: [{ action, reason: '原文状态报告',
      target: action === 'ADD' ? null : 'N' + (targetIndex + 1), draft: { ...meaning(content, value), subject: 'S1',
        sources: [{ label: 'E1', quote: content }] } }] }))
    await runtime.next()
    return jobs().batches.find(batch => batch.id === attempt.id).items[0]
  }
  return { profile, session, append, readData, writeData, service, admin, jobs, submit }
}

test('production policy stores, deduplicates and organizes a three-stage experience without approval; backlog survives restart', native, async () => {
  const f = fixture()
  let runtime = f.service()
  let ids
  try {
    const first = await f.submit(runtime, '我现在开始练习钢琴。', '开始')
    assert.equal(first.status, 'applied')
    const duplicate = await f.submit(runtime, '我现在开始练习钢琴。', '开始')
    assert.equal(duplicate.action, 'NOOP')
    assert.equal(duplicate.status, 'applied')
    const second = await f.submit(runtime, '我现在暂停练习钢琴。', '暂停')
    const third = await f.submit(runtime, '我现在重新开始练习钢琴。', '重新开始')
    ids = [first.noteId, second.noteId, third.noteId]
    assert.equal((await runtime.listRecallHeads()).notes.length, 3)
    await runtime.close()
    runtime = f.service()
    for (let i = 0; i < 7; i++) await runtime.organize()
    const snapshot = await runtime.recallSnapshot()
    assert.equal(snapshot.reason, 'ready')
    const graph = await runtime.recallNeighbors([ids[1]], snapshot.version)
    assert(graph.relations.some(relation => relation.from === ids[0] && relation.to === ids[1]))
    assert(graph.relations.some(relation => relation.from === ids[1] && relation.to === ids[2]))
    assert.equal(graph.notes.length, 3)
    assert(graph.relations.every(relation => relation.basis === 'inferred' && relation.uncertainty))
    const before = f.jobs().organization.tasks.length
    await runtime.organize()
    assert.equal(f.jobs().organization.tasks.length, before)
  } finally { await runtime.close() }
  const admin = f.admin()
  try {
    await admin.open()
    const relation = (await admin.listNoteRelations(ids[1])).relations.find(relation => relation.status === 'active')
    const unlink = Object.fromEntries(Object.entries(relation).filter(([key]) => !['key', 'status', 'createdAt', 'endedAt'].includes(key)))
    unlink.action = 'UNLINK'; unlink.operationId = randomUUID()
    const receipt = await admin.applyRelationOperation(unlink)
    assert.deepEqual(await admin.applyRelationOperation(unlink), receipt)
    assert.equal((await admin.listRecallRelations(relation.from)).relations.some(row => row.key === relation.key), false)
    assert.equal((await admin.listNoteRelations(relation.from)).relations.find(row => row.key === relation.key).status, 'retracted')
    await assert.rejects(admin.applyRelationOperation({ ...unlink, action: 'LINK', operationId: randomUUID() }), { code: 'invalid-transition' })
  } finally { await admin.close() }
})

test('network transactions reject stale endpoints and invalid sources, invalidate on revision and preserve independent peer on erase', native, async () => {
  const f = fixture()
  const a = f.append('我现在开始练习钢琴。'), b = f.append('我现在暂停练习钢琴。')
  const runtime = f.service()
  await runtime.close()
  const store = f.admin()
  try {
    await store.open()
    const add = (ref, note) => ({ action: 'ADD', operationId: randomUUID(), id: randomUUID(), reason: '合成原始报告',
      sources: { evidence: [ref] }, contextEvidence: [], meaning: note })
    const first = add(a, meaning(f.session.messages[0].content)), second = add(b, meaning(f.session.messages[1].content, '暂停'))
    await store.applyNoteOperation(first); await store.applyNoteOperation(second)
    const heads = (await store.listRecallHeads()).notes
    const plan = planNoteRelation(heads[0], heads[1], sourceMessageLookup(f.readData()))
    const link = { ...plan, action: 'LINK', operationId: randomUUID() }
    const receipt = await store.applyRelationOperation(link)
    assert.deepEqual(await store.applyRelationOperation(link), receipt)
    await assert.rejects(store.applyRelationOperation({ ...link, reason: 'changed' }), { code: 'operation-id-conflict' })
    await assert.rejects(store.applyRelationOperation({ ...link, operationId: randomUUID(), fromVersion: 2 }), { code: 'stale-version' })
    await assert.rejects(store.applyRelationOperation({ ...link, operationId: randomUUID(), sources: { evidence: [a] } }), { code: 'invalid-evidence' })
    const update = { action: 'UPDATE', id: first.id, expectedVersion: 1, operationId: randomUUID(), reason: '修正原文',
      meaning: { ...first.meaning, tags: ['钢琴练习'] }, sources: first.sources, contextEvidence: [] }
    await store.applyNoteOperation(update)
    assert.deepEqual(await store.applyRelationOperation(link), receipt)
    assert.equal((await store.listNoteRelations(first.id)).relations[0].status, 'stale')
    assert.deepEqual((await store.listRecallRelations(first.id)).relations, [])
    await store.eraseSources({ operationId: randomUUID(), evidence: [a], sessionIds: [] })
    assert.equal(await store.getNoteV2(first.id), null)
    assert.equal((await store.getNoteV2(second.id)).status, 'active')
    assert.equal(await store.getOperationReceipt(link.operationId), null)
    assert.deepEqual((await store.listNoteRelations(second.id)).relations, [])
  } finally { await store.close() }
})

test('autonomous UPDATE, SUPERSEDE and RETRACT require explicit evidence and preserve original revisions', native, async () => {
  const f = fixture(), runtime = f.service()
  let first, replacement
  try {
    first = await f.submit(runtime, '我现在开始练习钢琴。', '开始')
    const ambiguous = await f.submit(runtime, '我现在暂停练习钢琴。', '暂停', 'UPDATE', first.noteId)
    assert.equal(ambiguous.status, 'review')
    const correction = await f.submit(runtime, '更正：练习钢琴从开始改为暂停。', '暂停', 'UPDATE', first.noteId)
    assert.equal(correction.status, 'applied')
    replacement = await f.submit(runtime, '练习钢琴从暂停改为停止。', '停止', 'SUPERSEDE', first.noteId)
    assert.equal(replacement.status, 'applied')
    const retract = await f.submit(runtime, '撤回：练习钢琴从暂停改为停止。', '停止', 'RETRACT', replacement.noteId)
    assert.equal(retract.status, 'applied')
  } finally { await runtime.close() }
  const admin = f.admin()
  try {
    await admin.open()
    assert.equal((await admin.getRevision(first.noteId, 1)).snapshot.content, '我现在开始练习钢琴。')
    assert.equal((await admin.getRevision(first.noteId, 2)).snapshot.state.value, '暂停')
    assert.equal((await admin.getNoteV2(first.noteId)).status, 'superseded')
    assert.equal((await admin.getNoteV2(replacement.noteId)).status, 'retracted')
  } finally { await admin.close() }
})

test('candidate discovery reaches beyond the old 128-head boundary and can finish incrementally', native, async () => {
  const f = fixture()
  const ref = f.append('这是一条用于分页回归的原始报告。')
  const runtime = f.service()
  await runtime.close()
  const store = f.admin()
  const ids = Array.from({ length: 140 }, () => randomUUID()).sort()
  try {
    await store.open()
    for (const [i, id] of ids.entries()) await store.applyNoteOperation({ action: 'ADD', operationId: randomUUID(), id,
      reason: '分页夹具', sources: { evidence: [ref] }, contextEvidence: [],
      meaning: { content: i === 139 ? '分页特殊主题紫杉' : '普通分页认识', subject: 'profile-user',
        basis: 'direct', kind: 'event', eventTime: null, tags: ['普通'] } })
  } finally { await store.close() }
  const next = f.service()
  try {
    const ref = f.append('分页特殊主题紫杉')
    await next.delivered(f.session.id, [ref.messageIndex]); await next.flush(f.session.id)
    const job = await next.next()
    const context = await next.prepare(job.id, job.attempt, [])
    assert.equal(typeof context.candidatesComplete, 'boolean')
    await next.fail(job.id, job.attempt, 'cancelled')
    const newRef = f.append('分页特殊主题紫杉')
    for (let i = 0; i < 20; i++) await next.organize()
    await next.delivered(f.session.id, [newRef.messageIndex]); await next.flush(f.session.id)
    const another = await next.next()
    const rebuilt = await next.prepare(another.id, another.attempt, [])
    assert.equal(rebuilt.candidatesComplete, true)
    assert(rebuilt.notes.some(note => note.id === ids.at(-1)))
    await next.fail(another.id, another.attempt, 'cancelled')
  } finally { await next.close() }
})

test('built production Stage autonomously commits and exposes the network using three Mock model calls', native, () => {
  const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p1')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'autonomous-')))
  fs.writeFileSync(path.join(profile, '.note-formation-test'), 'aisling-note-formation-p1-fixture\n')
  const result = spawnSync(require('electron'), [path.join(__dirname, 'note-formation-smoke.cjs'), 'autonomous', profile, resources], {
    cwd: __dirname, windowsHide: true, encoding: 'utf8', timeout: 80_000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(key))),
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr)
  assert.match(result.stdout, /"result":"note-formation-passed"/)
})

test('relation rollback leaves no partial edge and the durable organizer recovers a committed lost reply', native, async () => {
  const f = fixture()
  const copied = path.join(f.profile, 'resources')
  fs.cpSync(resources, copied, { recursive: true })
  const rollback = path.join(f.profile, 'rollback-link')
  const lost = path.join(f.profile, 'lost-link-reply')
  const implementation = path.join(copied, 'note-v1.cjs')
  fs.writeFileSync(implementation, fs.readFileSync(implementation, 'utf8').replace(
    'const receipt = { operationId: command.operationId, fingerprint, action: command.action, changedAt,',
    `if (require('node:fs').existsSync(${JSON.stringify(rollback)})) throw new Error('injected-link-rollback');\n      const receipt = { operationId: command.operationId, fingerprint, action: command.action, changedAt,`))
  const worker = path.join(copied, 'worker.cjs')
  fs.renameSync(worker, path.join(copied, 'worker-real.cjs'))
  fs.writeFileSync(worker, ["const fs = require('node:fs')", 'const send = process.stdout.write.bind(process.stdout)',
    'process.stdout.write = (line, callback) => { const packet = JSON.parse(line);',
    `if (packet.ok && packet.result?.action === 'LINK' && !fs.existsSync(${JSON.stringify(lost)})) { fs.writeFileSync(${JSON.stringify(lost)}, 'committed'); process.exit(81) }`,
    'return send(line, callback) };', "require('./worker-real.cjs')"].join('\n'))
  const a = f.append('我现在开始练习钢琴。'), b = f.append('我现在暂停练习钢琴。')
  let runtime = f.service({ resources: copied })
  await runtime.close()
  const store = f.admin(copied)
  try {
    await store.open()
    for (const [i, ref] of [a, b].entries()) await store.applyNoteOperation({ action: 'ADD', id: randomUUID(), operationId: randomUUID(),
      reason: '原始状态夹具', meaning: meaning(f.session.messages[i].content, i ? '暂停' : '开始'), sources: { evidence: [ref] }, contextEvidence: [] })
    const heads = (await store.listRecallHeads()).notes
    const plan = planNoteRelation(heads[0], heads[1], sourceMessageLookup(f.readData()))
    const command = { ...plan, action: 'LINK', operationId: randomUUID() }
    fs.writeFileSync(rollback, '')
    await assert.rejects(store.applyRelationOperation(command), /injected-link-rollback/)
    assert.deepEqual((await store.listNoteRelations(plan.from)).relations, [])
    assert.equal(await store.getOperationReceipt(command.operationId), null)
    fs.unlinkSync(rollback)
  } finally { await store.close() }
  runtime = f.service({ resources: copied })
  let pending
  try {
    await runtime.organize()
    assert(fs.existsSync(lost))
    pending = f.jobs().organization.tasks.find(task => task.commands?.length)
    assert(pending)
    assert.equal(pending.attempts, 1)
  } finally { await runtime.close() }
  runtime = f.service({ resources: copied })
  try {
    await runtime.organize()
    const completed = f.jobs().organization.tasks.find(task => task.id === pending.id && task.version === pending.version)
    assert.equal(completed.status, 'completed')
  } finally { await runtime.close() }
  const reopened = f.admin(copied)
  try {
    await reopened.open()
    const command = pending.commands[0]
    const receipt = await reopened.getOperationReceipt(command.operationId)
    assert.equal(receipt.fingerprint, operationFingerprint(command))
    assert.equal((await reopened.listNoteRelations(command.from)).relations.length, 1)
  } finally { await reopened.close() }
})
