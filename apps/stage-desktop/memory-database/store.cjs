const { startWorker } = require('./client.cjs')
const { ProtocolError, isNoteV2, schemaForFile } = require('./protocol.cjs')
const { validNoteV2Operation, validRuntimeOperation, validRelationOperation, operationFingerprint, needsMultipleSources } = require('./note-v1.cjs')
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

  async function eligibleHead(id, historical = false) {
    const note = await request('getNoteV2', [id])
    if (!note || (historical ? note.status === 'retracted' : note.status !== 'active') || authority.isSubjectConfirmed(note.subject) !== true) return null
    const revision = await request('getRevision', [id, note.version])
    const refs = await evidenceFor(id)
    const lookup = sourceMessageLookup(authority.readData())
    const linked = new Set(refs.map(sourceKey))
    return revision?.grounds.evidence.length && revision.grounds.evidence.every(ref => linked.has(sourceKey(ref)))
      && refs.every(ref => !!lookup(ref)?.content.trim()) && hasRequiredReports(note, revision.grounds.evidence.map(lookup))
      ? { note, grounds: revision.grounds, cumulativeEvidence: refs } : null
  }

  return {
    ...connection,
    getEmbedding: id => request('getEmbedding', [id]),
    getEmbeddingHead: id => serial(() => eligibleHead(id, true)),
    listEmbeddingHeads(afterId = '') {
      return serial(async () => {
        const page = await request('listNoteHeads', [afterId]), notes = []
        for (const head of page.notes) { const valid = await eligibleHead(head.note.id, true); if (valid) notes.push(valid) }
        return { notes, nextCursor: page.nextCursor }
      })
    },
    putEmbedding(value) {
      return serial(async () => {
        const head = await eligibleHead(value.noteId, true)
        if (!head || head.note.version !== value.noteVersion) throw new ProtocolError('stale-version', 'Embedding source changed')
        const expected = require('../note-embedding.cjs').embeddingIdentity(head.note, { modelId: value.modelId })
        if (value.contentHash !== expected.contentHash || value.projectionVersion !== expected.projectionVersion)
          throw new ProtocolError('invalid-evidence', 'Embedding projection changed')
        return request('putEmbedding', [value])
      })
    },
    searchEmbeddings: value => request('searchEmbeddings', [value]),
    getNoteV2: id => request('getNoteV2', [id]),
    listNoteHeads: (afterId = '') => request('listNoteHeads', [afterId]),
    listMemorySources: (kind, after = '') => request('listMemorySources', [kind, after]),
    installErasureBarriers: keys => serial(() => request('installErasureBarriers', [keys])),
    getRevision: (id, version) => request('getRevision', [id, version]),
    getOperationReceipt: id => request('getOperationReceipt', [id]),
    getVersionSourceChanges: (id, version, afterId = '') => request('getVersionSourceChanges', [id, version, afterId]),
    listNoteRelations: (id, afterKey = '') => request('listNoteRelations', [id, afterKey, false]),
    getRecallHistory(id) {
      return serial(async () => {
        const current = await eligibleHead(id)
        if (!current) return null
        let noteId = id, version = current.note.version - 1
        if (version < 1) {
          const revision = await request('getRevision', [id, 1])
          if (revision.action !== 'SUPERSEDE') return null
          const receipt = await request('getOperationReceipt', [revision.operationId])
          const predecessor = receipt?.affectedNotes.find(note => note.id !== id)
          if (!predecessor) return null
          const terminal = await request('getRevision', [predecessor.id, predecessor.version])
          if (terminal?.successorId !== id) return null
          noteId = predecessor.id; version = predecessor.version - 1
        }
        if (version < 1) return null
        const revision = await request('getRevision', [noteId, version])
        if (!revision || revision.snapshot.status === 'retracted' || revision.snapshot.subject !== current.note.subject) return null
        const refs = await evidenceFor(noteId), lookup = sourceMessageLookup(authority.readData())
        const linked = new Set(refs.map(sourceKey))
        return revision.grounds.evidence.length && revision.grounds.evidence.every(ref => linked.has(sourceKey(ref)))
          && refs.every(ref => !!lookup(ref)?.content.trim()) && hasRequiredReports(revision.snapshot, revision.grounds.evidence.map(lookup))
          ? revision : null
      })
    },
    listRecallRelations(id, afterKey = '') {
      return serial(async () => {
        const page = await request('listNoteRelations', [id, afterKey, true])
        const relations = []
        for (const relation of page.relations) {
          if (relation.status !== 'active') continue
          const from = await eligibleHead(relation.from), to = await eligibleHead(relation.to)
          if (from?.note.version === relation.fromVersion && to?.note.version === relation.toVersion
            && relation.sources.evidence.every(sourceMessageLookup(authority.readData()))) relations.push(relation)
        }
        return { relations, nextCursor: page.nextCursor }
      })
    },
    applyRelationOperation(operation) {
      const input = structuredClone(operation)
      return serial(async () => {
        if (!validRelationOperation(input)) throw new ProtocolError('invalid-payload', 'Invalid relation operation')
        const prior = await request('getOperationReceipt', [input.operationId])
        if (prior) {
          if (prior.fingerprint !== operationFingerprint(input))
            throw new ProtocolError('operation-id-conflict', 'Relation operation ID conflict')
          return prior
        }
        const from = await eligibleHead(input.from), to = await eligibleHead(input.to)
        if (!from || !to) throw new ProtocolError('invalid-endpoint', 'Relation requires eligible endpoints')
        if (!input.sources.evidence.every(sourceMessageLookup(authority.readData())))
          throw new ProtocolError('invalid-evidence', 'Relation source changed')
        return request('applyRelationOperation', [input])
      })
    },
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
