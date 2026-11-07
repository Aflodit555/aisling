const { startWorker } = require('./client.cjs')
const { ProtocolError } = require('./protocol.cjs')

/**
 * @param {() => Promise<{ node: string, entry: string, file: string }>} resolveWorker
 * @param {(event: string, detail: any) => void} report
 * @returns {import('./store').MemoryDatabaseStore}
 */
function createMemoryDatabaseStore(resolveWorker, report) {
  /** @type {ReturnType<import('./store').MemoryDatabaseStore['status']>} */
  let state = 'closed'
  /** @type {ReturnType<typeof startWorker> | undefined} */
  let worker
  /** @type {Promise<void> | undefined} */
  let opening, closing
  const emit = (event, detail) => {
    try { report(event, detail) }
    catch { /* Diagnostics cannot change database state. */ }
  }

  function open() {
    if (closing) return Promise.reject(new ProtocolError('worker-closing', 'Memory database is closing'))
    if (opening) return opening
    if (state === 'ready') return Promise.resolve()
    state = 'opening'
    opening = (async () => {
      try {
        const config = await resolveWorker()
        if (state !== 'opening') throw new ProtocolError('worker-closing', 'Memory database is closing')
        const child = worker = startWorker(config)
        void child.closed.then(exit => {
          if (worker === child) {
            worker = undefined
            if (state !== 'closing') state = 'failed'
          }
          emit('exit', { pid: child.pid, ...exit })
        })
        const info = await child.ready
        if (state !== 'opening' || worker !== child)
          throw new ProtocolError('worker-unavailable', 'Memory database stopped during startup')
        state = 'ready'
        emit('ready', info)
      }
      catch (error) {
        if (state === 'opening') state = 'failed'
        if (worker) await worker.close().catch(() => {})
        throw error
      }
      finally { opening = undefined }
    })()
    return opening
  }

  function close() {
    if (closing) return closing
    state = 'closing'
    closing = (async () => {
      try {
        if (worker) await worker.close()
      }
      finally { state = 'closed' }
    })().finally(() => { closing = undefined })
    return closing
  }

  async function request(operation, payload) {
    if (state !== 'ready' || !worker) throw new ProtocolError('worker-unavailable', 'Memory database is not ready')
    const { value, ms, workerMs } = await worker.request(operation, payload, operation==='eraseSources'?45000:5000)
    emit('timing', { operation, roundTripMs: ms, workerMs })
    return value
  }

  return {
    open, close, status: () => state,
    async createNote(note) { await request('insertNote', [note]) },
    getNote: id => request('getNote', [id]),
    async addOrigin(id, origin) { await request('addOrigin', [id, origin]) },
    getOrigins: id => request('getOrigins', [id]),
    async addEvidence(id, evidence) { await request('addEvidence', [id, evidence]) },
    getEvidence: id => request('getEvidence', [id]),
    applyNoteOperation: operation => request('applyNoteOperation', [operation]),
    eraseSources: scope => request('eraseSources',[scope]),
    erasedNoteIds: (id,afterId='') => request('erasedNoteIds',[id,afterId]),
    listMemorySources: (kind,after='') => request('listMemorySources',[kind,after]),
    installErasureBarriers: keys => request('installErasureBarriers',[keys]),
    getOperationReceipt: operationId => request('getOperationReceipt', [operationId]),
    getNoteV1: id => request('getNoteV1', [id]),
    listNoteHeads: (afterId = '') => request('listNoteHeads', [afterId]),
    getRevision: (id, version) => request('getRevision', [id, version]),
    getVersionSourceChanges: (id, version, afterId = '') => request('getVersionSourceChanges', [id, version, afterId]),
    async linkNotes(from, to) { await request('relate', [from, to]) },
    getRelatedNotes(id, depth) {
      if (depth !== 1 && depth !== 2) return Promise.reject(new ProtocolError('invalid-depth', 'Expected exactly one or two outgoing hops'))
      return request(depth === 1 ? 'outgoingOne' : 'outgoingTwo', [id])
    },
    async transaction(writes) {
      const operations = writes.map(write => {
        switch (write.type) {
          case 'createNote': return { operation: 'insertNote', payload: [write.note] }
          case 'addOrigin': return { operation: 'addOrigin', payload: [write.noteId, write.origin] }
          case 'addEvidence': return { operation: 'addEvidence', payload: [write.noteId, write.evidence] }
          case 'linkNotes': return { operation: 'relate', payload: [write.from, write.to] }
          default: throw new ProtocolError('invalid-write', 'Expected a supported database write')
        }
      })
      await request('transaction', [operations])
    },
  }
}

module.exports = { createMemoryDatabaseStore }
