const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { parseNoteProposals, parseNoteBatch, formationInput } = require('./note-formation-contract.mjs')
const { organizationInput, parseSemanticRelations, semanticRelationPlan, authorizeSemantic, refKey } = require('./note-semantic-contract.mjs')
const { authorizeOrganization, mergeOrganizationCandidates } = require('./note-organization-v2.mjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { messageDigest, sourceMessageLookup } = require('./memory-evidence.cjs')
const speakers = require('./memory-subjects.json')

const note = (id, content, patch = {}) => ({ id, version: 1, status: 'active', createdAt: 1, subject: 'profile-user',
  content, kind: 'event', basis: 'direct', eventTime: null, tags: ['钢琴'], ...patch })
const entry = (i, content, scope = 'current') => ({ ref: { sessionId: 'source', messageIndex: i, digest: String(i + 1).repeat(64) },
  message: { role: 'user', content, createdAt: i + 1 }, scope })
const base = note('old', '用户曾暂停钢琴练习。')
const context = { speakers, notes: [base], evidence: [entry(1, '最近又开始练琴了。'), entry(0, '我先把钢琴练习搁下了。', 'history')],
  noteGrounds: { old: [entry(0, '').ref] }, candidatesComplete: true }
const wire = (relation = 'state-change') => ({ action: 'ADD', target: null, reason: '新的独立练习经历',
  draft: { content: '用户恢复钢琴练习。', kind: 'event', basis: 'direct', subject: 'S1', eventTime: null, tags: ['钢琴'],
    sources: [{ label: 'E1', quote: context.evidence[0].message.content }] },
  semantic: { relation, target: 'N1', scope: '钢琴练习', sources: [{ label: 'E1', quote: context.evidence[0].message.content }],
    targetSources: [{ label: 'E2', quote: context.evidence[1].message.content }] } })
const parse = (item, ctx = context) => parseNoteProposals(JSON.stringify({ items: [item] }), ctx)[0]
const environment = { complete: true, heads: [{ note: base }], lookup: ref => context.evidence.find(entry => refKey(entry.ref) === refKey(ref))?.message }

test('semantic paraphrases retain original clause anchors, and never authorize destructive operations alone', () => {
  const proposal = parse(wire())
  assert.equal(authorizeOrganization(proposal, environment), true)
  assert.equal(authorizeOrganization({ ...proposal, semantic: undefined }, environment), false)
  for (const action of ['UPDATE', 'SUPERSEDE', 'RETRACT']) assert.equal(authorizeSemantic({ ...proposal, action, target: base }, environment), false)
  assert.equal(authorizeSemantic(proposal, { ...environment, complete: false }), false)
  assert.equal(JSON.parse(formationInput(context).messages[1].content).candidates[0].sources[0], 'E2')
  const forged = wire(); forged.semantic.targetSources[0] = { label: 'E1', quote: context.evidence[0].message.content }
  assert.throws(() => parse(forged), /target-source/)
  const uncertain = wire('uncertain')
  assert.equal(authorizeOrganization(parse(uncertain), environment), false)
})

test('semantic support preserves plans, negation, numbers and repeated-event identity', () => {
  const planned = { ...context, evidence: [entry(1, '我打算开始练琴。'), context.evidence[1]] }
  const value = wire(); value.draft.sources[0].quote = value.semantic.sources[0].quote = planned.evidence[0].message.content
  const result = parse(value, planned)
  assert.equal(authorizeSemantic(result, { ...environment, lookup: ref => planned.evidence.find(entry => refKey(entry.ref) === refKey(ref))?.message }), false)
  const clipped = wire(); clipped.draft.sources[0].quote = planned.evidence[0].message.content; clipped.semantic.sources[0].quote = '开始练琴'
  assert.throws(() => parse(clipped, planned), /fragment/)
  const numeric = parse(wire()); numeric.draft.meaning.content = '用户每天练琴35小时。'
  assert.equal(authorizeSemantic(numeric, environment), false)
  const repeat = parse(wire('same')); repeat.action = 'NOOP'; repeat.target = { ...base }
  assert.equal(authorizeSemantic(repeat, environment), false)
  repeat.draft.meaning.kind = repeat.target.kind = 'fact'
  repeat.draft.meaning.content = '用户喜爱钢琴。'; repeat.target.content = '用户喜欢钢琴。'
  assert.equal(authorizeSemantic(repeat, environment), true)
})

test('a valid proposal survives an invalid history-only sibling without accepting the invalid evidence', () => {
  const valid = wire(), invalid = { ...wire(), action: 'NOOP', target: 'N1', semantic: undefined,
    draft: { ...wire().draft, sources: [{ label: 'E2', quote: context.evidence[1].message.content }] } }
  const parsed = parseNoteBatch(JSON.stringify({ items: [valid, invalid] }), context)
  assert(parsed[0].proposal)
  assert.equal(parsed[1].proposal, null)
  assert.equal(parsed[1].error, 'draft-current-source')
  assert.throws(() => parseNoteBatch(JSON.stringify({ items: [invalid] }), context), /draft-current-source/)
})

test('semantic relationships respect actual event dates, distinguish facets and decline unresolved historical ordering', () => {
  const a = { note: note('a', '开始钢琴练习。', { eventTime: { kind: 'date', date: '2026-01-01' } }), grounds: { evidence: [context.evidence[0].ref] } }
  const b = { note: note('b', '暂停钢琴练习。', { eventTime: { kind: 'date', date: '2026-02-01' } }), grounds: { evidence: [context.evidence[1].ref] } }
  const plan = semanticRelationPlan('STATE_CHANGE', '钢琴练习', b, a, [...a.grounds.evidence, ...b.grounds.evidence], environment.lookup, '原始报告日期')
  assert.equal(plan.from, 'a'); assert.equal(plan.to, 'b'); assert.equal(plan.order, 'event'); assert.equal(plan.basis, 'inferred')
  const distinct = { ...b, note: { ...b.note, state: { scope: '购买钢琴', value: '完成' } } }
  assert.equal(semanticRelationPlan('STATE_CHANGE', '钢琴练习', a, distinct, [...a.grounds.evidence, ...b.grounds.evidence], environment.lookup, '同一主题'), null)
  const old = { ...a, note: { ...a.note, eventTime: null } }, later = { ...b, note: { ...b.note, eventTime: null } }
  assert.equal(semanticRelationPlan('STATE_CHANGE', '钢琴练习', old, later, [...a.grounds.evidence, ...b.grounds.evidence], () => ({ role: 'user', content: '去年曾经暂停。', createdAt: 1 }), '报告较新'), null)
  assert.equal(semanticRelationPlan('CONFLICTS', '钢琴练习', a, b, [...a.grounds.evidence, ...b.grounds.evidence], environment.lookup, '未解决冲突').order, 'unknown')
  assert.equal(semanticRelationPlan('STATE_CHANGE','研究主题',old,later,[...a.grounds.evidence,...b.grounds.evidence],()=>({role:'user',content:'我研究记忆和界面设计。',createdAt:1}),'不同研究工作'),null)
})

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 90_000 }
function fixture() {
  const root = path.resolve(__dirname, '../../artifacts/memory-organization-p6')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'test-'))), session = { id: 'original', messages: [] }
  let clock = Date.UTC(2026, 10, 11), enabled = true
  const readData = () => ({ 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }) })
  const append = content => { session.messages.push({ role: 'user', content, createdAt: clock + session.messages.length * 1000 });
    return { sessionId: session.id, messageIndex: session.messages.length - 1, digest: messageDigest(session.messages.at(-1)) } }
  const runtime = (workerResources = resources) => createNoteFormationService({ profile, resources: workerResources, readData, writeData: () => {}, consent: () => enabled,
    autonomous: true, now: () => clock })
  const admin = () => createNoteV2Store(async () => ({ node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'),
    file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }), () => {}, { readData, isSubjectConfirmed: s => s === 'profile-user' })
  const jobs = () => JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8'))
  return { profile, session, readData, append, runtime, admin, jobs, advance: () => { clock += 60_001 }, enable: value => { enabled = value } }
}

async function form(f, runtime, content, summary, date, targetId) {
  const ref = f.append(content)
  await runtime.delivered(ref.sessionId, [ref.messageIndex]); await runtime.flush(ref.sessionId)
  const job = await runtime.next(false), ctx = await runtime.prepare(job.id, job.attempt, [])
  const target = ctx.notes.findIndex(note => note.id === targetId)
  const old = target < 0 ? [] : ctx.evidence.flatMap((entry, i) => ctx.noteGrounds[targetId].some(ref => refKey(ref) === refKey(entry.ref))
    ? [{ label: 'E' + (i + 1), quote: entry.message.content }] : [])
  await runtime.submit(job.id, job.attempt, JSON.stringify({ items: [{ action: 'ADD', target: null, reason: '原文支持的独立经历',
    draft: { content: summary, kind: 'event', basis: 'direct', subject: 'S1', eventTime: { kind: 'date', date }, tags: ['钢琴'],
      sources: [{ label: 'E1', quote: content }] }, semantic: { relation: target < 0 ? 'independent' : 'state-change', target: target < 0 ? null : 'N' + (target + 1),
      scope: '钢琴练习', sources: [{ label: 'E1', quote: content }], targetSources: old } }] }))
  await runtime.next(false)
  return f.jobs().batches.find(batch => batch.id === job.id).items[0]
}

test('Main stores paraphrased independent episodes and commits source-backed evolution without rewriting history', native, async () => {
  const f = fixture(), runtime = f.runtime()
  try {
    const a = await form(f, runtime, '2026-01-01 我开始学钢琴。', '用户开始钢琴练习。', '2026-01-01')
    const b = await form(f, runtime, '2026-02-01 这段琴课先搁下了。', '用户暂停钢琴练习。', '2026-02-01', a.noteId)
    const c = await form(f, runtime, '2026-03-01 最近又开始练琴了。', '用户恢复钢琴练习。', '2026-03-01', b.noteId)
    assert([a, b, c].every(item => item.status === 'applied'))
    const snapshot = await runtime.recallSnapshot(), graph = await runtime.recallNeighbors([a.noteId], snapshot.version, true)
    assert.equal(snapshot.notes.length, 3)
    assert(graph.relations.some(link => link.from === a.noteId && link.to === b.noteId))
    assert(graph.relations.some(link => link.from === b.noteId && link.to === c.noteId))
    assert(graph.relations.every(link => link.order === 'event' && link.method === 'semantic' && link.uncertainty))
  } finally { await runtime.close() }
})

async function seedBackground(f) {
  const first = f.runtime(); await first.close()
  const store = f.admin(), ids = []
  try {
    await store.open()
    for (const content of ['纸舟支持离线导出。', '补充：纸舟的离线导出只提供 PDF 文件。']) {
      const ref = f.append(content), id = randomUUID(); ids.push(id)
      await store.applyNoteOperation({ action: 'ADD', id, operationId: randomUUID(), reason: '历史夹具',
        meaning: { content, subject: 'profile-user', kind: 'fact', basis: 'direct', eventTime: null, tags: ['纸舟', '导出'] },
        sources: { evidence: [ref] }, contextEvidence: [] })
    }
  } finally { await store.close() }
  return ids
}

function relationOutput(ctx, type = 'SUPPLEMENTS') {
  const detailed = ctx.notes.findIndex(note => note.content.includes('PDF')), base = detailed ? 0 : 1
  return JSON.stringify({ relations: [{ from: 'N' + (detailed + 1), to: 'N' + (base + 1), type, scope: '纸舟离线导出', reason: '后一原文明确补充了输出格式',
    sources: ctx.evidence.map((entry, i) => ({ label: 'E' + (i + 1), quote: entry.message.content })) }] })
}

test('idle semantic jobs use original evidence, deduplicate signatures, survive restart, and stop with Formation', native, async () => {
  const f = fixture(), ids = await seedBackground(f)
  let runtime = f.runtime()
  try {
    for (let i = 0; i < 4; i++) await runtime.organize()
    assert.equal(await runtime.next(false), null)
    const job = await runtime.next()
    assert.equal(job.kind, 'organization')
    const ctx = await runtime.prepare(job.id, job.attempt, [])
    assert.equal(ctx.mode, 'organization'); assert.equal(ctx.notes.length, 2)
    assert.doesNotMatch(JSON.stringify(organizationInput(ctx)), /digest|operationId/)
    assert.equal(parseSemanticRelations(relationOutput(ctx), ctx).length, 1)
    f.enable(false)
    await assert.rejects(runtime.submit(job.id, job.attempt, relationOutput(ctx)), /stale-organization/)
    await runtime.fail(job.id, job.attempt, 'cancelled')
    await runtime.close(); f.enable(true); f.advance(); runtime = f.runtime()
    const retry = await runtime.next(), retried = await runtime.prepare(retry.id, retry.attempt, [])
    await runtime.submit(retry.id, retry.attempt, relationOutput(retried))
    const snapshot = await runtime.recallSnapshot(), graph = await runtime.recallNeighbors([ids[0]], snapshot.version)
    assert.equal(graph.relations[0].type, 'SUPPLEMENTS')
    f.advance()
    assert.equal(await runtime.next(), null)
    assert(f.jobs().organization.semanticSeen.length === 1)
    assert(f.jobs().organization.semanticCalls.length === 2)
  } finally { await runtime.close() }
})

test('semantic output cannot cross endpoint versions or resurrect links after source deletion', native, async () => {
  const f = fixture(), ids = await seedBackground(f)
  let runtime = f.runtime()
  for (let i = 0; i < 4; i++) await runtime.organize()
  const job = await runtime.next(), ctx = await runtime.prepare(job.id, job.attempt, [])
  await runtime.close()
  const store = f.admin()
  try {
    await store.open()
    const target = await store.getNoteV2(ids[0]), revision = await store.getRevision(ids[0], 1)
    await store.applyNoteOperation({ action: 'UPDATE', id: ids[0], expectedVersion: 1, operationId: randomUUID(), reason: '并发修订',
      meaning: { content: target.content, subject: target.subject, kind: target.kind, basis: target.basis, eventTime: null, tags: ['纸舟修订'] },
      sources: revision.grounds, contextEvidence: [] })
  } finally { await store.close() }
  f.advance(); runtime = f.runtime()
  try {
    await assert.rejects(runtime.submit(job.id, job.attempt, relationOutput(ctx)), /stale-organization/)
    const snapshot = await runtime.recallSnapshot()
    assert.equal((await runtime.recallNeighbors(ids, snapshot.version)).relations.length, 0)
  } finally { await runtime.close() }
  const reopened = f.admin()
  try {
    await reopened.open()
    const note = await reopened.getNoteV2(ids[0]), revision = await reopened.getRevision(note.id, note.version)
    await reopened.eraseSources({ operationId: randomUUID(), evidence: revision.grounds.evidence, sessionIds: [] })
    assert.equal(await reopened.getNoteV2(ids[0]), null)
    assert.equal((await reopened.getNoteV2(ids[1])).status, 'active')
  } finally { await reopened.close() }
})

test('durable semantic limits survive restart and exhausted evidence signatures cannot loop through peer tasks', native, async () => {
  const f = fixture(); await seedBackground(f)
  let runtime = f.runtime()
  for (let i = 0; i < 4; i++) await runtime.organize()
  await runtime.close()
  const file = path.join(f.profile, 'note-formation-jobs.v1.json'), saved = f.jobs()
  saved.organization.semanticCalls = Array(8).fill(Date.UTC(2026, 10, 11))
  fs.writeFileSync(file, JSON.stringify(saved))
  runtime = f.runtime()
  try {
    assert.equal(await runtime.next(), null)
    for (let i = 0; i < 60; i++) f.advance()
    const first = await runtime.next()
    assert.equal(first.kind, 'organization')
    await runtime.fail(first.id, first.attempt, 'provider-error')
    assert.equal(await runtime.next(), null)
    f.advance()
    const second = await runtime.next()
    assert.equal(second.id, first.id); assert.equal(second.attempt, 2)
    await runtime.fail(second.id, second.attempt, 'timeout')
    f.advance()
    assert.equal(await runtime.next(), null)
    assert.equal(f.jobs().organization.semanticCalls.length, 2)
    assert.equal(f.jobs().organization.semanticSeen.length, 1)
  } finally { await runtime.close() }
  const malformed = f.jobs()
  malformed.organization.tasks[0].semantic = { status: 'running', attempts: 1, refs: [{ digest: 'invalid' }] }
  fs.writeFileSync(file, JSON.stringify(malformed))
  assert.throws(() => f.runtime(), /invalid-formation-jobs/)
})

test('trusted historical Recall reads prior UPDATE and SUPERSEDE beliefs and rejects edited or erased sources', native, async () => {
  const f = fixture(); await f.runtime().close()
  const store = f.admin(), id = randomUUID(), successor = randomUUID()
  const initial = f.append('我暂停钢琴练习。'), correction = f.append('更正：只是暂停上课，练习一直继续。'), changed = f.append('我现在恢复上课了。')
  const meaning = content => ({ content, subject: 'profile-user', kind: 'fact', basis: 'direct', eventTime: null, tags: ['钢琴'] })
  try {
    await store.open()
    await store.applyNoteOperation({ action: 'ADD', operationId: randomUUID(), id, reason: '原报告', meaning: meaning('用户暂停钢琴练习。'), sources: { evidence: [initial] }, contextEvidence: [] })
    await store.applyNoteOperation({ action: 'UPDATE', operationId: randomUUID(), id, expectedVersion: 1, reason: '明确更正', meaning: meaning('钢琴课暂停，练习一直继续。'), sources: { evidence: [correction] }, contextEvidence: [] })
    assert.equal((await store.getRecallHistory(id)).snapshot.content, '用户暂停钢琴练习。')
    const original = f.session.messages[0]
    f.session.messages[0] = { ...original, content: '已修改的原始来源。' }
    assert.equal(await store.getRecallHistory(id), null)
    f.session.messages[0] = original
    await store.applyNoteOperation({ action: 'SUPERSEDE', operationId: randomUUID(), id, expectedVersion: 2, newId: successor,
      transition: 'explicit-same-scope-change', reason: '课程状态变化', meaning: meaning('用户恢复钢琴课。'), sources: { evidence: [changed] }, contextEvidence: [] })
    assert.equal((await store.getRecallHistory(successor)).snapshot.content, '钢琴课暂停，练习一直继续。')
    assert.equal(await store.getRecallHistory(id), null)
    await store.eraseSources({ operationId: randomUUID(), evidence: [correction], sessionIds: [] })
    assert.equal(await store.getRecallHistory(successor), null)
  } finally { await store.close() }
})

test('a semantic LINK committed before a lost reply settles from its receipt after restart without another model call', native, async () => {
  const f = fixture(), ids = await seedBackground(f)
  const copied = path.join(f.profile, 'resources'), lost = path.join(f.profile, 'lost-reply')
  fs.cpSync(resources, copied, { recursive: true })
  fs.renameSync(path.join(copied, 'worker.cjs'), path.join(copied, 'worker-real.cjs'))
  fs.writeFileSync(path.join(copied, 'worker.cjs'), ["const fs = require('node:fs')", 'const send = process.stdout.write.bind(process.stdout)',
    'process.stdout.write = (line, callback) => { const packet = JSON.parse(line);',
    `if (packet.ok && packet.result?.action === 'LINK' && !fs.existsSync(${JSON.stringify(lost)})) { fs.writeFileSync(${JSON.stringify(lost)}, 'committed'); process.exit(81) }`,
    'return send(line, callback) };', "require('./worker-real.cjs')"].join('\n'))
  let runtime = f.runtime(copied)
  try {
    for (let i = 0; i < 4; i++) await runtime.organize()
    const job = await runtime.next(), ctx = await runtime.prepare(job.id, job.attempt, [])
    await assert.rejects(runtime.submit(job.id, job.attempt, relationOutput(ctx)), { code: 'outcome-unknown' })
    assert(fs.existsSync(lost))
    assert(f.jobs().organization.tasks.some(task => task.semantic?.status === 'settling'))
  } finally { await runtime.close() }
  runtime = f.runtime(copied)
  try {
    await runtime.recover()
    const task = f.jobs().organization.tasks.find(task => task.semantic?.status === 'completed' && task.semantic.results?.length)
    assert.equal(task.semantic.results[0].status, 'applied')
    const snapshot = await runtime.recallSnapshot()
    assert.equal((await runtime.recallNeighbors(ids, snapshot.version)).relations.length, 1)
    assert.equal(f.jobs().organization.semanticCalls.length, 1)
  } finally { await runtime.close() }
})

test('production Stage runs idle semantic Provider jobs and injects evolution into a real Core request', native, () => {
  const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p1')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'semantic-')))
  fs.writeFileSync(path.join(profile, '.note-formation-test'), 'aisling-note-formation-p1-fixture\n')
  const result = spawnSync(require('electron'), [path.join(__dirname, 'note-formation-smoke.cjs'), 'semantic', profile, resources], {
    cwd: __dirname, windowsHide: true, encoding: 'utf8', timeout: 80_000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$|DEEPSEEK_API_KEY$)/i.test(key))),
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr)
  assert.match(result.stdout, /"result":"note-formation-passed"/)
})
