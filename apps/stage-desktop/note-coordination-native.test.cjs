const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { test } = require('node:test'), { randomUUID } = require('node:crypto')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { embeddingIdentity } = require('./note-embedding.cjs')
const { messageDigest } = require('./memory-evidence.cjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 60000 }
const vector = x => [x, ...Array(1023).fill(0)]
const config = { modelId: 'synthetic/semantic', model: 'test', apiKey: 'test-only', endpoint: 'https://mock.invalid' }

test('an empty Note corpus never pays for a query vector', native, async () => {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p31'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'empty-')))
  const data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [{ id: 'new', messages: [{ role: 'user', content: '我喜欢安静的地方。' }] }] }) }
  let calls = 0
  const service = createNoteFormationService({ profile, resources, readData: () => data, writeData() {}, consent: () => true,
    embeddingConfig: () => config, embeddingRequest: async () => { calls++; return [vector(1)] } })
  try {
    await service.delivered('new', [0]); await service.flush('new'); const job = await service.next(false)
    assert.equal((await service.prepare(job.id, job.attempt, [])).notes.length, 0); assert.equal(calls, 0)
  } finally { await service.close() }
})

async function fixture(request, sequence = false) {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p31'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'native-')))
  const texts = sequence ? ['之前我用方案A整理目录，效果不好，后来我改用方案B整理目录。', '我现在用方案B整理目录。']
    : ['Cedar indexes catalogues.', 'Glass celebrates summer.', '停止继续使用检索程序。']
  const session = { id: 'synthetic', messages: texts.map(content => ({ role: 'user', content })) }
  let data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }) }, selected = sequence ? undefined : config
  const readData = () => data, writeData = value => { data = value }
  const ref = i => ({ sessionId: session.id, messageIndex: i, digest: messageDigest(session.messages[i]) })
  fs.writeFileSync(path.join(profile, 'memory-authority'), 'note-v2\n')
  const file = path.join(profile, 'memory-note-v2/note-v2.lbdb'); fs.mkdirSync(path.dirname(file))
  const admin = () => createNoteV2Store(async () => ({ file, node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs') }),
    () => {}, { readData, isSubjectConfirmed: () => true })
  const store = admin(), ids = []
  try {
    await store.open()
    for (let i = 0; i < (sequence ? 1 : 2); i++) {
      const id = randomUUID(); ids.push(id)
      await store.applyNoteOperation({ action: 'ADD', id, operationId: randomUUID(), reason: 'Synthetic original', contextEvidence: [],
        meaning: { subject: 'profile-user', content: sequence ? '用户报告用方案A整理目录。' : texts[i], kind: 'project-state', basis: 'direct', eventTime: null,
          ...(sequence && { state: { scope: '整理目录', value: '方案A' } }) }, sources: { evidence: [ref(i)] } })
      if (!sequence) await store.putEmbedding({ ...embeddingIdentity(await store.getNoteV2(id), config), embedding: vector(i ? -1 : 1) })
    }
  } finally { await store.close() }
  const options = { profile, resources, readData, writeData, autonomous: sequence, consent: () => true,
    embeddingConfig: () => selected, embeddingRequest: request }
  const service = createNoteFormationService(options)
  async function job() { await service.delivered(session.id, [texts.length - 1]); await service.flush(session.id); return service.next(false) }
  return { profile, ids, service, options, job, ref, readData, writeData, configure: value => { selected = value } }
}

test('Formation really queries persisted vectors, fuses candidates, reuses Recall cache and preserves the query budget', native, async () => {
  let calls = 0
  const f = await fixture(async (_config, texts, type) => { calls++; assert.equal(type, 'query'); assert.equal(texts.length, 1); return [vector(1)] })
  try {
    let job = await f.job()
    const input = await f.service.prepare(job.id, job.attempt, [])
    assert(input.notes.some(n => n.id === f.ids[0])); assert(!input.notes.some(n => n.id === f.ids[1]))
    await f.service.fail(job.id, job.attempt, 'invalid-json'); await f.service.retry(job.id, job.attempt); job = await f.service.next(false)
    assert((await f.service.prepare(job.id, job.attempt, [])).notes.some(n => n.id === f.ids[0]))
    const snapshot = await f.service.recallSnapshot()
    assert((await f.service.recallCandidates('停止继续使用检索程序。', snapshot.version)).candidates.some(c => c.noteId === f.ids[0] && c.channels.includes('embedding')))
    assert.equal(calls, 1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'note-formation-jobs.v1.json'))).queryEmbeddingCalls.length, 1)
    await f.service.fail(job.id, job.attempt, 'invalid-json'); await f.service.retry(job.id, job.attempt); job = await f.service.next(false)
    f.configure(undefined)
    assert.equal((await f.service.prepare(job.id, job.attempt, [])).notes.length, 0)
    assert.equal(calls, 1)
  } finally { await f.service.close() }
})

for (const mode of ['error', 'timeout', 'erase', 'close', 'configuration']) test(`optional query embedding safely falls back or fences stale work: ${mode}`, native, async () => {
  let entered, finish
  const started = new Promise(resolve => { entered = resolve })
  const delayed = new Promise(resolve => { finish = resolve })
  const f = await fixture(async () => { entered(); if (mode === 'error') throw Error('synthetic failure'); return delayed })
  try {
    const job = await f.job(), pending = f.service.prepare(job.id, job.attempt, [])
    await started
    if (mode === 'erase') {
      const next = { 'aisling.conversations.v1': JSON.stringify({ sessions: [] }) }
      f.service.privacy.beforeConversationChange(f.readData(), next); f.writeData(next)
      await assert.rejects(pending, /stale|source|erasure/)
    } else if (mode === 'close') {
      await f.service.close(); await assert.rejects(pending, /closing/)
    } else {
      if (mode === 'configuration') { f.configure({ ...config, modelId: 'different/space' }); finish([vector(1)]) }
      const context = await pending
      assert.equal(context.notes.length, 0)
      assert.equal(context.evidence.length, 1)
    }
  } finally { finish([vector(1)]); await f.service.close() }
})

test('relative source proof reaches the actual Main/Worker transaction, survives restart and cannot survive source erasure', native, async () => {
  const f = await fixture(async () => { throw Error('No embedding expected') }, true)
  let service = f.service
  try {
    const job = await f.job(), context = await service.prepare(job.id, job.attempt, [f.ref(0)])
    const current = context.evidence[0].message.content, history = context.evidence[1].message.content
    const sources = [{ label: 'E1', quote: current }, { label: 'E2', quote: history }]
    await service.submit(job.id, job.attempt, JSON.stringify({ items: [{ action: 'ADD', target: null, reason: '同一活动的原文明确替换',
      draft: { content: '用户报告现在用方案B整理目录。', kind: 'project-state', basis: 'direct', subject: 'S1', eventTime: null,
        tags: ['目录'], state: { scope: '整理目录', value: '方案B' }, sources },
      semantic: { relation: 'state-change', target: 'N1', scope: '整理目录', sources, targetSources: [sources[1]] } }] }))
    await service.recover()
    let snapshot = await service.recallSnapshot(), graph = await service.recallNeighbors([f.ids[0]], snapshot.version)
    assert.equal(snapshot.notes.length, 2); assert.equal(graph.relations.length, 1)
    assert.equal(graph.relations[0].from, f.ids[0]); assert.match(graph.relations[0].uncertainty, /相对|无绝对/)
    await service.close(); service = createNoteFormationService(f.options); await service.recover()
    snapshot = await service.recallSnapshot(); graph = await service.recallNeighbors([f.ids[0]], snapshot.version)
    assert.equal(graph.relations.length, 1)
    const next = { 'aisling.conversations.v1': JSON.stringify({ sessions: [] }) }
    service.privacy.beforeConversationChange(f.readData(), next); f.writeData(next); await service.recover()
    assert.equal((await service.recallSnapshot()).notes.length, 0)
  } finally { await service.close() }
})
