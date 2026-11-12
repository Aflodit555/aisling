/// <reference lib="es2024.promise" />
const { spawn } = require('node:child_process')
const { closeSync, openSync, readFileSync, unlinkSync, existsSync } = require('node:fs')
const { basename, dirname, isAbsolute, join, relative, resolve } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { VERSION, schemaForFile, MAX_PENDING, ProtocolError, lines, decode, encode, mutates } = require('./protocol.cjs')

const localWorkerResources = resolve(__dirname, '../../../.local/memory-database')
const resourceFiles = ['worker.cjs', 'adapter.cjs', 'protocol.cjs', 'note-v1.cjs', 'erasure.cjs', 'package.json', 'package-lock.json']

function assertPreparedWorkerSource(resources) {
  const pins = [['libssl-3-x64.dll','e028a7f4fc1e4e197dfae99f7df5e14f57fb7e0282d03e903521fc99c0c76d89'],['libcrypto-3-x64.dll','3b65cfd779e238a2947a0aa8911cc67aaef866977af6a69b4d39e7d587ebf262']]
  if (pins.some(([file])=>existsSync(join(resources,'runtime',file)))) for (const [file,hash] of pins)
    if (require('node:crypto').createHash('sha256').update(readFileSync(join(resources,'runtime',file))).digest('hex') !== hash)
      throw new ProtocolError('stale-worker-resources','OpenSSL resource integrity failed')
  for (const file of resourceFiles) {
    const prepared = readFileSync(join(resources, file))
    if (!prepared.equals(readFileSync(join(__dirname, file))))
      throw new ProtocolError('stale-worker-resources', `Refresh .local/memory-database with scripts/prepare-memory-database.ps1 (${file} differs)`)
  }
}

function withPreparedLocalWorker(entry, launch) {
  if (relative(localWorkerResources, dirname(entry)) !== '') return launch()
  const lock = localWorkerResources + '.update.lock'
  let handle
  try { handle = openSync(lock, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST')
      throw new ProtocolError('worker-resources-locked', 'Local Worker resources are being prepared or another Worker is starting')
    throw error
  }
  try {
    assertPreparedWorkerSource(localWorkerResources)
    return launch()
  } finally {
    closeSync(handle)
    unlinkSync(lock)
  }
}

/** @param {{node: string, entry: string, file: string, startupMs?: number, readOnly?: boolean}} config */
function startWorker({ node, entry, file, startupMs = 15000, readOnly = false }) {
  if (!isAbsolute(node) || basename(node).toLowerCase() !== 'node.exe' || !isAbsolute(entry))
    throw new Error('Expected absolute paths to independent node.exe and worker entry')
  const started = performance.now()
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const child = withPreparedLocalWorker(entry, () => spawn(node, ['--no-global-search-paths', entry, ...(readOnly ? ['--read-only'] : []), file], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    cwd: dirname(entry),
    env: { SystemRoot: systemRoot, Path: join(systemRoot, 'System32') },
  }))
  const pending = new Map()
  const ready = Promise.withResolvers()
  const closed = Promise.withResolvers()
  let readySeen = false
  let stopped
  let closing = false
  let closingPromise
  let lastId = 0
  const startup = setTimeout(() => stop(new ProtocolError('startup-timeout', 'Worker did not become ready')), startupMs)

  function stop(error, kill = true, timedOutId = undefined) {
    if (stopped) return
    stopped = error
    clearTimeout(startup)
    ready.reject(error)
    for (const [id, job] of pending) {
      clearTimeout(job.timer)
      job.reject(mutates(job.operation)
        ? new ProtocolError('outcome-unknown', 'Write may have committed. Query by ID after recovery.', error.code)
        : id === timedOutId ? error : new ProtocolError('worker-stopped', error.message, error.code))
    }
    pending.clear()
    if (kill) child.kill('SIGKILL')
  }

  child.on('error', error => stop(new ProtocolError('spawn-failed', error.message, /** @type {NodeJS.ErrnoException} */ (error).code)))
  child.stdin.on('error', error => stop(new ProtocolError('pipe-error', error.message, /** @type {NodeJS.ErrnoException} */ (error).code)))
  child.on('close', (code, signal) => {
    if (!closing || pending.size || code !== 0)
      stop(new ProtocolError(readySeen ? 'worker-exit' : 'startup-exit', `Worker exited (${code ?? signal})`), false)
    closed.resolve({ code, signal })
  })
  child.stderr.on('data', chunk => process.stderr.write(chunk))

  async function readReplies() {
    for await (const line of lines(child.stdout)) {
      const response = decode(line)
      if (response?.protocolVersion !== VERSION) throw new ProtocolError('protocol-version', 'Invalid worker protocol')
      if (response.event === 'ready' && !readySeen && response.pid === child.pid) {
        if (response.node !== '24.12.0' || response.arch !== 'x64' || response.ladybug !== '0.22.1'
          || typeof response.exe !== 'string' || response.exe.toLowerCase() !== node.toLowerCase())
          throw new ProtocolError('unexpected-runtime', 'Worker did not report the pinned Node and LadybugDB runtime')
        const expectedSchema = schemaForFile(file)
        if ((response.schema ?? 'p0') !== expectedSchema || readOnly && response.readOnly !== true)
          throw new ProtocolError('unexpected-schema', 'Worker reported an incompatible database schema')
        readySeen = true
        clearTimeout(startup)
        ready.resolve({ ...response, startupMs: performance.now() - started })
        continue
      }
      if (response.event === 'startup-error' && !readySeen) {
        stop(new ProtocolError('startup-error', response.error.message, response.error.code), false)
        continue
      }
      const job = pending.get(response.requestId)
      if (!job) throw new ProtocolError('unexpected-response', 'Response has no matching pending request')
      if (typeof response.ok !== 'boolean' || (response.ok ? !Object.hasOwn(response, 'result') : !response.error))
        throw new ProtocolError('invalid-response', 'Malformed worker response')
      clearTimeout(job.timer)
      pending.delete(response.requestId)
      if (response.ok) job.resolve({ value: response.result, workerMs: response.workerMs, ms: performance.now() - job.start })
      else job.reject(new ProtocolError(response.error.code, response.error.message))
    }
  }
  readReplies().catch(error => stop(error))

  function request(operation, payload = [], timeoutMs = 5000) {
    if (closing) return Promise.reject(new ProtocolError('worker-unavailable', 'Worker is closing'))
    return send(operation, payload, timeoutMs)
  }

  function send(operation, payload, timeoutMs) {
    if (stopped || !readySeen) return Promise.reject(stopped ?? new ProtocolError('worker-unavailable', 'Worker is not available'))
    if (operation !== 'close' && pending.size >= MAX_PENDING) return Promise.reject(new ProtocolError('queue-full', 'Worker queue is full'))
    const requestId = ++lastId
    let line
    try { line = encode({ protocolVersion: VERSION, requestId, operation, payload }) }
    catch (error) { return Promise.reject(error) }
    return new Promise((resolve, reject) => {
      const start = performance.now()
      const timer = setTimeout(() => stop(new ProtocolError('request-timeout', `Request ${requestId} timed out`), true, requestId), timeoutMs)
      pending.set(requestId, { resolve, reject, operation, start, timer })
      child.stdin.write(line)
    })
  }

  async function closeWorker() {
    let failure
    closing = true
    try { if (!stopped && readySeen) await send('close', [], 3000) }
    catch (error) { failure = error }
    child.stdin.end()
    const exit = await Promise.race([closed.promise, delay(3500, null, { ref: false })])
    if (exit === null) {
      child.kill('SIGKILL')
      await Promise.race([closed.promise, delay(1000, null, { ref: false })])
      throw new ProtocolError('shutdown-timeout', 'Worker did not exit after closing the pipe')
    }
    if (failure) throw failure
    return exit
  }
  return { ready: ready.promise, closed: closed.promise, request,
    close: () => closingPromise ??= closeWorker(), pid: child.pid }
}

module.exports = { startWorker, localWorkerResources, assertPreparedWorkerSource }
