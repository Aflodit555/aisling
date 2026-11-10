const assert = require('node:assert/strict')
const { lstatSync, realpathSync } = require('node:fs')
const { dirname, join, relative, isAbsolute } = require('node:path')
const { VERSION, NOTE_V1_FILE, NOTE_V2_FILE, NOTE_V2_RUNTIME_FILE, isNoteV2, schemaForFile, mutates, ProtocolError, lines, decode, encode, validateRequest } = require('./protocol.cjs')
const { openLadybug } = require('./adapter.cjs')

const readOnly = process.argv[2] === '--read-only'
const dbFile = process.argv[readOnly ? 3 : 2]
let ready = false
process.stdout.on('error', () => { /* The write callback handles broken pipes. */ })
const detail = error => ({
  code: typeof error?.code === 'string' ? error.code : 'database-error',
  message: String(error?.message ?? error).slice(0, 1500),
})

async function send(message) {
  const line = encode({ protocolVersion: VERSION, ...message })
  await new Promise((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()))
}

async function run() {
  assert.equal(process.versions.electron, undefined)
  assert.equal(process.versions.node, '24.12.0')
  const schema = schemaForFile(dbFile)
  const expectedFile = schema === 'note-v2-runtime' ? NOTE_V2_RUNTIME_FILE
    : schema === 'note-v2' ? NOTE_V2_FILE : schema === 'note-v1' ? NOTE_V1_FILE : 'memory.lbdb'
  assert(isAbsolute(dbFile) && dbFile === join(realpathSync(dirname(dbFile)), expectedFile))
  assert(!readOnly || schema === 'note-v1')
  if (isNoteV2(schema) || readOnly) {
    const existing = lstatSync(dbFile, { throwIfNoEntry: false })
    assert((!existing && !readOnly) || (existing?.isFile() && existing.nlink === 1), 'Expected an isolated Note v2 test file')
  }
  const entry = realpathSync(require.resolve('@ladybugdb/core'))
  const dependencyDir = join(__dirname, 'node_modules')
  const packagePath = relative(dependencyDir, entry)
  assert(!packagePath.startsWith('..') && !isAbsolute(packagePath), 'Use the packaged LadybugDB dependency')
  const api = require(entry)
  const { VERSION: ladybug, STORAGE_VERSION: storage } = api
  assert.equal(ladybug, '0.22.1')
  const store = openLadybug(api, dbFile, schema, readOnly)
  let closed = false
  let highestId = 0

  try {
    await store.initialize()
    const dependencies = Object.keys(require.cache).filter(file => file.includes('node_modules'))
    assert(dependencies.every(file => !relative(dependencyDir, file).startsWith('..')))
    await send({ event: 'ready', pid: process.pid, node: process.versions.node, modules: process.versions.modules,
      napi: process.versions.napi, arch: process.arch, exe: process.execPath,
      ladybug, storage: String(storage), schema, ...(readOnly && { readOnly: true }) })
    ready = true
    for await (const line of lines(process.stdin)) {
      let requestId = null
      try {
        const request = decode(line)
        if (Number.isSafeInteger(request?.requestId) && request.requestId > 0) requestId = request.requestId
        if (requestId !== null) {
          if (requestId <= highestId) throw new ProtocolError('duplicate-request-id', 'Request ID already used or out of order')
          highestId = requestId
        }
        validateRequest(request, schema)
        const { operation, payload } = request
        if (readOnly && mutates(operation)) throw new ProtocolError('read-only', 'Migration source is read-only')
        const start = performance.now()
        let result = null
        if (operation === 'close') {
          await store.close()
          closed = true
        }
        else if (operation === 'transaction') {
          const [operations] = payload
          await store.transaction(async () => {
            for (const item of operations) await store[item.operation](...item.payload)
          })
        }
        else {
          result = await store[operation](...payload) ?? null
        }
        await send({ requestId, ok: true, result, workerMs: performance.now() - start })
        if (closed) return
      }
      catch (error) {
        await send({ requestId, ok: false, error: detail(error) })
      }
    }
  }
  finally {
    process.stdin.destroy()
    if (!closed) {
      try { await store.close() }
      catch (error) { console.error('cleanup:', error) }
    }
  }
}

run().catch(async error => {
  console.error(error)
  process.exitCode = 1
  if (!ready) await send({ event: 'startup-error', error: detail(error) }).catch(() => {})
})
