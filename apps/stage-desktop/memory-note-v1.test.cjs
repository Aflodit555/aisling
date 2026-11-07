const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, cpSync, copyFileSync, realpathSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { startWorker } = require('./memory-database/client.cjs')
const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')
const { uid, add, supersede, writeNoteFixture, verifyNoteFixture } = require('./memory-database/note-v1-fixture.cjs')

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const node = resources && join(resources, 'runtime', 'node.exe')
const entry = resources && join(resources, 'worker.cjs')
const artifacts = resolve(__dirname, '../../artifacts/memory-note-p1-2')
function fixture(name, work) {
  test(name, { skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to prepared resources', timeout: 110000 }, async () => {
    mkdirSync(artifacts, { recursive: true })
    const directory = realpathSync(mkdtempSync(join(artifacts, 'test-')))
    await work({ node, entry, file: join(directory, 'note-v1.lbdb') }, directory)
  })
}

fixture('Note v1 operations, paged version sources, replay and new Worker', async config => {
  const store = createMemoryDatabaseStore(async () => config, () => {})
  try {
    await store.open()
    await writeNoteFixture(store)
    await store.close()
    await store.open()
    await verifyNoteFixture(store)
  } finally { await store.close() }
})

fixture('P0 and Note v1 reject cross-mode writes and a copied P0 schema', async (config, directory) => {
  const p0File = join(directory, 'memory.lbdb')
  const p0 = startWorker({ ...config, file: p0File })
  try {
    assert.equal((await p0.ready).schema, 'p0')
    await assert.rejects(p0.request('applyNoteOperation', [add]), { code: 'unknown-operation' })
    await p0.request('insertNote', [{ id: add.id, content: 'synthetic P0', createdAt: 0 }])
  } finally { await p0.close() }
  copyFileSync(p0File, config.file)
  const mismatched = startWorker(config)
  try { await assert.rejects(mismatched.ready, /schema mismatch/) }
  finally { await mismatched.close() }
})

fixture('Receipt collision at the end of SUPERSEDE rolls back both Notes, Revisions and source edges', async (config, directory) => {
  const wrapper = join(directory, 'receipt-collision.cjs')
  writeFileSync(wrapper, `
    const api = require(${JSON.stringify(join(resources, 'node_modules/@ladybugdb/core'))});
    const prepare = api.Connection.prototype.prepare;
    let receipts = 0;
    api.Connection.prototype.prepare = function (statement) {
      if (statement.includes('CREATE (:NoteOperation') && ++receipts === 2) {
        statement = statement.replace('operationId: $operationId',
          "operationId: CASE WHEN $operationId <> '' THEN '${add.operationId}' ELSE $operationId END");
      }
      return prepare.call(this, statement);
    };
    require(${JSON.stringify(entry)});
  `)
  const faulty = startWorker({ ...config, entry: wrapper })
  const replace = { ...supersede, expectedVersion: 1 }
  try {
    await faulty.ready
    await faulty.request('applyNoteOperation', [add])
    await assert.rejects(faulty.request('applyNoteOperation', [replace]), /duplicat|primary key/i)
  } finally { await faulty.close() }
  const api = require(join(resources, 'node_modules/@ladybugdb/core'))
  const database = new api.Database(config.file)
  const connection = new api.Connection(database)
  try {
    for (const statement of [
      'MATCH (o:Origin) RETURN count(o) AS total',
      'MATCH (e:Evidence) RETURN count(e) AS total',
      'MATCH (:Note)-[r:HAS_ORIGIN]->(:Origin) RETURN count(r) AS total',
      'MATCH (:Note)-[r:HAS_EVIDENCE]->(:Evidence) RETURN count(r) AS total',
    ]) {
      const result = await connection.query(statement)
      try { assert.deepEqual(await result.getAll(), [{ total: 1 }]) }
      finally { result.close() }
    }
  } finally {
    try { await connection.close() }
    finally { await database.close() }
  }
  const store = createMemoryDatabaseStore(async () => config, () => {})
  try {
    await store.open()
    assert.equal((await store.getNoteV1(add.id)).status, 'active')
    assert.equal(await store.getNoteV1(replace.newId), null)
    assert.equal(await store.getRevision(add.id, 2), null)
    assert.equal(await store.getRevision(replace.newId, 1), null)
    assert.equal(await store.getOperationReceipt(replace.operationId), null)
    // The same command can commit after recovery, including its source edges.
    assert.equal((await store.applyNoteOperation(replace)).affectedNotes.length, 2)
  } finally { await store.close() }
})

fixture('Note v1 receipt survives reply loss, writer lock rejection and forced Worker exit', async (config, directory) => {
  const barrier = join(directory, 'committed')
  const wrapper = join(directory, 'hold-reply.cjs')
  writeFileSync(wrapper, `
    const send = process.stdout.write.bind(process.stdout);
    process.stdout.write = (line, callback) => {
      const packet = JSON.parse(line);
      if (packet.requestId !== 1 || !packet.ok) return send(line, callback);
      require('node:fs').writeFileSync(${JSON.stringify(barrier)}, 'committed');
      return true;
    };
    require(${JSON.stringify(entry)});
  `)
  const worker = startWorker({ ...config, entry: wrapper })
  try {
    await worker.ready
    const contender = startWorker(config)
    try { await assert.rejects(contender.ready, /Could not set lock/) }
    finally { await contender.close() }
    const pending = assert.rejects(worker.request('applyNoteOperation', [add]), { code: 'outcome-unknown' })
    for (let i = 0; i < 160 && !existsSync(barrier); i++) await sleep(25)
    assert(existsSync(barrier))
    process.kill(worker.pid, 'SIGKILL')
    await pending
    await worker.closed
  } finally { await worker.close().catch(() => {}) }
  const next = startWorker(config)
  try {
    await next.ready
    const receipt = (await next.request('getOperationReceipt', [add.operationId])).value
    assert.equal(receipt.operationId, add.operationId)
    assert.equal((await next.request('getRevision', [add.id, 1])).value.operationId, add.operationId)
    assert.deepEqual((await next.request('applyNoteOperation', [add])).value, receipt)
    assert.equal((await next.request('getRevision', [add.id, 2])).value, null)
    assert.equal((await next.request('getOperationReceipt', [uid(999)])).value, null)
  } finally { await next.close() }
})

fixture('Electron 44.4.3 Main to real Note v1 Worker, including reopen in a new Main', async (_, directory) => {
  const electron = require('electron')
  const isolatedResources = join(directory, 'resources')
  cpSync(resources, isolatedResources, { recursive: true })
  for (const name of ['base-profile', 'note-profile']) mkdirSync(join(directory, name))
  const legacy = join(directory, 'base-profile', 'aisling-reflections.v1.json')
  writeFileSync(legacy, 'fictional base profile, untouched')
  writeFileSync(join(directory, 'synthetic-test'), 'note-v1 smoke')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(name)))
  const runs = []
  for (const phase of ['write', 'reopen']) {
    const result = spawnSync(electron, [join(__dirname, 'memory-note-v1-smoke.cjs')], { cwd: __dirname, windowsHide: true, encoding: 'utf8', timeout: 50000,
      env: { ...env, AISLING_NOTE_TEST_ROOT: directory, AISLING_NOTE_TEST_PHASE: phase,
        AISLING_MEMORY_DB_P0_PROFILE: join(directory, 'note-profile'), AISLING_MEMORY_DB_P0_RESOURCES: isolatedResources } })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    assert.ifError(result.error)
    assert.equal(result.status, 0)
    const record = result.stdout.split(/\r?\n/).find(line => line.startsWith('{"result":"note-v1-passed"'))
    assert(record)
    runs.push(JSON.parse(record))
    assert.match(result.stdout, /"event":"closed"/)
  }
  assert.notEqual(runs[0].workerPid, runs[1].workerPid)
  assert.notEqual(runs[0].mainPid, runs[1].mainPid)
  assert.equal(readFileSync(legacy, 'utf8'), 'fictional base profile, untouched')
})
