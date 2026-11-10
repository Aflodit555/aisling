const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { validNoteV2Operation, validRuntimeOperation, MAX_CONTEXT_EVIDENCE, operationFingerprint } = require('./memory-database/note-v1.cjs')
const { messageDigest, readConversationSessions, sourceMessageLookup } = require('./memory-evidence.cjs')
const { hash, sourceKey } = require('./memory-database/erasure.cjs')
const { createMemoryLifecycle } = require('./memory-lifecycle.cjs')
const { formationInput, parseNoteProposals, limits } = require('./note-formation-contract.mjs')
const { rankNoteHeads, safeText } = require('./memory-text.mjs')
const speakers = require('./memory-subjects.json')
const { databasePath, migratedJournal, readMigration, assertMemoryAuthority } = require('./memory-authority.cjs')


const id = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
const evidenceRef = ref => ref && Object.keys(ref).sort().join(',') === 'digest,messageIndex,sessionId'
  && id(ref.sessionId) && Number.isSafeInteger(ref.messageIndex) && ref.messageIndex >= 0
  && typeof ref.digest === 'string' && /^[a-f0-9]{64}$/.test(ref.digest)
const knownErrors = new Set(['invalid-json', 'input-limit', 'invalid-proposal', 'provider-error', 'timeout', 'cancelled', 'source-changed'])
const confirmed = subject => Object.values(speakers).some(speaker => speaker.subject === subject)

function check(value, code) {
  if (!value) throw new Error(code)
}



/** Main-only authorization. Without an explicitly trusted policy, proposals await review. */
function createNoteFormationService({ profile, resources, readData: readRawData, writeData, consent,
  authorize = (_proposal, _command) => false, recallConsent = consent, reviewConsent = consent, archive = undefined,
  report = (_event, _detail) => {} }) {
  assertMemoryAuthority(profile, true)
  check(!!archive === !!readMigration(profile), 'migration-archive-required')
  check(path.isAbsolute(resources), 'absolute-worker-resources-required')
  const dbFile = databasePath(profile)
  const directory = path.dirname(dbFile)
  fs.mkdirSync(directory, { recursive: true })
  check(fs.realpathSync(directory) === directory, 'canonical-note-v2-directory-required')
  let workerEpoch = 0, recallVersion = randomUUID()
  const store = createNoteV2Store(async () => {
    const root = fs.realpathSync(resources)
    const node = path.join(root, 'runtime', 'node.exe')
    const entry = path.join(root, 'worker.cjs')
    check(fs.realpathSync(node) === node && fs.realpathSync(entry) === entry, 'canonical-worker-resources-required')
    return { node, entry, file: dbFile }
  }, event => {
    if (event === 'ready') workerEpoch++
    if (event === 'ready' || event === 'exit') recallVersion = randomUUID()
  }, { readData, isSubjectConfirmed: confirmed })
  const file = path.join(profile, 'note-formation-jobs.v1.json')
  let state = { version: 1, progress: {}, batches: [] }
  try {
    const raw = fs.readFileSync(file, 'utf8')
    check(Buffer.byteLength(raw) <= 2_000_000, 'formation-job-limit')
    const stored = JSON.parse(raw)
    check(stored.version === 1 && stored.progress && Array.isArray(stored.batches), 'invalid-formation-jobs')
    state = stored
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  function update(change) {
    const next = structuredClone(state)
    change(next)
    const raw = JSON.stringify(next)
    check(Buffer.byteLength(raw) <= 2_000_000, 'formation-job-limit')
    const temp = file + '.tmp'
    fs.writeFileSync(temp, raw, { flush: true })
    fs.renameSync(temp, file)
    state = next
  }

  if (state.batches.some(batch => batch.status === 'running' || batch.status === 'collecting')) update(next => {
    for (const batch of next.batches) {
      if (batch.status === 'running') { batch.status = 'failed'; batch.error = 'interrupted'; delete batch.prepared }
      if (batch.status === 'collecting') batch.status = 'pending'
    }
  })

  let serial = Promise.resolve()
  let closing = false, synchronized = -1
  let snapshotRead, publishedRecall
  /** @template T @param {() => T | Promise<T>} work @returns {Promise<T>} */
  function queue(work) {
    const result = serial.then(work)
    serial = result.then(() => {}, () => {})
    return result
  }

  const privacy = createMemoryLifecycle({
    profile, store, readData: readRawData, writeData, hasDatabase: () => fs.existsSync(dbFile),
    ...(archive && { archive, journalName: migratedJournal }),
    pruneJobs(data, erasedIds) {
      const lookup = sourceMessageLookup(data)
      const erased = new Set(erasedIds)
      const keep = state.batches.filter(batch => {
        const candidates = batch.prepared?.candidates ?? []
        return batch.evidence.every(lookup) && (batch.prepared?.refs ?? []).every(lookup)
          && candidates.every(candidate => !erased.has(candidate.id) && candidate.evidence.every(lookup))
          && (batch.items ?? []).every(item => !erased.has(item.noteId) && !(item.result ?? []).some(note => erased.has(note.id)))
      })
      if (keep.length !== state.batches.length) update(next => { next.batches = keep })
    },
    invalidate(reason) {
      recallVersion = randomUUID()
      if (reason === 'intent' && !closing && !privacy.isRecovering())
        void queue(ready).catch(error => report('erasure-pending', error))
    },
  })

  function readData() {
    privacy.assertReadable()
    return privacy.sanitizedData(readRawData())
  }

  async function ready() {
    check(!closing, 'formation-closing')
    privacy.readJournal()
    try {
      await store.open()
      if (synchronized !== workerEpoch) {
        await privacy.synchronizeBarriers()
        synchronized = workerEpoch
      }
      await privacy.recover(workerEpoch)
      privacy.assertReadable()
    } catch (error) {
      await store.close().catch(closeError => report('worker-close-failed', closeError))
      throw error
    }
  }

  function current(batchId, attempt) {
    const batch = state.batches.find(row => row.id === batchId)
    check(consent() && batch?.status === 'running' && batch.attempts === attempt, 'stale-formation-attempt')
    return batch
  }

  function editBatch(batchId, change) {
    update(next => change(next.batches.find(batch => batch.id === batchId)))
  }

  function evidenceFor(refs, currentCount, lookup) {
    return refs.map((ref, i) => {
      const message = lookup(ref)
      check(message && safeText(message.content), 'source-changed')
      return { ref, message, scope: i < currentCount ? 'current' : 'history' }
    })
  }

  async function reconstruct(batch) {
    const { refs, candidates } = batch.prepared
    const notes = []
    const dependencies = [...refs]
    for (const candidate of candidates) {
      const revision = await store.getRevision(candidate.id, candidate.version)
      check(revision?.snapshot.status === 'active', 'source-changed')
      notes.push(revision.snapshot)
      dependencies.push(...candidate.evidence)
    }
    const lookup = sourceMessageLookup(readData())
    check(dependencies.every(lookup), 'source-changed')
    return { context: { evidence: evidenceFor(refs, batch.evidence.length, lookup), notes, speakers }, dependencies }
  }

  function commandFor(proposal, item, dependencies) {
    const { action, target, reason, draft } = proposal
    const evidence = draft.citations.map(citation => citation.ref)
    const direct = new Set(evidence.map(sourceKey))
    const contextEvidence = [...new Map(dependencies.map(ref => [sourceKey(ref), ref]))]
      .filter(([key]) => !direct.has(key)).map(([, ref]) => ref)
    const core = { action, id: target?.id ?? item.noteId, operationId: item.operationId, reason, sources: { evidence }, contextEvidence }
    if (action === 'ADD') return { ...core, meaning: draft.meaning }
    const existing = { ...core, expectedVersion: target.version }
    if (action === 'UPDATE') return { ...existing, meaning: draft.meaning }
    if (action === 'SUPERSEDE') return { ...existing, meaning: draft.meaning, newId: item.noteId, transition: 'explicit-same-scope-change' }
    return existing
  }

  function finishItem(batchId, index, status, reason, result) {
    editBatch(batchId, batch => {
      const item = batch.items[index]
      item.status = status
      item.reason = reason
      if (result) item.result = result.affectedNotes
      if (status !== 'review' && status !== 'outcome-unknown') delete item.wire
    })
  }

  async function settle(batch) {
    for (const [index, item] of batch.items.entries()) {
      if (!['proposed', 'outcome-unknown'].includes(item.status)) continue
      const allowed = item.approved ? reviewConsent : consent
      if (privacy.pending()) return false
      try {
        const receipt = await store.getOperationReceipt(item.operationId)
        if (receipt) {
          check(receipt.fingerprint === item.fingerprint, 'receipt-conflict')
          finishItem(batch.id, index, 'applied', 'receipt-confirmed', receipt)
          continue
        }

        const { context, dependencies } = await reconstruct(batch)
        const proposal = parseNoteProposals(JSON.stringify({ items: [item.wire] }), context)[0]
        const command = commandFor(proposal, item, dependencies)
        check(validRuntimeOperation(command) && operationFingerprint(command) === item.fingerprint, 'invalid-proposal')
        if (!allowed() || privacy.pending()) return false
        if (!proposal.draft.confirmed || !confirmed(proposal.draft.meaning.subject)
          || (!item.approved && authorize(proposal, command) !== true)) {
          finishItem(batch.id, index, 'review', 'review-required')
        } else {
          if (proposal.target) {
            const head = await store.getNoteV2(command.id)
            if (head?.version !== proposal.target.version || head?.status !== 'active' || head?.subject !== proposal.draft.meaning.subject) {
              finishItem(batch.id, index, 'rejected', 'stale-version')
              continue
            }
          }
          if (!allowed() || privacy.pending()) return false
          check(dependencies.every(sourceMessageLookup(readData())), 'source-changed')
          recallVersion = randomUUID()
          const result = await store.applyNoteOperation(command)
          if (privacy.pending()) return false
          finishItem(batch.id, index, 'applied', 'committed', result)
        }
      } catch (error) {
        if (error.code === 'outcome-unknown') {
          finishItem(batch.id, index, 'outcome-unknown', 'worker-reply-lost')
          await store.close().catch(closeError => report('worker-close-failed', closeError))
          return false
        }
        if (!['invalid-evidence', 'stale-version', 'note-missing', 'subject-changed', 'erased', 'invalid-transition',
          'no-semantic-change', 'insufficient-evidence'].includes(error.code) && error.message !== 'source-changed') throw error
        finishItem(batch.id, index, 'rejected', error.code ?? 'source-changed')
      }
    }
    editBatch(batch.id, row => { row.status = 'completed' })
    return true
  }

  const recallReadable = generation => !closing && recallConsent() && generation === recallVersion
    && store.status() === 'ready' && !privacy.pending()
  const conversationFingerprint = () => hash([readRawData()['aisling.conversations.v1']])

  function recallCurrent(version) {
    try {
      return !!publishedRecall && version === publishedRecall.version && recallReadable(publishedRecall.generation)
        && conversationFingerprint() === publishedRecall.conversation
    } catch { return false }
  }

  async function readRecallSnapshot() {
    if (!recallConsent()) return { reason: 'disabled' }
    await ready()
    const generation = recallVersion
    const conversation = conversationFingerprint()
    const notes = []
    let afterId = ''
    const deadline = performance.now() + 200
    // shortcut: scan up to 256 heads and degrade safely; use bounded search when larger profiles are supported.
    for (let page = 0; page < 64 && performance.now() < deadline; page++) {
      const result = await store.listRecallHeads(afterId)
      if (!recallReadable(generation)) return { reason: 'snapshot-changed' }
      notes.push(...result.notes.map(({ note, grounds }) => ({ note, grounds })))
      if (!result.nextCursor) {
        if (conversationFingerprint() !== conversation) return { reason: 'snapshot-changed' }
        if (publishedRecall?.generation !== generation || publishedRecall.conversation !== conversation)
          publishedRecall = { generation, conversation, version: randomUUID() }
        return { reason: 'ready', version: publishedRecall.version, notes }
      }
      check(result.nextCursor > afterId, 'invalid-recall-cursor')
      afterId = result.nextCursor
    }
    return { reason: 'index-incomplete' }
  }

  async function recover() {
    await ready()
    for (const batch of state.batches.filter(row => row.status === 'settling' && row.items.some(item => item.approved)))
      if (!await settle(batch)) break
  }

  async function reviewItem(batch, item) {
    const { context } = await reconstruct(batch)
    const { draft, target, reason } = parseNoteProposals(JSON.stringify({ items: [item.wire] }), context)[0]
    return { key: item.operationId, action: item.action, content: draft.meaning.content, kind: draft.meaning.kind,
      basis: draft.meaning.basis, uncertainty: draft.meaning.uncertainty, reason, target: target?.content,
      quotes: draft.citations.map(citation => citation.quote),
      approvable: Boolean(item.fingerprint && draft.confirmed && confirmed(draft.meaning.subject)) }
  }

  return {
    privacy,
    recover: () => queue(recover),
    listRecallHeads: (afterId = '') => queue(async () => { await ready(); return store.listRecallHeads(afterId) }),
    recallCurrent,
    recallSnapshot() {
      if (!recallConsent()) return Promise.resolve({ reason: 'disabled' })
      snapshotRead ??= queue(readRecallSnapshot).finally(() => { snapshotRead = undefined })
      return snapshotRead
    },
    reviews: () => queue(async () => {
      await recover()
      const items = []
      let pending = 0
      for (const batch of state.batches) {
        for (const [index, item] of (batch.items ?? []).entries()) {
          if (item.status !== 'review') continue
          pending++
          if (items.length >= 20) continue
          try { items.push(await reviewItem(batch, item)) }
          catch (error) {
            if (error.message !== 'source-changed') throw error
            finishItem(batch.id, index, 'rejected', 'source-changed')
            pending--
          }
        }
      }
      privacy.assertReadable()
      return { ready: true, pending, items,
        forming: state.batches.some(batch => batch.status === 'running'), failed: state.batches.at(-1)?.status === 'failed' }
    }),
    approvalOutcome(key) {
      if (!reviewConsent() || !id(key)) return 'stale'
      const item = state.batches.flatMap(batch => batch.items ?? []).find(row => row.operationId === key)
      return item?.approved && ['applied', 'rejected', 'outcome-unknown'].includes(item.status) ? item.status : 'stale'
    },
    decide: (key, approved) => queue(async () => {
      check(id(key) && typeof approved === 'boolean' && reviewConsent(), 'review-unavailable')
      await ready()
      const batch = state.batches.find(row => row.items?.some(item => item.operationId === key))
      const index = batch?.items.findIndex(item => item.operationId === key) ?? -1
      const item = batch?.items[index]
      if (!item) return 'stale'
      if (item.status === 'applied' || item.status === 'rejected') return item.status
      if (item.status !== 'review') {
        if (item.approved && approved) await settle(batch)
        return state.batches.find(row => row.id === batch.id)?.items[index].status ?? 'stale'
      }
      if (!approved) {
        finishItem(batch.id, index, 'rejected', 'user-rejected')
        return 'rejected'
      }
      check((await reviewItem(batch, item)).approvable, 'review-not-approvable')
      editBatch(batch.id, row => {
        row.status = 'settling'
        row.items[index].status = 'proposed'
        row.items[index].approved = true
      })
      await settle(state.batches.find(row => row.id === batch.id))
      return state.batches.find(row => row.id === batch.id)?.items[index].status ?? 'stale'
    }),
    close() { closing = true; return queue(() => store.close()) },
    delivered(sessionId, indices) {
      return queue(async () => {
        check(consent() && id(sessionId) && Array.isArray(indices) && indices.length >= 1 && indices.length <= 2
          && indices.every(i => Number.isSafeInteger(i) && i >= 0) && (indices.length === 1 || indices[0] < indices[1]), 'invalid-delivery')
        const data = readData()
        const sessions = readConversationSessions(data).filter(s => s.id === sessionId)
        check(sessions.length === 1 && indices.at(-1) < sessions[0].messages.length, 'invalid-delivery')
        const cursor = Object.hasOwn(state.progress, sessionId) ? state.progress[sessionId] : 0
        if (indices[0] < cursor) return
        const refs = indices.map(messageIndex => ({ sessionId, messageIndex, digest: messageDigest(sessions[0].messages[messageIndex]) }))
        const lookup = sourceMessageLookup(data)
        const evidence = evidenceFor(refs, refs.length, lookup)
        formationInput({ evidence, notes: [], speakers })
        update(next => {
          Object.defineProperty(next.progress, sessionId, { value: indices.at(-1) + 1, enumerable: true, writable: true, configurable: true })
          let batch = next.batches.find(b => b.sessionId === sessionId && b.status === 'collecting')
          if (batch) {
            try { formationInput({ evidence: [...evidenceFor(batch.evidence, batch.evidence.length, lookup), ...evidence], notes: [], speakers }) }
            catch { batch.status = 'pending'; batch = undefined }
          }
          if (!batch) {
            batch = { id: randomUUID(), sessionId, evidence: [], units: 0, attempts: 0, status: 'collecting' }
            next.batches.push(batch)
          }
          batch.evidence.push(...refs)
          if (++batch.units >= limits.units) batch.status = 'pending'
        })
      })
    },
    flush(sessionId) {
      return queue(async () => {
        if (!consent() || !id(sessionId)) return
        const batch = state.batches.find(row => row.status === 'collecting' && row.sessionId === sessionId)
        if (batch) editBatch(batch.id, row => { row.status = 'pending' })
      })
    },
    next() {
      return queue(async () => {
        if (!consent()) return null
        await ready()
        for (const batch of state.batches.filter(row => row.status === 'settling'))
          if (!await settle(batch)) return null
        if (state.batches.some(row => row.status === 'running')) return null
        const batch = state.batches.find(row => row.status === 'pending')
        if (!batch) return null
        editBatch(batch.id, row => { row.status = 'running'; row.attempts++ })
        return { id: batch.id, attempt: batch.attempts + 1, sessionId: batch.sessionId, refs: batch.evidence }
      })
    },
    prepare(batchId, attempt, history) {
      return queue(async () => {
        const batch = current(batchId, attempt)
        check(!batch.prepared && Array.isArray(history) && history.length + batch.evidence.length <= limits.sources
          && history.every(ref => evidenceRef(ref) && ref.sessionId !== batch.sessionId)
          && new Set(history.map(ref => JSON.stringify([ref.sessionId, ref.messageIndex]))).size === history.length, 'invalid-history')
        readData()
        const heads = []
        let cursor = ''
        for (let i = 0; i < 32; i++) {
          const page = await store.listRecallHeads(cursor)
          heads.push(...page.notes.filter(({ note }) => safeText([note.content, note.subject, note.uncertainty, ...(note.tags ?? [])].join(' '))))
          if (!page.nextCursor) break
          cursor = page.nextCursor
        }
        const lookup = sourceMessageLookup(readData())
        const currentEvidence = evidenceFor(batch.evidence, batch.evidence.length, lookup)
        const invalidSessions = new Set(history.filter(ref => {
          const message = lookup(ref)
          return !message || !safeText(message.content)
        }).map(ref => ref.sessionId))
        const validHistory = history.filter(ref => !invalidSessions.has(ref.sessionId))
        const refs = [...batch.evidence, ...validHistory]
        const ranked = rankNoteHeads(currentEvidence.map(e => e.message.content).join('\n'), heads)
        const notes = ranked.map(head => head.note)
        for (;;) {
          const context = { evidence: evidenceFor(refs, batch.evidence.length, lookup), notes, speakers }
          try {
            formationInput(context)
            check(consent(), 'stale-formation-attempt')
            editBatch(batchId, row => { row.prepared = { refs, candidates: ranked.slice(0, notes.length).map(({ note, cumulativeEvidence }) => ({
              id: note.id, version: note.version, evidence: cumulativeEvidence,
            })) } })
            return context
          } catch (error) {
            if (error.message !== 'input-limit') throw error
            if (notes.length) notes.pop()
            else {
              const last = refs.at(-1)?.sessionId
              if (last === batch.sessionId) throw error
              refs.splice(batch.evidence.length, refs.length, ...refs.slice(batch.evidence.length).filter(ref => ref.sessionId !== last))
            }
          }
        }
      })
    },
    submit(batchId, attempt, raw) {
      return queue(async () => {
        const batch = current(batchId, attempt)
        check(batch.prepared, 'formation-not-prepared')
        check(typeof raw === 'string' && raw.length <= limits.outputChars, 'output-limit')
        const { context, dependencies } = await reconstruct(batch)
        const proposals = parseNoteProposals(raw, context)
        const wire = JSON.parse(raw).items
        const items = proposals.map((proposal, index) => {
          if (!proposal.draft) return { action: proposal.action, status: 'undecided' }
          const item = { action: proposal.action, status: 'proposed', wire: wire[index], operationId: randomUUID(),
            ...(['ADD', 'SUPERSEDE'].includes(proposal.action) ? { noteId: randomUUID() } : {}) }
          const { contextEvidence, ...base } = commandFor(proposal, item, dependencies)
          check(validNoteV2Operation(base), 'invalid-proposal')
          if (contextEvidence.length > MAX_CONTEXT_EVIDENCE) return { ...item, status: 'review', reason: 'context-limit' }
          const command = { ...base, contextEvidence }
          check(validRuntimeOperation(command), 'invalid-proposal')
          return { ...item, fingerprint: operationFingerprint(command) }
        })
        check(consent(), 'stale-formation-attempt')
        editBatch(batchId, row => { row.status = items.length ? 'settling' : 'completed'; row.items = items })
      })
    },
    fail(batchId, attempt, reason) {
      return queue(async () => {
        const batch = state.batches.find(row => row.id === batchId)
        if (batch?.status === 'running' && batch.attempts === attempt) editBatch(batchId, row => {
          row.status = 'failed'
          row.error = knownErrors.has(reason) ? reason : 'invalid-proposal'
          delete row.prepared
        })
      })
    },
  }
}

module.exports = { createNoteFormationService }
