const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { createNoteFormationService } = require('./note-formation.cjs')
const { formationFailure, automaticFormationRetry } = require('./note-formation-errors.mjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 60000 }

function fixture(options = {}) {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p1')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'reliability-')))
  const input = { id: 'synthetic', messages: ['我喜欢蓝色。', '我喜欢安静的地方。', '这个偏好只是我的报告。'].map(content => ({ role: 'user', content })) }
  const dataFile = path.join(profile, 'aisling-store.json'), jobsFile = path.join(profile, 'note-formation-jobs.v1.json')
  fs.writeFileSync(dataFile, JSON.stringify({ 'aisling.conversations.v1': JSON.stringify({ sessions: [input], activeId: input.id }) }))
  const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  let clock = 100000, enabled = true
  const start = (extra = {}) => createNoteFormationService({ profile, resources, readData,
    writeData: value => fs.writeFileSync(dataFile, JSON.stringify(value)), now: () => clock,
    consent: () => enabled, autonomous: true, authorize: () => true, ...options, ...extra })
  const jobs = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8'))
  async function deliver(service) { await service.delivered(input.id, [0, 1]); await service.delivered(input.id, [2]); await service.flush(input.id) }
  async function proposal(service, job, items) {
    const context = await service.prepare(job.id, job.attempt, [])
    const item = { action: 'ADD', target: null, reason: '合成测试', draft: { content: input.messages[0].content,
      kind: 'preference', basis: 'direct', subject: 'S1', eventTime: null, tags: ['蓝色'],
      sources: [{ label: 'E1', quote: input.messages[0].content }] } }
    await service.submit(job.id, job.attempt, JSON.stringify({ items: items ? items(item, context) : [item] }))
    return item
  }
  return { profile, jobsFile, jobs, input, readData, start, deliver, proposal,
    advance: ms => { clock += ms }, enable: value => { enabled = value },
    change(service, sessions) {
      const next = { 'aisling.conversations.v1': JSON.stringify({ sessions, activeId: sessions[0]?.id ?? null }) }
      service.privacy.beforeConversationChange(readData(), next)
      fs.writeFileSync(dataFile, JSON.stringify(service.privacy.sanitizedData(next)))
    } }
}

test('failure taxonomy preserves stable codes and phases, drops private text, and retries only transient transport failures', () => {
  for (const [error, phase, category] of [
    [{ status: 0, message: 'private key and body' }, 'provider', 'provider'],
    [new SyntaxError('private model response'), 'provider', 'response-parse'],
    ['proposal-shape', 'parse', 'contract-invalid'], ['semantic-shape', 'parse', 'semantic-invalid'],
    ['source-changed', 'source', 'source-invalid'], ['review-required', 'settle', 'review-required'],
    ['stale-version', 'settle', 'authorization-rejected'], ['outcome-unknown', 'settle', 'persistence'],
    ['interrupted', 'interrupted', 'interrupted'], [new Error('private original message'), 'prepare', 'unknown'],
  ]) assert.equal(formationFailure(error, phase).category, category)
  assert.equal(formationFailure(new Error('private original message')).code, 'unknown-failure')
  assert.equal(formationFailure(new Error("Error invoking remote method 'prepare': Error: draft-quote"), 'prepare').code, 'draft-quote')
  assert(automaticFormationRetry(formationFailure({ status: 503 }, 'provider')))
  assert(!automaticFormationRetry(formationFailure({ status: 401 }, 'provider')))
  assert(!automaticFormationRetry(formationFailure('provider-error')))
  assert(!automaticFormationRetry(formationFailure('invalid-json', 'provider')))
  for (const code of ['worker-stopped', 'spawn-failed', 'pipe-error', 'startup-timeout', 'worker-resources-locked', 'invalid-payload']) {
    const failure = formationFailure({ code, message: 'synthetic private Worker detail' }, 'prepare')
    assert.equal(failure.code, code); assert.equal(failure.category, 'persistence')
    assert(!automaticFormationRetry(failure))
  }
})

test('delivery publishes task and cursor atomically, deduplicates overlaps, and survives a fault before model invocation', native, async () => {
  const f = fixture(), service = f.start()
  const rename = fs.renameSync
  const originalJobs = fs.readFileSync(f.jobsFile)
  try {
    fs.renameSync = (from, to) => { if (to === f.jobsFile) throw Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' }); return rename(from, to) }
    await assert.rejects(service.delivered(f.input.id, [0]), { code: 'ENOSPC' })
    assert.deepEqual(fs.readFileSync(f.jobsFile), originalJobs)
    fs.renameSync = rename
    await Promise.all([service.delivered(f.input.id, [0]), service.delivered(f.input.id, [0, 1]), service.delivered(f.input.id, [0, 1])])
    assert.equal(f.jobs().progress.synthetic, 2)
    assert.equal(f.jobs().batches.length, 1)
    assert.deepEqual(f.jobs().batches[0].evidence.map(ref => ref.messageIndex), [0, 1])
    await service.flush(f.input.id)
  } finally { fs.renameSync = rename; await service.close() }
  let restarted = f.start()
  const job = await restarted.next(false)
  await restarted.close()
  restarted = f.start()
  try {
    const batch = f.jobs().batches[0]
    assert.equal(batch.status, 'failed'); assert.equal(batch.failure.code, 'interrupted')
    assert.equal(batch.evidence.length, 2); assert.equal(f.jobs().progress.synthetic, 2)
    assert.equal(await restarted.next(false), null)
    assert.equal(await restarted.retry(job.id, job.attempt), 'queued')
    assert.equal((await restarted.next(false)).attempt, 2)
  } finally { await restarted.close() }
})

test('Worker startup failure before a model lease is durably classified and explicitly recoverable', native, async () => {
  const f = fixture()
  let service = f.start({ resources: path.join(f.profile, 'unavailable-resources') })
  await f.deliver(service)
  await assert.rejects(service.next(false), { code: 'ENOENT' })
  const batch = f.jobs().batches[0]
  assert.equal(batch.status, 'failed'); assert.equal(batch.attempts, 1)
  assert.equal(batch.failure.category, 'persistence'); assert.equal(batch.failure.phase, 'prepare')
  assert.equal(f.jobs().progress.synthetic, 3)
  assert.equal((await service.reviews()).ready, false)
  assert.equal((await service.reviews()).formation.batches[0].failure.code, 'persistence-failure')
  await service.close()
  service = f.start()
  try {
    assert.equal(await service.next(false), null)
    assert.equal(await service.retry(batch.id, 1), 'queued')
    assert.equal((await service.next(false)).attempt, 2)
  } finally { await service.close() }
})

test('one delayed automatic retry and all manual attempts survive restarts without resetting budgets or cursors', native, async () => {
  const f = fixture()
  let service = f.start()
  try {
    await f.deliver(service)
    let job = await service.next(false)
    await service.fail(job.id, job.attempt, { code: 'provider-network', phase: 'provider' })
    assert.equal(f.jobs().batches[0].status, 'failed')
    assert.equal((await service.reviews()).formation.counts.retryable, 1)
    for (let i = 0; i < 3; i++) {
      await service.close(); service = f.start()
      assert.equal(await service.next(false), null)
      assert.equal(f.jobs().batches[0].autoRetries, 1)
    }
    f.advance(15000)
    job = await service.next(false)
    assert.equal(job.attempt, 2)
    await service.fail(job.id, job.attempt, { code: 'timeout', phase: 'provider' })
    for (let i = 0; i < 2; i++) { await service.close(); service = f.start(); assert.equal(await service.next(false), null) }
    const clicks = await Promise.all([service.retry(job.id, 2), service.retry(job.id, 2)])
    assert.deepEqual(clicks, ['queued', 'not-failed'])
    const claims = await Promise.all([service.next(false), service.next(false)])
    assert.equal(claims.filter(Boolean).length, 1)
    assert.equal(claims[0].attempt, 3)
    await service.fail(job.id, 2, 'invalid-json')
    assert.equal(f.jobs().batches[0].status, 'running')
    await service.fail(job.id, 3, { code: 'provider-network', phase: 'provider' })
    const batch = f.jobs().batches[0]
    assert.equal(batch.status, 'failed'); assert.equal(batch.autoRetries, 1)
    assert.deepEqual(batch.history.map(entry => entry.failure.code), ['provider-network', 'timeout', 'provider-network'])
    assert.equal(f.jobs().progress.synthetic, 3)
  } finally { await service.close() }
})

test('parse/contract/semantic failures retain prepared references, never loop, and require an explicit retry', native, async () => {
  const f = fixture(), service = f.start()
  try {
    await f.deliver(service)
    for (const [index, code] of ['invalid-json', 'proposal-shape', 'semantic-shape'].entries()) {
      const job = await service.next(false)
      assert.equal(job.attempt, index + 1)
      await service.prepare(job.id, job.attempt, [])
      await service.fail(job.id, job.attempt, { code, phase: 'parse' })
      assert.equal(await service.next(false), null)
      assert(f.jobs().batches[0].prepared.refs.length)
      if (index < 2) assert.equal(await service.retry(job.id, job.attempt), 'queued')
    }
    f.enable(false)
    assert.equal(await service.retry(f.jobs().batches[0].id, 3), 'formation-disabled')
    assert.equal((await service.reviews()).formation.counts.failed, 1)
    assert(!JSON.stringify(f.jobs().batches[0].history).includes(f.input.messages[0].content))
  } finally { await service.close() }
})

test('completed batches retain applied/rejected/skipped counts, and review-required is never generatively retried', native, async () => {
  const f = fixture(), service = f.start()
  try {
    await f.deliver(service)
    const job = await service.next(false)
    await f.proposal(service, job, item => [item, { ...item, draft: { ...item.draft, sources: [{ label: 'E1', quote: '不存在的引文' }] } },
      { action: 'UNDECIDED', target: null, draft: null, reason: '没有决定' }])
    await service.recover()
    const row = (await service.reviews()).formation.batches[0]
    assert.equal(row.status, 'completed'); assert.equal(row.applied, 1); assert.equal(row.rejected, 1); assert.equal(row.skipped, 1)
    assert.equal(await service.retry(job.id, job.attempt), 'not-failed')
    assert.equal((await service.listRecallHeads()).notes.length, 1)
  } finally { await service.close() }
  const pending = fixture(), reviewService = pending.start({ authorize: () => false })
  try {
    await pending.deliver(reviewService); const job = await reviewService.next(false)
    await pending.proposal(reviewService, job); await reviewService.recover()
    const result = await reviewService.reviews()
    assert.equal(result.formation.counts.reviewRequired, 1)
    assert.equal(result.formation.counts.failed, 0)
    assert.equal(await reviewService.retry(job.id, job.attempt), 'not-failed')
    assert.equal(await reviewService.next(false), null)
  } finally { await reviewService.close() }
})

test('deleted evidence cannot be retried or resurrected, including a source restored behind the deletion barrier', native, async () => {
  const f = fixture(), service = f.start()
  try {
    await f.deliver(service); const job = await service.next(false)
    await service.fail(job.id, job.attempt, 'invalid-json')
    f.change(service, []); await service.recover()
    assert.equal(await service.retry(job.id, job.attempt), 'stale')
    assert.deepEqual((await service.listRecallHeads()).notes, [])
    const erased = (await service.reviews()).formation.batches
    assert.equal(erased.length, 1); assert.equal(erased[0].status, 'erased')
    assert.equal(erased[0].retryBlocked, 'source-changed')
    assert.equal(erased[0].history[0].failure.code, 'invalid-json')
    assert(!JSON.stringify(f.jobs().erasedFailures).includes(job.id))
    assert(!JSON.stringify(f.jobs().erasedFailures).includes('synthetic'))
    assert.equal(f.jobs().progress.synthetic, 3)
    f.change(service, [f.input]); await service.recover()
    await assert.rejects(service.delivered(f.input.id, [0, 1]), /invalid-delivery/)
    assert.equal(await service.next(false), null)
  } finally { await service.close() }
})

test('a deletion intent during review reads withholds quotes while task metadata remains available', native, async () => {
  const f = fixture(), service = f.start({ authorize: () => false })
  try {
    await f.deliver(service); const job = await service.next(false)
    await f.proposal(service, job); await service.recover()
    assert.equal((await service.reviews()).items.length, 1)
    const pending = service.reviews()
    await Promise.resolve()
    f.change(service, [])
    const snapshot = await pending
    assert.deepEqual(snapshot.items, [])
    assert(snapshot.formation)
    await service.recover()
    assert.deepEqual((await service.reviews()).items, [])
  } finally { await service.close() }
})

test('old v1 failures are read without bulk migration, retained alongside later success, and acquire compatible history on explicit retry', native, async () => {
  const f = fixture()
  let service = f.start()
  await f.deliver(service); const job = await service.next(false)
  await service.fail(job.id, job.attempt, 'provider-error'); await service.close()
  const old = f.jobs(), batch = old.batches[0]
  delete batch.history; delete batch.failure; delete batch.autoRetries
  old.batches.push({ ...structuredClone(batch), id: 'older-failure', error: 'invalid-json' })
  old.batches.push({ ...structuredClone(batch), id: 'later-completed', status: 'completed', items: [] })
  delete old.batches.at(-1).error
  fs.writeFileSync(f.jobsFile, JSON.stringify(old))
  const bytes = fs.readFileSync(f.jobsFile)
  service = f.start()
  try {
    const status = await service.reviews()
    assert(status.failed); assert.equal(status.formation.counts.failed, 2)
    assert.equal(status.formation.counts.completed, 1)
    assert.equal(status.formation.batches.length, 3)
    assert.deepEqual(fs.readFileSync(f.jobsFile), bytes)
    assert.equal(await service.next(false), null)
    assert.equal(await service.retry(job.id, 1), 'queued')
    const next = await service.next(false)
    await f.proposal(service, next); await service.recover()
    assert.equal(f.jobs().version, 1)
    assert.equal(f.jobs().batches[0].history[0].failure.code, 'provider-error')
    assert.equal(f.jobs().batches[0].history[0].startedAt, null)
    assert.equal(f.jobs().batches[0].history[1].outcome, 'completed')
  } finally { await service.close() }
})

test('database error after commit is recovered by the original Receipt; fail/duplicate retry never regenerate or duplicate the Note', native, async () => {
  const f = fixture(), copied = path.join(f.profile, 'resources'), marker = path.join(f.profile, 'committed')
  fs.cpSync(resources, copied, { recursive: true })
  fs.renameSync(path.join(copied, 'worker.cjs'), path.join(copied, 'worker-real.cjs'))
  fs.writeFileSync(path.join(copied, 'worker.cjs'), `
const fs = require('node:fs'), send = process.stdout.write.bind(process.stdout)
process.stdout.write = (line, callback) => {
  const packet = JSON.parse(line)
  if (packet.ok && packet.result?.action === 'ADD' && !fs.existsSync(${JSON.stringify(marker)})) {
    fs.writeFileSync(${JSON.stringify(marker)}, 'committed')
    return send(JSON.stringify({protocolVersion:1,requestId:packet.requestId,ok:false,error:{code:'database-error',message:'synthetic private response'}})+'\\n', callback)
  }
  return send(line, callback)
}
require('./worker-real.cjs')
`)
  const service = f.start({ resources: copied })
  try {
    await f.deliver(service); const job = await service.next(false)
    await f.proposal(service, job)
    const operationId = f.jobs().batches[0].items[0].operationId
    await assert.rejects(service.recover(), { code: 'database-error' })
    assert.equal(f.jobs().batches[0].failure.category, 'persistence')
    assert(!fs.readFileSync(f.jobsFile, 'utf8').includes('synthetic private response'))
    await service.fail(job.id, job.attempt, { code: 'provider-network', phase: 'provider' })
    assert.equal(f.jobs().batches[0].status, 'settling')
    assert.deepEqual(await Promise.all([service.retry(job.id, job.attempt), service.retry(job.id, job.attempt)]), ['completed', 'not-failed'])
    const batch = f.jobs().batches[0]
    assert.equal(batch.items[0].operationId, operationId)
    assert.equal(batch.items[0].reason, 'receipt-confirmed')
    assert.equal(batch.history[0].settlementFailures[0].code, 'database-error')
    assert.equal(batch.attempts, 1)
    assert.equal((await service.listRecallHeads()).notes.length, 1)
  } finally { await service.close() }
})

test('explicit manual attempts retain the entire lean history, and malformed new metadata fails closed', native, async () => {
  const f = fixture()
  let service = f.start()
  try {
    await f.deliver(service)
    for (let attempt = 1; attempt <= 33; attempt++) {
      const job = await service.next(false)
      assert.equal(job.attempt, attempt)
      await service.fail(job.id, attempt, 'invalid-json')
      if (attempt < 33) assert.equal(await service.retry(job.id, attempt), 'queued')
    }
    assert.equal(f.jobs().batches[0].history.length, 33)
    assert.equal(await service.next(false), null)
  } finally { await service.close() }
  const corrupt = f.jobs(); corrupt.batches[0].history[0].failure.code = 'private raw body'
  fs.writeFileSync(f.jobsFile, JSON.stringify(corrupt))
  assert.throws(() => f.start(), /invalid-formation-jobs/)
})

test('the existing 2MB cap blocks a new delivery atomically without discarding history, evidence or cursor', native, async () => {
  const f = fixture()
  let service = f.start()
  await f.deliver(service); const job = await service.next(false)
  await service.fail(job.id, job.attempt, 'invalid-json'); await service.close()
  const stored = f.jobs(); stored.syntheticPadding = ''
  stored.syntheticPadding = 'x'.repeat(1999999 - Buffer.byteLength(JSON.stringify(stored)))
  fs.writeFileSync(f.jobsFile, JSON.stringify(stored))
  service = f.start()
  try {
    f.change(service, [{ ...f.input, messages: [...f.input.messages, { role: 'user', content: '另一个合成来源。' }] }])
    const before = fs.readFileSync(f.jobsFile)
    await assert.rejects(service.delivered(f.input.id, [3]), /formation-job-limit/)
    assert.deepEqual(fs.readFileSync(f.jobsFile), before)
    assert.equal(f.jobs().progress.synthetic, 3)
    assert.equal(f.jobs().batches[0].attempts, 1)
    assert.equal(f.jobs().batches[0].history[0].failure.code, 'invalid-json')
    assert.equal(f.jobs().batches[0].evidence.length, 3)
  } finally { await service.close() }
})
