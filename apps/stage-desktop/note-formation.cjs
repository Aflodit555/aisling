const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { uuid, validNoteV2Operation, validRuntimeOperation, validRelationOperation, MAX_CONTEXT_EVIDENCE, operationFingerprint } = require('./memory-database/note-v1.cjs')
const { messageDigest, readConversationSessions, sourceMessageLookup } = require('./memory-evidence.cjs')
const { hash, sourceKey } = require('./memory-database/erasure.cjs')
const { createMemoryLifecycle } = require('./memory-lifecycle.cjs')
const { formationInput, parseNoteProposals, parseNoteBatch, limits } = require('./note-formation-contract.mjs')
const { safeText } = require('./memory-text.mjs')
const { createOrganizationIndex, authorizeOrganization, sameRecognition, planNoteRelation } = require('./note-organization-v2.mjs')
const { organizationInput, parseSemanticRelations, semanticRelationPlan, semanticLimits, refKey } = require('./note-semantic-contract.mjs')
const { discoverCandidates, buildNoteEmbeddingText, projectionVersion } = require('./note-candidates.mjs')
const { embed, embeddingIdentity } = require('./note-embedding.cjs')
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



/** Main owns authorization; model and Renderer cannot grant it. */
function createNoteFormationService({ profile, resources, readData: readRawData, writeData, consent,
  autonomous = false, authorize = (proposal, _command, context) => autonomous && authorizeOrganization(proposal, context),
  recallConsent = consent, reviewConsent = consent, archive = undefined, now = Date.now,
  embeddingConfig = () => undefined, embeddingRequest = embed,
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
    if (stored.organization) check((stored.organization.cursor === '' || uuid(stored.organization.cursor))
      && typeof stored.organization.bootstrapped === 'boolean' && Array.isArray(stored.organization.tasks)
      && stored.organization.tasks.length <= 2304 && stored.organization.tasks.every(task => uuid(task.id)
        && Number.isSafeInteger(task.version) && task.version > 0 && ['pending', 'completed', 'stale', 'failed'].includes(task.status)
        && Number.isSafeInteger(task.attempts) && task.attempts >= 0 && task.attempts <= 2
        && (!task.commands || Array.isArray(task.commands) && task.commands.length <= 2 && task.commands.every(validRelationOperation))
        && (!task.semantic || ['pending', 'running', 'settling', 'completed', 'failed'].includes(task.semantic.status)
          && Number.isSafeInteger(task.semantic.attempts) && task.semantic.attempts >= 0 && task.semantic.attempts <= 2
          && (!task.semantic.signature || /^[a-f0-9]{64}$/.test(task.semantic.signature))
          && (!task.semantic.refs || Array.isArray(task.semantic.refs) && task.semantic.refs.length <= 12 && task.semantic.refs.every(evidenceRef))
          && (!task.semantic.notes || Array.isArray(task.semantic.notes) && task.semantic.notes.length <= 5 && task.semantic.notes.every(note => uuid(note.id)
            && Number.isSafeInteger(note.version) && note.version > 0 && Array.isArray(note.grounds) && note.grounds.length <= 12 && note.grounds.every(evidenceRef)))
          && (!task.semantic.commands || Array.isArray(task.semantic.commands) && task.semantic.commands.length <= 2 && task.semantic.commands.every(validRelationOperation)))), 'invalid-formation-jobs')
    if (stored.organization?.semanticVersion === 1) check(Array.isArray(stored.organization.semanticSeen) && stored.organization.semanticSeen.length <= 4096
      && stored.organization.semanticSeen.every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))
      && Array.isArray(stored.organization.semanticCalls) && stored.organization.semanticCalls.length <= semanticLimits.callsPerHour
      && stored.organization.semanticCalls.every(time => Number.isSafeInteger(time) && time >= 0), 'invalid-formation-jobs')
    if (stored.embedding) check(typeof stored.embedding.space === 'string' && stored.embedding.space.length <= 200
      && (stored.embedding.cursor === '' || uuid(stored.embedding.cursor)) && Array.isArray(stored.embedding.calls)
      && stored.embedding.calls.length <= 60 && stored.embedding.calls.every(time => Number.isSafeInteger(time) && time >= 0)
      && Array.isArray(stored.embedding.failures) && stored.embedding.failures.length <= 2048
      && stored.embedding.failures.every(key => typeof key === 'string' && key.length < 150)
      && (!stored.embedding.pending || /^[a-f0-9]{64}$/.test(stored.embedding.pending.signature)
        && Number.isInteger(stored.embedding.pending.attempts) && stored.embedding.pending.attempts >= 1 && stored.embedding.pending.attempts <= 3
        && Number.isSafeInteger(stored.embedding.pending.retryAt)), 'invalid-embedding-jobs')
    if (stored.queryEmbeddingCalls) check(Array.isArray(stored.queryEmbeddingCalls) && stored.queryEmbeddingCalls.length <= 60
      && stored.queryEmbeddingCalls.every(time => Number.isSafeInteger(time) && time >= 0), 'invalid-embedding-jobs')
    if (stored.embeddingPriority) check(Array.isArray(stored.embeddingPriority) && stored.embeddingPriority.length <= 64
      && stored.embeddingPriority.every(uuid), 'invalid-embedding-jobs')
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

  if (autonomous && !state.organization) update(next => {
    next.organization = { cursor: '', bootstrapped: false, tasks: [] }
  })
  if (autonomous && state.organization.semanticVersion !== 1) update(next => {
    Object.assign(next.organization, { semanticVersion: 1, semanticSeen: [], semanticCalls: [], cursor: '', bootstrapped: false })
  })
  if (autonomous && state.organization.associativeVersion !== 1) update(next => {
    next.organization.associativeVersion = 1
    next.organization.cursor = ''; next.organization.bootstrapped = false
    for (const task of next.organization.tasks) if (['completed','failed'].includes(task.semantic?.status)) delete task.semantic
  })
  if (autonomous && state.organization.tasks.some(task => task.semantic?.status === 'running')) update(next => {
    for (const task of next.organization.tasks) if (task.semantic?.status === 'running') {
      task.semantic.status = task.semantic.attempts < 2 ? 'pending' : 'failed'
      task.semantic.error = 'interrupted'
      if (task.semantic.status === 'failed' && task.semantic.signature)
        next.organization.semanticSeen = [...new Set([...next.organization.semanticSeen, task.semantic.signature])].slice(-4096)
    }
  })

  if (state.batches.some(batch => batch.status === 'running' || batch.status === 'collecting')) update(next => {
    for (const batch of next.batches) {
      if (batch.status === 'running') { batch.status = 'failed'; batch.error = 'interrupted'; delete batch.prepared }
      if (batch.status === 'collecting') batch.status = 'pending'
    }
  })

  let serial = Promise.resolve()
  let closing = false, synchronized = -1
  let snapshotRead, publishedRecall
  const headIndex = createOrganizationIndex(store, () => recallVersion, () => sourceMessageLookup(readData()))
  let organizationTimer
  let embeddingRunning = false, embeddingAbort
  let embeddingGeneration = 0
  const queryVectors = new Map()
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
      const tasks = state.organization?.tasks.filter(task => !erased.has(task.id)
          && (task.semantic?.refs ?? []).every(lookup) && (task.semantic?.notes ?? []).every(note => !erased.has(note.id))
          && (!task.commands || task.commands.every(command => !erased.has(command.from) && !erased.has(command.to)
            && command.sources.evidence.every(lookup))))
      if (keep.length !== state.batches.length || tasks && tasks.length !== state.organization.tasks.length) update(next => {
        next.batches = keep
        if (tasks) next.organization.tasks = tasks
        next.embeddingPriority = (next.embeddingPriority ?? []).filter(id => !erased.has(id))
        if (next.embedding) next.embedding.failures = next.embedding.failures.filter(key => !erased.has(key.split(':')[1]))
      })
    },
    invalidate(reason) {
      embeddingGeneration++
      queryVectors.clear()
      embeddingAbort?.abort()
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
    update(next => change(next.batches.find(batch => batch.id === batchId), next))
  }

  function registerNotes(next, notes) {
    const jobs = next.organization.tasks
    for (const note of notes) if (!jobs.some(task => task.id === note.id && task.version === note.version))
      jobs.push({ id: note.id, version: note.version, status: 'pending', attempts: 0 })
    const latest = new Map()
    for (const task of jobs.filter(task => task.status !== 'pending')) {
      if (!latest.has(task.id) || latest.get(task.id).version <= task.version) latest.set(task.id, task)
    }
    const finished = [...latest.values()].slice(-2048)
    next.organization.tasks = [...jobs.filter(task => task.status === 'pending'), ...finished]
  }

  function scheduleNotes(notes) {
    if (autonomous) update(next => registerNotes(next, notes))
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
    /** @type {Record<string, import('./memory-database/store').EvidenceRef[]>} */
    const noteGrounds = {}
    const dependencies = [...refs]
    for (const candidate of candidates) {
      const revision = await store.getRevision(candidate.id, candidate.version)
      check(revision?.snapshot.status === 'active', 'source-changed')
      notes.push(revision.snapshot)
      noteGrounds[candidate.id] = revision.grounds.evidence
      dependencies.push(...candidate.evidence)
    }
    const lookup = sourceMessageLookup(readData())
    check(dependencies.every(lookup), 'source-changed')
    return { context: { evidence: evidenceFor(refs, batch.evidence.length, lookup), notes, speakers,
      candidatesComplete: batch.prepared.complete === true, noteGrounds }, dependencies }
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

  function proposedRelations(proposal, item, context) {
    if (proposal.action !== 'ADD' || !proposal.semantic?.target) return []
    const judgment = proposal.semantic
    const type = { 'state-change': 'STATE_CHANGE', continuation: 'CONTINUES', supplement: 'SUPPLEMENTS', conflict: 'CONFLICTS' }[judgment.relation]
    if (!type) return []
    const created = { note: { ...proposal.draft.meaning, id: item.noteId, version: 1, status: 'active', createdAt: now() },
      grounds: { evidence: proposal.draft.citations.map(source => source.ref) } }
    const target = { note: judgment.target, grounds: { evidence: context.noteGrounds[judgment.target.id] } }
    const plan = semanticRelationPlan(type, judgment.scope, created, target, [...judgment.sources, ...judgment.targetSources],
      sourceMessageLookup(readData()), proposal.reason)
    return plan ? [{ ...plan, operationId: randomUUID(), action: 'LINK' }] : []
  }

  async function commitRelations(commands) {
    const outcomes = []
    for (const command of commands ?? []) {
      if (!consent() || privacy.pending()) return null
      const receipt = await store.getOperationReceipt(command.operationId)
      if (receipt) {
        check(receipt.fingerprint === operationFingerprint(command), 'receipt-conflict')
        outcomes.push({ operationId: command.operationId, status: 'applied' })
      }
      else {
        recallVersion = randomUUID()
        try { await store.applyRelationOperation(command); outcomes.push({ operationId: command.operationId, status: 'applied' }) }
        catch (error) {
          if (!['stale-version', 'invalid-endpoint', 'invalid-transition', 'invalid-evidence', 'erased', 'relation-conflict'].includes(error.code)) throw error
          // Keep independent Notes and prior relation decisions when an optional link cannot be applied.
          outcomes.push({ operationId: command.operationId, status: error.code === 'relation-conflict' ? 'review' : 'stale', reason: error.code })
        }
      }
    }
    return outcomes
  }

  function finishItem(batchId, index, status, reason, result, relations = undefined) {
    editBatch(batchId, (batch, next) => {
      const item = batch.items[index]
      item.status = status
      item.reason = reason
      if (result) item.result = result.affectedNotes
      if (relations) item.relations = relations
      if (result && autonomous) registerNotes(next, result.affectedNotes)
      if (result && autonomous) next.embeddingPriority = [...new Set([...result.affectedNotes.map(note => note.id), ...(next.embeddingPriority ?? [])])].slice(0,64)
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
          const relations = await commitRelations(item.relationCommands)
          if (relations === null && privacy.pending()) return false
          finishItem(batch.id, index, 'applied', 'receipt-confirmed', receipt, relations ?? [{ status: 'deferred' }])
          continue
        }

        const { context, dependencies } = await reconstruct(batch)
        const proposal = parseNoteProposals(JSON.stringify({ items: [item.wire] }), context)[0]
        const command = commandFor(proposal, item, dependencies)
        check(validRuntimeOperation(command) && operationFingerprint(command) === item.fingerprint, 'invalid-proposal')
        if (!allowed() || privacy.pending()) return false
        const candidates = !item.approved ? await headIndex() : undefined
        if (!proposal.draft.confirmed || !confirmed(proposal.draft.meaning.subject)
          || (!item.approved && authorize(proposal, command, { heads: candidates.heads,
            complete: candidates.complete, lookup: sourceMessageLookup(readData()) }) !== true)) {
          finishItem(batch.id, index, 'review', candidates && !candidates.complete ? 'index-incomplete' : 'review-required')
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
          const relations = await commitRelations(item.relationCommands)
          if (relations === null && privacy.pending()) return false
          finishItem(batch.id, index, 'applied', 'committed', result, relations ?? [{ status: 'deferred' }])
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
    const pool = await headIndex()
    if (!recallReadable(generation) || conversationFingerprint() !== conversation) return { reason: 'snapshot-changed' }
    if (!pool.complete) return { reason: 'index-incomplete' }
    const notes = pool.heads.map(({ note, grounds }) => ({ note, grounds }))
    if (Buffer.byteLength(JSON.stringify(notes)) > 4_000_000) return { reason: 'index-incomplete' }
    if (publishedRecall?.generation !== generation || publishedRecall.conversation !== conversation)
      publishedRecall = { generation, conversation, version: randomUUID(), notes }
    return { reason: 'ready', version: publishedRecall.version, notes }
  }

  async function recover() {
    await ready()
    for (const batch of state.batches.filter(row => row.status === 'settling'
      && (row.items.some(item => item.approved) || autonomous && consent())))
      if (!await settle(batch)) break
    if (autonomous && consent()) for (const task of state.organization.tasks.filter(task => task.semantic?.status === 'settling'))
      await settleSemantic(task)
  }

  const semanticTask = jobId => typeof jobId === 'string' && jobId.startsWith('organization-')
    ? state.organization?.tasks.find(task => 'organization-' + task.id + '-' + task.version === jobId) : undefined
  function editSemantic(task, change) {
    update(next => change(next.organization.tasks.find(row => row.id === task.id && row.version === task.version).semantic, next.organization))
  }

  /** @returns {Promise<import('./note-formation-contract.mjs').NoteFormationContext>} */
  async function semanticContext(task) {
    const work = task.semantic, notes = []
    /** @type {Record<string, import('./memory-database/store').EvidenceRef[]>} */
    const noteGrounds = {}
    check(work && Array.isArray(work.refs) && Array.isArray(work.notes), 'stale-organization-attempt')
    for (const saved of work.notes) {
      const note = await store.getNoteV2(saved.id)
      check(note?.status === 'active' && note.version === saved.version && note.basis === 'direct', 'source-changed')
      const revision = await store.getRevision(note.id, note.version)
      check(JSON.stringify(revision.grounds.evidence.map(refKey).sort()) === JSON.stringify(saved.grounds.map(refKey).sort()), 'source-changed')
      notes.push(note); noteGrounds[note.id] = saved.grounds
    }
    const lookup = sourceMessageLookup(readData())
    check(work.refs.every(ref => lookup(ref) && safeText(lookup(ref).content)), 'source-changed')
    return { mode: 'organization', notes, noteGrounds, speakers, evidence: evidenceFor(work.refs, 0, lookup) }
  }

  async function settleSemantic(task) {
    if (!consent() || privacy.pending()) return
    try {
      const outcomes = await commitRelations(task.semantic.commands)
      if (outcomes === null || !consent() || privacy.pending()) return
      editSemantic(task, (work, organization) => {
        work.status = 'completed'
        work.results = outcomes
        organization.semanticSeen = [...new Set([...organization.semanticSeen, work.signature])].slice(-4096)
        delete work.refs; delete work.notes; delete work.commands
      })
    } catch (error) {
      if (error.code === 'outcome-unknown') await store.close().catch(closeError => report('worker-close-failed', closeError))
      throw error
    }
  }

  async function nextSemantic() {
    if (!autonomous || !consent()) return null
    await organize()
    const org = state.organization
    if (org.tasks.some(task => ['running', 'settling'].includes(task.semantic?.status))) return null
    const calls = org.semanticCalls.filter(time => time > now() - 3600_000)
    if (calls.length >= semanticLimits.callsPerHour || calls.length && now() - calls.at(-1) < semanticLimits.intervalMs) return null
    const pool = await headIndex()
    if (!pool.complete) return null
    for (const task of org.tasks.filter(task => task.status === 'completed' && (!task.semantic || task.semantic.status === 'pending')).slice(0, 8)) {
      const focus = pool.heads.find(head => head.note.id === task.id && head.note.version === task.version)
      if (!focus || focus.note.basis !== 'direct' || !focus.grounds.evidence.every(ref => {
        const message = sourceMessageLookup(readData())(ref)
        return message?.role === 'user' && safeText(message.content)
      })) {
        update(next => { next.organization.tasks.find(row => row.id === task.id && row.version === task.version).semantic = { status: 'completed', attempts: 0 } })
        continue
      }
      const existing = await store.listNoteRelations(focus.note.id)
      const linked = existing.relations.filter(relation => relation.status === 'active').flatMap(relation => [relation.from, relation.to])
      const lookup = sourceMessageLookup(readData())
      const vectorHits = await documentCandidates(focus.note)
      const candidates = discoverCandidates(focus.note.content + ' ' + (focus.note.tags ?? []).join(' '), pool.heads, vectorHits, focus.note, pool.complete).candidates
        .map(item => item.head).slice(0,4).filter(head => head.note.basis === 'direct'
          && !linked.includes(head.note.id) && !planNoteRelation(focus, head, lookup)
          && head.grounds.evidence.every(ref => lookup(ref)?.role === 'user' && safeText(lookup(ref).content)))
      const chosen = [focus, ...candidates]
      /** @type {import('./note-formation-contract.mjs').NoteFormationContext | undefined} */
      let context
      while (chosen.length >= 2) {
        const refs = [...new Map(chosen.flatMap(head => head.grounds.evidence).map(ref => [refKey(ref), ref])).values()]
        context = { mode: 'organization', notes: chosen.map(head => head.note),
          noteGrounds: Object.fromEntries(chosen.map(head => [head.note.id, head.grounds.evidence])),
          evidence: evidenceFor(refs, 0, lookup), speakers }
        try { organizationInput(context); break } catch (error) {
          if (error.message !== 'input-limit') throw error
          chosen.pop(); context = undefined
        }
      }
      const signature = context && hash(['associative-v1', chosen.map(head => [head.note.id, head.note.version, head.grounds.evidence.map(refKey).sort()]).sort()])
      if (!context || org.semanticSeen.includes(signature)) {
        update(next => { next.organization.tasks.find(row => row.id === task.id && row.version === task.version).semantic = { status: 'completed', attempts: 0, signature } })
        continue
      }
      const attempts = (task.semantic?.attempts ?? 0) + 1
      update(next => {
        next.organization.semanticCalls = [...calls, now()]
        next.organization.tasks.find(row => row.id === task.id && row.version === task.version).semantic = {
          status: 'running', attempts, signature, refs: context.evidence.map(entry => entry.ref),
          notes: chosen.map(head => ({ id: head.note.id, version: head.note.version, grounds: head.grounds.evidence })),
        }
      })
      return { id: 'organization-' + task.id + '-' + task.version, attempt: attempts, kind: 'organization', sessionId: '', refs: context.evidence.map(entry => entry.ref) }
    }
    return null
  }

  async function organize() {
    if (!autonomous || closing || !consent() || privacy.pending()) return
    await recover()
    const pool = await headIndex()
    if (!pool.complete) return
    if (!state.organization.bootstrapped && state.organization.tasks.filter(task => task.status === 'pending').length < 256) {
      const page = await store.listNoteHeads(state.organization.cursor)
      scheduleNotes(page.notes.map(head => head.note))
      update(next => {
        next.organization.cursor = page.nextCursor ?? next.organization.cursor
        next.organization.bootstrapped = !page.nextCursor
      })
    }
    const waiting = state.batches.find(batch => batch.items?.some(item => item.status === 'review' && item.reason === 'index-incomplete'))
    if (waiting) {
      editBatch(waiting.id, batch => {
        batch.status = 'settling'
        for (const item of batch.items) if (item.status === 'review' && item.reason === 'index-incomplete') item.status = 'proposed'
      })
      await settle(state.batches.find(batch => batch.id === waiting.id))
      return
    }
    const task = state.organization.tasks.find(task => task.status === 'pending')
    if (!task) return
    const editTask = change => update(next => change(next.organization.tasks.find(row => row.id === task.id && row.version === task.version)))
    try {
      if (!task.commands) {
        const head = pool.heads.find(head => head.note.id === task.id && head.note.version === task.version)
        if (!head) { editTask(row => { row.status = 'stale' }); return }
        const lookup = sourceMessageLookup(readData())
        const plans = pool.heads.map(other => planNoteRelation(head, other, lookup)).filter(Boolean)
        const byId = new Map(pool.heads.map(head => [head.note.id, head.note]))
        // Keep nearest stored reports in each direction; no all-pairs graph or model re-inference.
        const before = plans.filter(plan => plan.to === task.id).sort((a, b) => byId.get(b.from).createdAt - byId.get(a.from).createdAt)
        const after = plans.filter(plan => plan.from === task.id).sort((a, b) => byId.get(a.to).createdAt - byId.get(b.to).createdAt)
        editTask(row => { row.commands = [before[0], after[0]].filter(Boolean).map(plan => ({ ...plan, action: 'LINK', operationId: randomUUID() })) })
      }
      const current = state.organization.tasks.find(row => row.id === task.id && row.version === task.version)
      for (const command of current.commands) {
        const receipt = await store.getOperationReceipt(command.operationId)
        if (receipt) check(receipt.fingerprint === operationFingerprint(command), 'receipt-conflict')
        else {
          if (!consent() || privacy.pending()) return
          recallVersion = randomUUID()
          await store.applyRelationOperation(command)
        }
      }
      editTask(row => { row.status = 'completed'; delete row.commands })
    } catch (error) {
      editTask(row => {
        row.attempts++
        row.error = error.code ?? 'organization-failed'
        if (['stale-version', 'invalid-endpoint', 'invalid-transition', 'erased', 'invalid-evidence'].includes(error.code)) row.status = 'stale'
        else if (row.attempts >= 2) row.status = 'failed'
      })
      if (error.code === 'outcome-unknown') await store.close().catch(closeError => report('worker-close-failed', closeError))
      report('organization-pending', error)
    }
  }

  async function documentCandidates(note) {
    try {
      const config = embeddingConfig()
      if (!config) return []
      const saved = await store.getEmbedding(note.id), identity = embeddingIdentity(note, config)
      if (!saved || Object.keys(identity).some(key => saved[key] !== identity[key])) return []
      const result = await store.searchEmbeddings({ modelId: config.modelId, projectionVersion, embedding: saved.embedding })
      return result.hits
    } catch { return [] }
  }

  /** The durable cursor/pending batch reuses the Main job file; network work runs outside its queue. */
  async function syncEmbeddings() {
    if (embeddingRunning || closing || !autonomous || !consent() || !embeddingConfig()) return
    embeddingRunning = true
    let plan
    try {
      plan = await queue(async () => {
        await ready()
        const config = embeddingConfig(), generation = embeddingGeneration
        if (!config || !consent()) return
        if (state.embedding?.space !== config.modelId || state.embedding?.projectionVersion !== projectionVersion)
          update(next => { next.embedding = { space: config.modelId, projectionVersion, cursor: '', calls: [], failures: [] } })
        const calls = state.embedding.calls.filter(time => time > now() - 3600_000)
        if (calls.length >= 60 || state.embedding.pending?.retryAt > now()) return
        const priority = (state.embeddingPriority ?? []).slice(0,4)
        const page = priority.length ? { notes: (await Promise.all(priority.map(id => store.getEmbeddingHead(id)))).filter(Boolean), nextCursor: state.embedding.cursor }
          : await store.listEmbeddingHeads(state.embedding.cursor)
        const selected = []
        for (const head of page.notes) {
          const identity = embeddingIdentity(head.note, config), saved = await store.getEmbedding(head.note.id)
          if (!safeText(buildNoteEmbeddingText(head.note)) || saved && Object.keys(identity).every(key => saved[key] === identity[key])
            || state.embedding.failures.includes(identity.contentHash + ':' + identity.noteId + ':' + identity.noteVersion)) continue
          selected.push({ identity, text: buildNoteEmbeddingText(head.note) })
        }
        if (!selected.length) { update(next => { next.embedding.cursor = page.nextCursor ?? ''; next.embeddingPriority = (next.embeddingPriority ?? []).filter(id => !priority.includes(id)); delete next.embedding.pending }); return }
        const signature = hash(selected.map(item => item.identity)), attempts = state.embedding.pending?.signature === signature ? state.embedding.pending.attempts + 1 : 1
        if (attempts > 3) {
          update(next => { next.embedding.failures = [...new Set([...next.embedding.failures, ...selected.map(item => item.identity.contentHash + ':' + item.identity.noteId + ':' + item.identity.noteVersion)])].slice(-2048)
            next.embedding.cursor = page.nextCursor ?? ''; next.embeddingPriority = (next.embeddingPriority ?? []).filter(id => !priority.includes(id)); delete next.embedding.pending }); return
        }
        update(next => { next.embedding.calls = [...calls, now()]; next.embedding.pending = { signature, attempts, retryAt: now() + 30000 } })
        return { config, generation, selected, attempts, priority, cursor: page.nextCursor ?? '' }
      })
      if (!plan || closing) return
      embeddingAbort = new AbortController()
      const vectors = await embeddingRequest(plan.config, plan.selected.map(item => item.text), 'document', { signal: embeddingAbort.signal })
      await queue(async () => {
        if (closing || !consent() || plan.generation !== embeddingGeneration || embeddingConfig()?.modelId !== plan.config.modelId
          || embeddingConfig()?.apiKey !== plan.config.apiKey) return
        for (const [i, item] of plan.selected.entries()) {
          try { await store.putEmbedding({ ...item.identity, embedding: vectors[i] }) }
          catch (error) { if (!['stale-version','invalid-evidence','erased'].includes(error.code)) throw error }
        }
        update(next => { next.embedding.cursor = plan.cursor; next.embeddingPriority = (next.embeddingPriority ?? []).filter(id => !plan.priority.includes(id)); delete next.embedding.pending
          // New embeddings allow a bounded revisit of previously unlinked, current-version semantic tasks.
          for (const task of next.organization.tasks) if (task.semantic?.status === 'completed') delete task.semantic
        })
      })
    } catch (error) {
      if (plan && !closing) await queue(async () => {
        if (state.embedding?.space !== plan.config.modelId) return
        const reason = /^embedding-http-\d{3}$/.test(error.message) ? error.message : error.name === 'TimeoutError' ? 'embedding-timeout' : 'embedding-failed'
        update(next => { next.embedding.error = reason })
        if (plan.attempts >= 3) update(next => {
          next.embedding.failures = [...new Set([...next.embedding.failures, ...plan.selected.map(item => item.identity.contentHash + ':' + item.identity.noteId + ':' + item.identity.noteVersion)])].slice(-2048)
          next.embedding.cursor = plan.cursor; next.embeddingPriority = (next.embeddingPriority ?? []).filter(id => !plan.priority.includes(id)); delete next.embedding.pending
        })
      })
      report('embedding-pending', { code: 'embedding-failed' })
    } finally { embeddingRunning = false; embeddingAbort = undefined }
  }

  function wakeOrganization() {
    if (!autonomous || closing) return
    organizationTimer = setTimeout(() => {
      void queue(organize).then(() => syncEmbeddings()).catch(error => report('organization-pending', error)).finally(wakeOrganization)
    }, 1500)
    organizationTimer.unref?.()
  }
  wakeOrganization()

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
    syncEmbeddings,
    recover: () => queue(recover),
    organize: () => queue(organize),
    listRecallHeads: (afterId = '') => queue(async () => { await ready(); return store.listRecallHeads(afterId) }),
    recallCurrent,
    async recallCandidates(query, version) {
      check(typeof query === 'string' && safeText(query) && typeof version === 'string', 'invalid-candidate-query')
      const seed = await queue(async () => {
        if (!recallCurrent(version)) return
        const config = embeddingConfig(), heads = publishedRecall.notes
        return { config, heads, generation: embeddingGeneration }
      })
      if (!seed) return { candidates: [], complete: false, vectorStatus: 'unavailable' }
      let hits = [], vectorStatus = 'unavailable'
      if (seed.config) try {
        const key = hash([seed.config.modelId, query]), cached = queryVectors.get(key)
        let vector = cached?.expires > now() ? cached.vector : undefined
        if (!vector) {
          const allowed = await queue(async () => {
            if (!recallCurrent(version)) return false
            const times = (state.queryEmbeddingCalls ?? []).filter(time => time > now() - 3600_000)
            if (times.length >= 60) return false
            update(next => { next.queryEmbeddingCalls = [...times, now()] }); return true
          })
          if (!allowed) throw new Error('query-budget')
          ;[vector] = await embeddingRequest(seed.config, [query], 'query', { timeoutMs: 700 })
          if (closing || seed.generation !== embeddingGeneration || !recallCurrent(version)) throw new Error('stale-query')
          queryVectors.set(key, { vector, expires: now() + 300000 })
          if (queryVectors.size > 32) queryVectors.delete(queryVectors.keys().next().value)
        }
        hits = await queue(async () => {
          if (!recallCurrent(version) || embeddingConfig()?.modelId !== seed.config.modelId) return []
          const result = await store.searchEmbeddings({ modelId: seed.config.modelId, projectionVersion, embedding: vector })
          vectorStatus = result.complete ? 'incremental' : 'index-incomplete'
          return result.hits.filter(hit => { const head = seed.heads.find(head => head.note.id === hit.noteId)
            return head && hit.contentHash === embeddingIdentity(head.note, seed.config).contentHash })
        })
      } catch { /* Query embedding is optional and never blocks fallback after its deadline. */ }
      if (!recallCurrent(version) || closing || seed.generation !== embeddingGeneration) return { candidates: [], complete: false, vectorStatus: 'unavailable' }
      const fused = discoverCandidates(query, seed.heads, hits)
      return { complete: fused.complete, vectorStatus, candidates: fused.candidates.map(item => ({ noteId: item.head.note.id,
        noteVersion: item.head.note.version, channels: item.channels, score: item.score })) }
    },
    recallNeighbors: (ids, version, evolution = false, includeHistory = false) => queue(async () => {
      check(Array.isArray(ids) && ids.length <= 3 && ids.every(id) && typeof version === 'string' && typeof evolution === 'boolean' && typeof includeHistory === 'boolean', 'invalid-neighbor-request')
      if (!recallCurrent(version)) return { notes: [], relations: [] }
      const available = new Map(publishedRecall.notes.map(head => [head.note.id, head]))
      const lookup = sourceMessageLookup(readData())
      const relations = new Map()
      const queueIds = ids.map(id => ({ id, depth: 0, path: [] })), visited = new Set(), paths = []
      for (let index = 0; index < queueIds.length && visited.size < 8; index++) {
        const item = queueIds[index], noteId = item.id
        if (visited.has(noteId)) continue
        visited.add(noteId)
        if (!available.has(noteId)) continue
        const page = await store.listNoteRelations(noteId)
        // Reuse this source-checked snapshot; the final generation/fingerprint check fences concurrent changes.
        for (const relation of page.relations) if (relations.size < 16 && relation.status === 'active'
          && available.get(relation.from)?.note.version === relation.fromVersion
          && available.get(relation.to)?.note.version === relation.toVersion && relation.sources.evidence.every(lookup)) {
          relations.set(relation.key, relation)
          const other = relation.from === noteId ? relation.to : relation.from
          if (item.depth < 2 && !visited.has(other)) {
            const steps = [...item.path, { from: noteId, to: other, type: relation.type, reason: relation.reason }]
            if (!ids.includes(other) && !paths.some(path => path.noteId === other)) paths.push({ noteId: other, steps })
            if (item.depth < 1) queueIds.push({ id: other, depth: item.depth + 1, path: steps })
          }
        }
      }
      const history = []
      if (includeHistory) for (const noteId of ids.slice(0, 1)) {
        const revision = await store.getRecallHistory(noteId)
        if (revision) history.push({ forId: noteId, revision })
      }
      if (!recallCurrent(version)) return { notes: [], relations: [] }
      const chosen = [...relations.values()].slice(0, 16)
      const endpoints = new Set(chosen.flatMap(relation => [relation.from, relation.to]))
      return { notes: [...endpoints].slice(0,12).map(id => available.get(id)), relations: chosen, history, paths: paths.slice(0,12) }
    }),
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
        embeddingConfigured: !!embeddingConfig(),
        forming: state.batches.some(batch => batch.status === 'running') || state.organization?.tasks.some(task => task.semantic?.status === 'running'),
        failed: state.batches.at(-1)?.status === 'failed' }
    }),
    approvalOutcome(key) {
      if (!reviewConsent() || !id(key)) return 'stale'
      const item = state.batches.flatMap(batch => batch.items ?? []).find(row => row.operationId === key)
      return item?.status === 'applied' ? 'applied'
        : item?.approved && ['rejected', 'outcome-unknown'].includes(item.status) ? item.status : 'stale'
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
    close() { closing = true; embeddingAbort?.abort(); clearTimeout(organizationTimer); return queue(() => store.close()) },
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
    next(allowSemantic = true) {
      return queue(async () => {
        check(typeof allowSemantic === 'boolean', 'invalid-organization-allowance')
        if (!consent()) return null
        await ready()
        for (const batch of state.batches.filter(row => row.status === 'settling'))
          if (!await settle(batch)) return null
        if (state.batches.some(row => row.status === 'running')) return null
        const batch = state.batches.find(row => row.status === 'pending')
        if (!batch) return allowSemantic ? nextSemantic() : null
        editBatch(batch.id, row => { row.status = 'running'; row.attempts++ })
        return { id: batch.id, attempt: batch.attempts + 1, sessionId: batch.sessionId, refs: batch.evidence }
      })
    },
    prepare(batchId, attempt, history) {
      return queue(async () => {
        const task = semanticTask(batchId)
        if (task) {
          check(consent() && task.semantic?.status === 'running' && task.semantic.attempts === attempt && Array.isArray(history) && !history.length, 'stale-organization-attempt')
          return semanticContext(task)
        }
        const batch = current(batchId, attempt)
        check(!batch.prepared && Array.isArray(history) && history.length + batch.evidence.length <= limits.sources
          && history.every(ref => evidenceRef(ref) && ref.sessionId !== batch.sessionId)
          && new Set(history.map(ref => JSON.stringify([ref.sessionId, ref.messageIndex]))).size === history.length, 'invalid-history')
        readData()
        const pool = await headIndex()
        const heads = pool.heads.filter(({ note }) => safeText([note.content, note.subject, note.uncertainty, ...(note.tags ?? [])].join(' ')))
        const lookup = sourceMessageLookup(readData())
        const currentEvidence = evidenceFor(batch.evidence, batch.evidence.length, lookup)
        const invalidSessions = new Set(history.filter(ref => {
          const message = lookup(ref)
          return !message || !safeText(message.content)
        }).map(ref => ref.sessionId))
        const validHistory = history.filter(ref => !invalidSessions.has(ref.sessionId))
        const refs = [...batch.evidence, ...validHistory]
        const ranked = discoverCandidates(currentEvidence.map(e => e.message.content).join('\n'), heads.filter(head => head.grounds.evidence.every(ref => {
          const message = lookup(ref)
          return message && safeText(message.content)
        }))).candidates.map(item => item.head).slice(0,5)
        const notes = ranked.map(head => head.note)
        for (;;) {
          const selected = ranked.slice(0, notes.length)
          const withGrounds = [...new Map([...refs, ...selected.flatMap(head => head.grounds.evidence)].map(ref => [refKey(ref), ref])).values()]
          const noteGrounds = Object.fromEntries(selected.map(head => [head.note.id, head.grounds.evidence]))
          const context = { evidence: evidenceFor(withGrounds, batch.evidence.length, lookup), notes, speakers, candidatesComplete: pool.complete, noteGrounds }
          try {
            formationInput(context)
            check(consent(), 'stale-formation-attempt')
            editBatch(batchId, row => { row.prepared = { refs: withGrounds, complete: pool.complete, candidates: ranked.slice(0, notes.length).map(({ note, cumulativeEvidence }) => ({
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
        const task = semanticTask(batchId)
        if (task) {
          check(consent() && task.semantic?.status === 'running' && task.semantic.attempts === attempt, 'stale-organization-attempt')
          const context = await semanticContext(task)
          const proposals = parseSemanticRelations(raw, context), lookup = sourceMessageLookup(readData())
          const commands = proposals.map(proposal => semanticRelationPlan(proposal.type, proposal.scope,
            { note: proposal.from, grounds: { evidence: context.noteGrounds[proposal.from.id] } },
            { note: proposal.to, grounds: { evidence: context.noteGrounds[proposal.to.id] } }, proposal.sources, lookup, proposal.reason))
            .filter(Boolean).map(plan => ({ ...plan, action: 'LINK', operationId: randomUUID() }))
          check(consent() && !privacy.pending(), 'stale-organization-attempt')
          editSemantic(task, work => { work.commands = commands; work.status = 'settling' })
          await settleSemantic(state.organization.tasks.find(row => row.id === task.id && row.version === task.version))
          return
        }
        const batch = current(batchId, attempt)
        check(batch.prepared, 'formation-not-prepared')
        check(typeof raw === 'string' && raw.length <= limits.outputChars, 'output-limit')
        const { context, dependencies } = await reconstruct(batch)
        let parsed = parseNoteBatch(raw, context)
        const wire = parsed.map(item => item.wire)
        let proposals = parsed.map(item => item.proposal)
        if (autonomous) {
          for (const [index, proposal] of proposals.entries()) if (proposal?.action === 'ADD') {
            const duplicate = context.notes.findIndex(note => sameRecognition(note, proposal.draft.meaning))
            if (duplicate >= 0) { wire[index].action = 'NOOP'; wire[index].target = 'N' + (duplicate + 1); delete wire[index].semantic }
          }
          parsed = parseNoteBatch(JSON.stringify({ items: wire }), context)
          proposals = parsed.map(item => item.proposal)
        }
        const items = proposals.map((proposal, index) => {
          if (!proposal) return { action: 'INVALID', status: 'rejected', reason: parsed[index].error }
          if (!proposal.draft) return { action: proposal.action, status: 'undecided' }
          const item = { action: proposal.action, status: 'proposed', wire: wire[index], operationId: randomUUID(),
            ...(['ADD', 'SUPERSEDE'].includes(proposal.action) ? { noteId: randomUUID() } : {}) }
          const { contextEvidence, ...base } = commandFor(proposal, item, dependencies)
          check(validNoteV2Operation(base), 'invalid-proposal')
          if (contextEvidence.length > MAX_CONTEXT_EVIDENCE) return { ...item, status: 'review', reason: 'context-limit' }
          const command = { ...base, contextEvidence }
          check(validRuntimeOperation(command), 'invalid-proposal')
          return { ...item, fingerprint: operationFingerprint(command), relationCommands: proposedRelations(proposal, item, context) }
        })
        check(consent(), 'stale-formation-attempt')
        editBatch(batchId, row => { row.status = items.length ? 'settling' : 'completed'; row.items = items })
      })
    },
    fail(batchId, attempt, reason) {
      return queue(async () => {
        const task = semanticTask(batchId)
        if (task) {
          if (task.semantic?.status === 'running' && task.semantic.attempts === attempt) editSemantic(task, (work, organization) => {
            work.status = work.attempts < 2 && reason !== 'source-changed' ? 'pending' : 'failed'
            work.error = knownErrors.has(reason) ? reason : 'invalid-proposal'
            if (work.status === 'failed') organization.semanticSeen = [...new Set([...organization.semanticSeen, work.signature])].slice(-4096)
          })
          return
        }
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
