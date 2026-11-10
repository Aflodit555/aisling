const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { copyFileSync, mkdirSync, mkdtempSync, existsSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { createInterface } = require('node:readline')
const { startWorker, assertPreparedWorkerSource } = require('./memory-database/client.cjs')
const { MAX_FRAME, VERSION } = require('./memory-database/protocol.cjs')
const { attachMemoryDatabase } = require('./memory-database/host.cjs')
const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const node = resources && join(resources, 'runtime', 'node.exe')
const entry = resources && join(resources, 'worker.cjs')
const root = resolve(__dirname, '../../artifacts/memory-db-p0')
function folder() {
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, 'lifecycle-'))
}
const note = { id: 'commit-lost-reply', content: '虚构记录', createdAt: 1793100020000 }
const code = expected => ({ code: expected })
const waitFor = async check => {
  for (let index = 0; index < 150 && !check(); index++) await sleep(25)
  assert(check(), 'Expected fixture barrier')
}
function fixture(name, fn) {
  test(name, { skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to prepared resources', timeout: 20000 }, fn)
}

test('default development Worker resources must match the checked-out Worker sources', () => {
  const prepared = folder()
  for (const file of ['worker.cjs', 'adapter.cjs', 'protocol.cjs', 'note-v1.cjs', 'erasure.cjs', 'package.json', 'package-lock.json'])
    copyFileSync(join(__dirname, 'memory-database', file), join(prepared, file))
  assert.doesNotThrow(() => assertPreparedWorkerSource(prepared))
  writeFileSync(join(prepared, 'erasure.cjs'), '// Older erasure implementation with the same protocol version')
  assert.throws(() => assertPreparedWorkerSource(prepared), { code: 'stale-worker-resources', message: /erasure\.cjs differs/ })
})

test('P0 refuses the existing profile and unmarked nonempty profiles', () => {
  const normal = folder()
  const other = folder()
  const legacy = join(other, 'aisling-store.json')
  writeFileSync(legacy, 'existing data')
  const app = { getPath: () => normal, setPath: () => assert.fail('must not redirect to an unsafe profile') }
  const previous = process.env.AISLING_MEMORY_DB_P0_PROFILE
  try {
    process.env.AISLING_MEMORY_DB_P0_PROFILE = normal
    assert.throws(() => attachMemoryDatabase(app), /overlaps/)
    process.env.AISLING_MEMORY_DB_P0_PROFILE = other
    assert.throws(() => attachMemoryDatabase(app), /empty on first use/)
  }
  finally {
    if (previous === undefined) delete process.env.AISLING_MEMORY_DB_P0_PROFILE
    else process.env.AISLING_MEMORY_DB_P0_PROFILE = previous
  }
})

test('closing during resource resolution does not wait for it or spawn a Worker later', async () => {
  const config = Promise.withResolvers()
  const store = createMemoryDatabaseStore(() => config.promise, () => {})
  const opening = assert.rejects(store.open(), code('worker-closing'))
  await store.close()
  config.resolve({ node: 'must-not-spawn' })
  await opening
  assert.equal(store.status(), 'closed')
})

fixture('Ready, writer lock, close acknowledgement, reopening and startup timeout', async () => {
  const directory = folder()
  const file = join(directory, 'memory.lbdb')
  const primary = startWorker({ node, entry, file })
  try {
    assert.equal((await primary.ready).ladybug, '0.22.1')
    const contender = startWorker({ node, entry, file })
    await assert.rejects(contender.ready, /Could not set lock/)
    assert.deepEqual(await contender.close(), { code: 1, signal: null })
    const missing = startWorker({ node: join(directory, 'missing', 'node.exe'), entry, file })
    await assert.rejects(missing.ready, code('spawn-failed'))
    await missing.close()
    const stalled = join(directory, 'stalled.cjs')
    writeFileSync(stalled, 'setInterval(() => {}, 1000)')
    const startup = startWorker({ node, entry: stalled, file, startupMs: 150 })
    await assert.rejects(startup.ready, code('startup-timeout'))
    assert.equal((await startup.close()).signal, 'SIGKILL')
  }
  finally { assert.deepEqual(await primary.close(), { code: 0, signal: null }) }
  const next = startWorker({ node, entry, file })
  try { await next.ready; assert.equal((await next.request('getNote', [note.id])).value, null) }
  finally { assert.deepEqual(await next.close(), { code: 0, signal: null }) }
})

fixture('protocol rejects invalid frames, repeated IDs and arbitrary Cypher', async () => {
  const file = join(folder(), 'memory.lbdb')
  const child = spawn(node, ['--no-global-search-paths', entry, file], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
  const closed = once(child, 'close')
  const reader = createInterface({ input: child.stdout })
  const packets = reader[Symbol.asyncIterator]()
  const receive = async () => JSON.parse((await packets.next()).value)
  const packet = (id, operation, payload) => JSON.stringify({ protocolVersion: VERSION, requestId: id, operation, payload })
  try {
    assert.equal((await receive()).event, 'ready')
    child.stdin.end(['{broken', 'x'.repeat(MAX_FRAME + 1), packet(1, 'getNote', ['missing']),
      packet(1, 'getNote', ['missing']), packet(2, 'cypher', ['MATCH (n) RETURN n']), packet(3, 'close', []), ''].join('\n'))
    assert.equal((await receive()).error.code, 'invalid-json')
    assert.equal((await receive()).error.code, 'frame-too-large')
    assert.equal((await receive()).result, null)
    assert.equal((await receive()).error.code, 'duplicate-request-id')
    assert.equal((await receive()).error.code, 'unknown-operation')
    assert.equal((await receive()).ok, true)
    assert.deepEqual(await closed, [0, null])
  }
  finally { if (child.exitCode === null) child.kill(); reader.close() }
})

for (const fault of ['kill', 'timeout', 'quit']) fixture(`committed write with lost reply: ${fault}, then reopen without replay`, async () => {
  const directory = folder()
  const file = join(directory, 'memory.lbdb')
  const barrier = join(directory, 'committed')
  const wrapper = join(directory, 'hold-reply.cjs')
  // Fault injection exists in this fixture only. The real Worker handles and commits the write.
  writeFileSync(wrapper, `
    const send = process.stdout.write.bind(process.stdout)
    process.stdout.write = (line, callback) => {
      const packet = JSON.parse(line)
      if (packet.requestId !== 1 || !packet.ok) return send(line, callback)
      require('node:fs').writeFileSync(${JSON.stringify(barrier)}, 'committed')
      setInterval(() => {}, 1000)
      return true
    }
    require(${JSON.stringify(entry)})
  `)
  const worker = startWorker({ node, entry: wrapper, file })
  try {
    await worker.ready
    const pending = Promise.allSettled([
      worker.request('insertNote', [note]),
      worker.request('getNote', [note.id], fault === 'timeout' ? 1000 : 5000),
      worker.request('insertNote', [{ ...note, id: 'queued-write' }]),
    ])
    await waitFor(() => existsSync(barrier))
    if (fault === 'kill') assert.equal(process.kill(worker.pid, 'SIGKILL'), true)
    if (fault === 'quit') await assert.rejects(worker.close(), code('request-timeout'))
    const results = await pending
    assert.deepEqual(results.map(result => result.status === 'rejected' ? result.reason.code : 'resolved'),
      ['outcome-unknown', fault === 'timeout' ? 'request-timeout' : 'worker-stopped', 'outcome-unknown'])
    assert.notDeepEqual(await worker.closed, { code: 0, signal: null })
  }
  finally { await worker.close().catch(() => {}) }
  const next = startWorker({ node, entry, file })
  try {
    await next.ready
    assert.deepEqual((await next.request('getNote', [note.id])).value, note)
    assert.equal((await next.request('getNote', ['queued-write'])).value, null)
  }
  finally { assert.deepEqual(await next.close(), { code: 0, signal: null }) }
})
