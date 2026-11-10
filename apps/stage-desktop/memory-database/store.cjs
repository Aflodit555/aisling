const { startWorker } = require('./client.cjs')
const { ProtocolError, isNoteV2, schemaForFile } = require('./protocol.cjs')
const { validNoteV2Operation, validRuntimeOperation, needsMultipleSources } = require('./note-v1.cjs')
const { sourceKey } = require('./erasure.cjs')
const { sourceMessageLookup } = require('../memory-evidence.cjs')

/**
 * @param {() => Promise<{ node: string, entry: string, file: string, readOnly?: boolean }>} resolveWorker
 * @param {(event: string, detail: any) => void} report
 */
function connectMemoryDatabase(resolveWorker, report, noteV2 = false) {
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
        if (isNoteV2(schemaForFile(config.file)) !== noteV2)
          throw new ProtocolError('unexpected-schema', noteV2 ? 'Note v2 requires a versioned v2 database' : 'Note v2 requires the verified Note store')
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

  return { open, close, status: () => state, request }
}

/**
 * @param {Parameters<typeof connectMemoryDatabase>[0]} resolveWorker
 * @param {Parameters<typeof connectMemoryDatabase>[1]} report
 * @returns {import('./store').MemoryDatabaseStore}
 */
function createMemoryDatabaseStore(resolveWorker, report) {
  const { request, ...connection } = connectMemoryDatabase(resolveWorker, report)
  return {
    ...connection,
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
    listNoteEvidence: (id, after = '') => request('listNoteEvidence', [id, after]),
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

/**
 * @param {Parameters<typeof connectMemoryDatabase>[0]} resolveWorker
 * @param {Parameters<typeof connectMemoryDatabase>[1]} report
 * @param {import('./store').NoteV2Authority} authority
 * @returns {import('./store').NoteV2Store}
 */
function createNoteV2Store(resolveWorker, report, authority) {
  const { request, ...connection } = connectMemoryDatabase(resolveWorker, report, true)
  let tail = Promise.resolve()

  /** @template T @param {() => Promise<T>} work */
  function serial(work) {
    const result = tail.then(work)
    tail = result.then(() => {}, () => {})
    return result
  }

  // shortcut: page all historical evidence per candidate, measure before enabling production Recall.
  async function evidenceFor(noteId) {
    const refs = []
    let cursor = ''
    do {
      const page = await request('listNoteEvidence', [noteId, cursor])
      refs.push(...page.evidence)
      cursor = page.nextCursor
    } while (cursor)
    return refs
  }

  function hasRequiredReports(meaning, messages) {
    const users = new Set(messages.filter(message => message.role === 'user')
      .map(message => message.content.normalize('NFKC').trim()))
    const minimum = needsMultipleSources(meaning) ? 2 : ['fact', 'preference', 'project-state'].includes(meaning.kind) ? 1 : 0
    return users.size >= minimum
  }

  return {
    ...connection,
    getNoteV2: id => request('getNoteV2', [id]),
    listNoteHeads: (afterId = '') => request('listNoteHeads', [afterId]),
    listMemorySources: (kind, after = '') => request('listMemorySources', [kind, after]),
    installErasureBarriers: keys => serial(() => request('installErasureBarriers', [keys])),
    getRevision: (id, version) => request('getRevision', [id, version]),
    getOperationReceipt: id => request('getOperationReceipt', [id]),
    getVersionSourceChanges: (id, version, afterId = '') => request('getVersionSourceChanges', [id, version, afterId]),
    erasedNoteIds: (id, afterId = '') => request('erasedNoteIds', [id, afterId]),
    eraseSources(scope) {
      const input = structuredClone(scope)
      return serial(() => request('eraseSources', [input]))
    },
    applyNoteOperation(operation) {
      const input = structuredClone(operation)
      return serial(async () => {
        const context = 'contextEvidence' in input ? input.contextEvidence : undefined
        const valid = context === undefined ? validNoteV2Operation(input) : validRuntimeOperation(input)
        if (!valid) throw new ProtocolError('invalid-payload', 'Invalid Note v2 operation')
        const target = input.action === 'ADD' ? null : await request('getNoteV2', [input.id])
        if (input.action !== 'ADD' && !target) throw new ProtocolError('note-missing', 'Note does not exist')
        const meaning = 'meaning' in input ? input.meaning : undefined
        if (authority.isSubjectConfirmed(meaning?.subject ?? target.subject) !== true)
          throw new ProtocolError('subject-unconfirmed', 'Note subject requires trusted confirmation')

        const prior = target && input.action !== 'RETRACT' ? await evidenceFor(input.id) : []
        const lookup = sourceMessageLookup(authority.readData())
        const sources = input.sources.evidence.map(lookup)
        if (sources.some(message => !message?.content.trim()) || [...prior, ...(context ?? [])].some(ref => !lookup(ref)?.content.trim()))
          throw new ProtocolError('invalid-evidence', 'Original message is missing, ineligible or changed')
        if (meaning && !hasRequiredReports(meaning, sources))
          throw new ProtocolError('insufficient-evidence', 'Note requires distinct user reports')
        return request('applyNoteOperation', [input])
      })
    },
    listRecallHeads(afterId = '') {
      return serial(async () => {
        const page = await request('listNoteHeads', [afterId])
        const candidates = []
        for (const head of page.notes) {
          if (head.note.status === 'active') candidates.push({ head, refs: await evidenceFor(head.note.id) })
        }
        const lookup = sourceMessageLookup(authority.readData())
        const notes = candidates.filter(({ head, refs }) => {
          const linked = new Set(refs.map(sourceKey))
          const grounds = head.grounds.evidence
          return authority.isSubjectConfirmed(head.note.subject) === true
            && grounds.length && grounds.every(ref => linked.has(sourceKey(ref)))
            && refs.every(ref => !!lookup(ref)?.content.trim())
            && hasRequiredReports(head.note, grounds.map(lookup))
        }).map(({ head, refs }) => ({ ...head, cumulativeEvidence: refs }))
        return { notes, nextCursor: page.nextCursor }
      })
    },
  }
}

module.exports = { createMemoryDatabaseStore, createNoteV2Store }
