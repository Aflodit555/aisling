const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { createMemoryDatabaseStore, createNoteV2Store } = require('./memory-database/store.cjs')
const { authority, stateName, dispositionName, migratedJournal, v1Path, databasePath: targetPath, exists,
  readMigration: readState, workerConfig } = require('./memory-authority.cjs')
const { uuid, validRuntimeOperation, needsMultipleSources, MAX_CONTEXT_EVIDENCE, operationFingerprint } = require('./memory-database/note-v1.cjs')
const { hash, sourceKey } = require('./memory-database/erasure.cjs')
const { readConversationSessions, sourceMessageLookup } = require('./memory-evidence.cjs')
const { safeText } = require('./memory-text.mjs')
const speakers = require('./memory-subjects.json')

const confirmed = subject => Object.values(speakers).some(speaker => speaker.subject === subject)
const kinds = ['event', 'fact', 'pattern', 'preference', 'project-state', 'open-question']
const validRef = ref => ref && /^[\w-]{1,128}$/.test(ref.sessionId) && typeof ref.sessionId === 'string'
  && Number.isSafeInteger(ref.messageIndex) && ref.messageIndex >= 0 && typeof ref.digest === 'string' && /^[a-f0-9]{64}$/.test(ref.digest)
const hashes = /^[a-f0-9]{64}$/
const check = (value, reason) => { if (!value) throw new Error(reason) }
const norm = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
const unique = refs => [...new Map(refs.map(ref => [sourceKey(ref), ref])).entries()]
  .sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref)
const keys = refs => unique(refs).map(sourceKey)
const asUuid = digest => [digest.slice(0, 8), digest.slice(8, 12), '4' + digest.slice(13, 16),
  '8' + digest.slice(17, 20), digest.slice(20, 32)].join('-')



function durable(file, text) {
  const temp = file + '.tmp'
  if (exists(temp)) fs.unlinkSync(temp)
  fs.writeFileSync(temp, text, { flag: 'wx', flush: true })
  fs.renameSync(temp, file)
}

function readDispositions(file) {
  if (!exists(file)) return {}
  check(fs.statSync(file).size <= 160_000, 'invalid-migration-dispositions')
  const { version, excluded } = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(version === 1 && excluded && typeof excluded === 'object' && !Array.isArray(excluded)
    && Object.entries(excluded).every(([key, proof]) => hashes.test(key) && typeof proof === 'string' && hashes.test(proof)),
    'invalid-migration-dispositions')
  return excluded
}





async function collect(page, field, limit) {
  const rows = []
  let cursor = ''
  for (;;) {
    const next = await page(cursor)
    rows.push(...next[field])
    check(rows.length <= limit, 'migration-scan-limit')
    if (!next.nextCursor) return rows
    check(next.nextCursor > cursor, 'invalid-migration-cursor')
    cursor = next.nextCursor
  }
}

async function historyFor(store, { note, grounds }) {
  check(uuid(note.id) && Number.isSafeInteger(note.version) && note.version > 0 && note.version <= 64, 'unproven-history')
  const revisions = [], receipts = new Map()
  const addReceipt = receipt => {
    check(receipt && uuid(receipt.operationId) && typeof receipt.fingerprint === 'string' && hashes.test(receipt.fingerprint)
      && Number.isSafeInteger(receipt.changedAt) && receipt.changedAt >= 0 && Array.isArray(receipt.affectedNotes)
      && receipt.affectedNotes.every(row => uuid(row.id) && Number.isSafeInteger(row.version) && row.version > 0), 'unproven-history')
    receipts.set(receipt.operationId, receipt)
    return receipt
  }
  for (let version = 1; version <= note.version; version++) {
    const revision = await store.getRevision(note.id, version)
    check(revision?.noteId === note.id && revision.version === version && revision.snapshot?.id === note.id
      && revision.snapshot.version === version && revision.snapshot.subject === note.subject
      && revision.snapshot.createdAt === note.createdAt && uuid(revision.operationId), 'unproven-history')
    const receipt = addReceipt(await store.getOperationReceipt(revision.operationId))
    const previous = revisions.at(-1)?.snapshot.status
    check(receipt.operationId === revision.operationId && receipt.changedAt === revision.changedAt && receipt.action === revision.action
      && receipt.affectedNotes.some(row => row.id === note.id && row.version === version)
      && (version === 1 ? ['ADD', 'SUPERSEDE'].includes(revision.action) && revision.snapshot.status === 'active'
        && revision.snapshot.createdAt === revision.changedAt
        : revision.action === 'UPDATE' ? previous === 'active' && revision.snapshot.status === 'active'
        : revision.action === 'SUPERSEDE' ? previous === 'active' && revision.snapshot.status === 'superseded' && uuid(revision.successorId)
        : revision.action === 'RETRACT' && ['active', 'superseded'].includes(previous) && revision.snapshot.status === 'retracted'),
      'unproven-history')
    revisions.push(revision)
    const supplements = await collect(after => store.getVersionSourceChanges(note.id, version, after), 'changes', 128)
    for (const entry of supplements) {
      const supplement = addReceipt(entry)
      check(supplement.action === 'NOOP' && supplement.links && supplement.affectedNotes.length === 1
        && supplement.affectedNotes[0].id === note.id && supplement.affectedNotes[0].version === version, 'unproven-history')
    }
  }
  check(isDeepStrictEqual(revisions.at(-1).snapshot, note) && isDeepStrictEqual(revisions.at(-1).grounds, grounds), 'unproven-history')
  const evidence = await collect(after => store.listNoteEvidence(note.id, after), 'evidence', 128)
  const origins = (await store.getOrigins(note.id)).sort((a, b) => a.reflectionId.localeCompare(b.reflectionId))
  check(origins.length <= MAX_CONTEXT_EVIDENCE, 'unproven-history')
  const bundles = [...revisions.map(revision => revision.grounds), ...[...receipts.values()].flatMap(receipt => receipt.links ? [receipt.links] : [])]
  check(bundles.every(bundle => Array.isArray(bundle?.evidence) && bundle.evidence.every(validRef) && Array.isArray(bundle.origins))
    && isDeepStrictEqual(keys(evidence), keys(bundles.flatMap(bundle => bundle.evidence)))
    && isDeepStrictEqual(origins.map(origin => origin.reflectionId).sort(), [...new Set(bundles.flatMap(bundle => bundle.origins.map(origin => origin.reflectionId)))].sort()),
    'unproven-history')
  return { revisions, receipts: [...receipts.values()], evidence: unique(evidence), origins }
}

async function classify({ data, reflections, journal, store, decisions }) {
  const items = [], commands = [], choices = new Map(), reasons = new Map(), noteEntries = new Map(), included = new Set()
  const counts = { notes: 0, reflections: 0, duplicates: 0, review: 0, unavailable: 0, historyIssues: 0, history: 0, revisions: 0, receipts: 0, excluded: 0 }
  const mark = (bucket, reason) => { counts[bucket]++; if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1) }
  const knownFailure = new Set(['source-missing', 'source-changed', 'source-blocked', 'identity-uncertain', 'insufficient-support',
    'unproven-history', 'unproven-context', 'unproven-kind', 'unproven-time', 'invalid-meaning', 'unsupported-history', 'disposition-changed'])
  function reject(error, history = false) {
    if (!knownFailure.has(error.message)) throw error
    const bucket = history ? 'historyIssues'
      : ['source-missing', 'source-changed', 'source-blocked'].includes(error.message) ? 'unavailable' : 'review'
    mark(bucket, error.message)
  }
  const sourceSessions = readConversationSessions(data)
  const sessions = new Map(sourceSessions.map(session => [session.id, session]))
  check(sourceSessions.length === sessions.size, 'ambiguous-conversation-session')
  check(reflections.reflections.length <= 1024 && reflections.batches.length <= 1024, 'migration-scan-limit')
  const lookup = sourceMessageLookup(data)
  const saved = new Map(reflections.reflections.map(row => [row.id, row]))
  const batches = new Map()
  const blocked = new Set(journal.blocked.sources)
  const blockedSessions = new Set(journal.blocked.sessions)
  const blockedOrigins = new Set(journal.blocked.origins)
  const blockedBatches = new Set(journal.blocked.batches)
  const qualified = new Set(journal.qualified)

  function evidence(refs) {
    check(Array.isArray(refs) && refs.every(validRef), 'unproven-history')
    return refs.map(ref => {
      check(!blocked.has(sourceKey(ref)) && !blockedSessions.has(hash(ref.sessionId)), 'source-blocked')
      check(sessions.get(ref.sessionId)?.messages[ref.messageIndex], 'source-missing')
      const message = lookup(ref)
      check(message, 'source-changed')
      return message
    })
  }

  for (const batch of reflections.batches) {
    try {
      check(!blockedBatches.has(hash(batch.id)), 'source-blocked')
      check(Array.isArray(batch.reflectionIds) && batch.reflectionIds.every(id => saved.has(id) && !batches.has(id)), 'unproven-history')
      for (const id of batch.reflectionIds) batches.set(id, batch)
      evidence(batch.sourceRefs)
      evidence(batch.contextSources ?? [])
      evidence(batch.organization?.contextSources ?? [])
      check(!batch.organization?.contextNoteIds?.length, 'unproven-context')
      check(batch.status === 'completed' || batch.status === 'failed', 'unsupported-history')
      check(!(batch.organization?.items ?? []).some(item => !['applied', 'undecided', 'rejected'].includes(item.status)), 'unsupported-history')
    } catch (error) { reject(error, true) }
  }
  check(saved.size === reflections.reflections.length, 'ambiguous-legacy-reflection')
  if (journal.pending.length) reasons.set('cleanup-pending', journal.pending.length)

  function lineage(id, visiting = new Set()) {
    const row = saved.get(id), batch = batches.get(id)
    check(row?.version === 1 && batch?.status === 'completed' && !visiting.has(id) && visiting.size < 12, 'unproven-history')
    check(!blockedOrigins.has(hash(id)) && !blockedBatches.has(hash(batch.id)), 'source-blocked')
    check(!batch.organization?.contextNoteIds?.length && (batch.organization || Array.isArray(batch.contextSources)), 'unproven-context')
    const refs = [...row.sourceRefs, ...batch.sourceRefs, ...(batch.contextSources ?? []), ...(batch.organization?.contextSources ?? [])]
    visiting.add(id)
    for (const contextId of batch.contextReflectionIds ?? []) {
      refs.push(...lineage(contextId, visiting))
      check(refs.length <= 256, 'unproven-context')
    }
    visiting.delete(id)
    evidence(refs)
    return unique(refs)
  }

  function candidate(id, meaning, direct, dependencies) {
    const sources = unique(direct)
    const sourceSet = new Set(keys(sources))
    const contextEvidence = unique(dependencies).filter(ref => !sourceSet.has(sourceKey(ref)))
    const messages = evidence(sources)
    evidence(contextEvidence)
    check(confirmed(meaning.subject), 'identity-uncertain')
    const userReports = new Set(messages.filter(m => m.role === 'user').map(m => norm(m.content)))
    const minimum = needsMultipleSources(meaning) ? 2 : meaning.subject === speakers.user.subject ? 1 : 0
    if (meaning.subject === speakers.assistant.subject) check(meaning.kind === 'event' && meaning.basis === 'direct'
      && messages.length === 1 && messages[0].role === 'assistant' && meaning.content === speakers.assistant.prefix + messages[0].content,
      'insufficient-support')
    check(userReports.size >= minimum && messages.every(m => safeText(m.content)), 'insufficient-support')
    if (meaning.eventTime) {
      const time = meaning.eventTime
      const literals = time.kind === 'date-range' ? [time.start, time.end] : [time.kind === 'date' ? time.date : new Date(time.epochMs).toISOString()]
      check(literals.every(literal => messages.some(message => message.content.includes(literal))), 'unproven-time')
    }
    const draft = { action: /** @type {const} */ ('ADD'), id, operationId: id, reason: 'Migration baseline from verified legacy memory',
      meaning, sources: { evidence: sources }, contextEvidence }
    check(safeText([meaning.content, meaning.uncertainty, ...(meaning.tags ?? [])].join(' ')) && validRuntimeOperation(draft), 'invalid-meaning')
    return draft
  }

  const heads = store ? await collect(after => store.listNoteHeads(after), 'notes', 512) : []
  for (const head of heads) {
    try {
      const history = await historyFor(store, head)
      const dependencies = [...history.evidence]
      evidence(dependencies)
      for (const origin of history.origins) {
        dependencies.push(...lineage(origin.reflectionId))
        check(dependencies.length <= 256, 'unproven-context')
      }
      for (const bundle of [...history.revisions.map(revision => revision.grounds),
        ...history.receipts.flatMap(receipt => receipt.links ? [receipt.links] : [])]) {
        const references = new Set(keys(bundle.origins.flatMap(origin => saved.get(origin.reflectionId)?.sourceRefs ?? [])))
        check(bundle.evidence.every(ref => references.has(sourceKey(ref))), 'unproven-history')
      }
      counts.revisions += history.revisions.length
      noteEntries.set(head.note.id, { ...head, history, dependencies: unique(dependencies) })
    } catch (error) { reject(error) }
  }

  counts.receipts = new Set([...noteEntries.values()].flatMap(entry => entry.history.receipts.map(receipt => receipt.operationId))).size
  const lifecycleEdges = new Map()
  try {
    for (const [id, entry] of noteEntries) {
      for (const revision of entry.history.revisions) {
        if (revision.action !== 'SUPERSEDE') continue
        const receipt = entry.history.receipts.find(row => row.operationId === revision.operationId)
        const [other] = receipt.affectedNotes.filter(row => row.id !== id)
        const sibling = noteEntries.get(other?.id)
        const siblingRevision = sibling?.history.revisions[other?.version - 1]
        check(receipt.affectedNotes.length === 2 && siblingRevision?.operationId === revision.operationId
          && sibling.note.subject === entry.note.subject && siblingRevision.action === 'SUPERSEDE'
          && (revision.successorId ? revision.successorId === other.id && other.version === 1 : siblingRevision.successorId === id),
          'unproven-history')
        const related = lifecycleEdges.get(id) ?? new Set()
        related.add(other.id)
        lifecycleEdges.set(id, related)
      }
    }
  } catch (error) { reject(error, true) }

  function lifeDependencies(id, visited = new Set()) {
    if (visited.has(id)) return []
    check(visited.size < 64, 'unproven-context')
    visited.add(id)
    const refs = [...noteEntries.get(id).dependencies]
    for (const related of lifecycleEdges.get(id) ?? []) {
      refs.push(...lifeDependencies(related, visited))
      check(refs.length <= 512, 'unproven-context')
    }
    return refs
  }

  function archiveOrigins(entry) {
    for (const revision of entry.history.revisions) {
      for (const origin of revision.grounds.origins) {
        const row = saved.get(origin.reflectionId)
        if (row && norm(row.content) === norm(revision.snapshot.content) && row.basis === revision.snapshot.basis)
          included.add(row.id)
      }
    }
    // NOOP attaches evidence for existing meaning and does not create another memory.
    for (const receipt of entry.history.receipts.filter(receipt => receipt.action === 'NOOP')) {
      const prior = entry.history.revisions[receipt.affectedNotes[0].version - 1]
      for (const origin of receipt.links?.origins ?? []) {
        const row = saved.get(origin.reflectionId)
        if (row && norm(row.content) === norm(prior.snapshot.content) && row.basis === prior.snapshot.basis)
          included.add(row.id)
      }
    }
  }

  const semanticKey = (meaning, refs) => hash([meaning.subject, norm(meaning.content), meaning.basis,
    meaning.kind, meaning.uncertainty ?? null, meaning.eventTime, keys(refs)])
  for (const [id, entry] of noteEntries) {
    try {
      const { note, grounds } = entry
      if (note.status !== 'active') {
        mark('history')
        archiveOrigins(entry)
        continue
      }
      const matches = grounds.origins.map(origin => saved.get(origin.reflectionId))
        .filter(row => row && norm(row.content) === norm(note.content) && row.basis === note.basis)
      check(matches.length && matches.every(row => kinds.includes(row.kind) && row.kind === matches[0].kind), 'unproven-kind')
      const { content, subject, eventTime, basis, uncertainty, tags } = note
      const meaning = { content, subject, eventTime, basis, kind: matches[0].kind, ...(uncertainty !== undefined && { uncertainty }),
        ...((tags ?? matches[0].tags) && { tags: tags ?? matches[0].tags }) }
      const draft = candidate(id, meaning, grounds.evidence, lifeDependencies(id))
      commands.push(draft)
      items.push(semanticKey(meaning, grounds.evidence))
      mark('notes')
      archiveOrigins(entry)
    } catch (error) { reject(error) }
  }

  // Only isolated records with a proven erase path may be archived by choice.
  const referenced = new Set([
    ...reflections.batches.flatMap(batch => batch.contextReflectionIds ?? []),
    ...reflections.reflections.flatMap(row => row.relatedReflectionIds ?? []),
    ...(store ? (await collect(after => store.listMemorySources('origin', after), 'sources', 6144)).map(({ ref }) => ref.reflectionId) : []),
  ])
  const labels = new Map()
  for (const row of saved.values()) {
    if (typeof row.content !== 'string') continue
    const label = norm(row.content.slice(0, 160))
    labels.set(label, (labels.get(label) ?? 0) + 1)
  }
  const savedKeys = new Set([...saved.keys()].map(id => hash(id)))
  for (const key of Object.keys(decisions)) {
    if (!savedKeys.has(key) && !blockedOrigins.has(key)) mark('historyIssues', 'disposition-changed')
  }
  const semantic = new Set(items)
  for (const row of saved.values()) {
    const batch = batches.get(row.id)
    const key = hash(row.id)
    let proof
    try {
      const refs = lineage(row.id)
      const original = evidence(row.sourceRefs)
      if (!batch.organization && batch.reflectionIds.length === 1 && !referenced.has(row.id)
        && row.recallEligible !== false && row.sourceRefs.length && Array.isArray(row.relatedReflectionIds) && !row.relatedReflectionIds.length
        && typeof row.content === 'string' && safeText(row.content) && labels.get(norm(row.content.slice(0, 160))) === 1)
        proof = hash([row, batch, refs])
      if (Object.hasOwn(decisions, key)) {
        check(proof && proof === decisions[key], 'disposition-changed')
        choices.set(key, { proof, excluded: true })
        mark('excluded')
        continue
      }
      if (included.has(row.id)) {
        const duplicate = commands.some(draft => draft.meaning.eventTime === null && norm(draft.meaning.content) === norm(row.content)
          && draft.meaning.kind === row.kind && draft.meaning.basis === row.basis && draft.meaning.uncertainty === row.uncertainty
          && isDeepStrictEqual(keys(draft.sources.evidence), keys(row.sourceRefs))
          && original.every(message => message.role === (draft.meaning.subject === speakers.user.subject ? 'user' : 'assistant')))
        // Historical Origins are operation records. They cannot reintroduce superseded or retracted meaning.
        mark(duplicate ? 'duplicates' : 'history')
        continue
      }
      const organization = batch.organization
      if (organization || row.recallEligible === false) {
        check(!qualified.has(hash(row.id)), 'unproven-history')
        mark('history')
        continue
      }
      const user = original.length && original.every(message => message.role === 'user')
        && /^(?:用户(?:报告|自述|陈述|表示|在)|the user (?:reported|said|described))/iu.test(row.content)
      const speech = original.length === 1 && original[0].role === 'assistant' && row.kind === 'event'
        && row.basis === 'direct' && row.content === speakers.assistant.prefix + original[0].content
      check(user || speech, 'identity-uncertain')
      if (row.kind === 'pattern') check(new Set(row.sourceRefs.map(ref => ref.sessionId)).size >= 2 && row.basis !== 'direct', 'insufficient-support')
      const meaning = { content: row.content, subject: user ? speakers.user.subject : speakers.assistant.subject,
        kind: row.kind, basis: row.basis, tags: row.tags, eventTime: null,
        ...(row.uncertainty !== undefined && { uncertainty: row.uncertainty }) }
      const draft = candidate(asUuid(hash(['legacy-reflection-baseline', row.id])), meaning, row.sourceRefs, refs)
      const equivalence = semanticKey(meaning, row.sourceRefs)
      if (semantic.has(equivalence)) {
        // A duplicate can still bring model-input dependencies which must travel with the retained baseline.
        const same = commands.find(item => semanticKey(item.meaning, item.sources.evidence) === equivalence)
        check(same, 'unproven-history')
        same.contextEvidence = unique([...same.contextEvidence, ...draft.contextEvidence])
        check(validRuntimeOperation(same), 'unproven-context')
        mark('duplicates')
      } else {
        semantic.add(equivalence)
        commands.push(draft)
        mark('reflections')
      }
    } catch (error) {
      reject(error)
      if (proof && ['identity-uncertain', 'insufficient-support'].includes(error.message))
        choices.set(key, { proof, label: row.content.slice(0, 160), code: error.message })
    }
  }

  check(new Set(commands.map(command => command.id)).size === commands.length, 'migration-id-collision')
  const summary = { ...counts, reasons: [...reasons].map(([code, count]) => ({ code, count })),
    choices: [...choices].filter(([, choice]) => !choice.excluded).slice(0, 20).map(([key, { label, code }]) => ({ key, label, code })),
    canMigrate: !counts.review && !counts.unavailable && !counts.historyIssues && !journal.pending.length }
  const digest = hash([data['aisling.conversations.v1'] ?? null, reflections, journal, [...noteEntries.values()], commands])
  return { summary, digest: Object.keys(decisions).length ? hash([digest, decisions]) : digest, choices, commands, barriers: { sources: journal.blocked.sources, sessions: journal.blocked.sessions } }
}

function createMemoryMigration(options) {
  const { profile, resources, readData, readReflections, legacy, freeze, checkpoint = (_phase) => {} } = options
  const file = path.join(profile, stateName), mode = path.join(profile, 'memory-authority')
  const save = state => durable(file, JSON.stringify(state))
  const dispositionFile = path.join(profile, dispositionName)
  let busy = false, preview, failed = false
  const status = () => {
    const state = readState(profile)
    return { phase: state ? exists(mode) ? 'committed' : failed ? 'blocked' : state.phase : failed ? 'blocked' : 'legacy',
      busy, ...(state && { done: state.done, total: state.total }) }
  }

  async function scan() {
    check(fs.realpathSync(profile) === profile, 'unsafe-migration-path')
    check(!['memory-note-v1', 'memory-db-p0', 'note-v2.test.lbdb'].some(name => exists(path.join(profile, name))), 'unsupported-legacy-storage')
    for (const name of ['aisling-store.json', 'aisling-reflections.v1.json', 'memory-erasure.v1.json']) exists(path.join(profile, name))
    const data = readData(), reflections = readReflections(), journal = legacy.privacy.readJournal()
    const decisions = readDispositions(dispositionFile)
    const source = v1Path(profile)
    let store, own = false
    if (exists(source)) {
      check(fs.realpathSync(path.dirname(source)) === path.dirname(source), 'unsafe-migration-path')
      own = legacy.store.status() !== 'ready'
      store = own ? createMemoryDatabaseStore(workerConfig(resources, source, true), () => {}) : legacy.store
    }
    try {
      if (own) await store.open()
      const plan = await classify({ data, reflections, journal, store, decisions })
      check(hash([data, reflections, journal, decisions])
        === hash([readData(), readReflections(), legacy.privacy.readJournal(), readDispositions(dispositionFile)]), 'migration-preview-changed')
      return plan
    } finally { if (own) await store.close() }
  }

  async function checkDisposition(key, version) {
    check(!busy && !exists(mode) && !readState(profile) && typeof key === 'string' && hashes.test(key) && uuid(version),
      'disposition-unavailable')
    const plan = await scan()
    const choice = plan.choices.get(key)
    check(choice && (choice.excluded || (preview?.version === version && preview.digest === plan.digest)), 'migration-preview-changed')
    return choice
  }

  return {
    status,
    frozen: () => busy || !!readState(profile),
    async preflight() {
      check(!busy && !exists(mode), 'migration-unavailable')
      preview = undefined
      const plan = await scan()
      preview = { digest: plan.digest, version: randomUUID() }
      return { ...plan.summary, version: preview.version }
    },
    async dispositionChoice(key, version) {
      const choice = await checkDisposition(key, version)
      return choice.excluded ? { excluded: true } : { label: choice.label }
    },
    async exclude(key, version) {
      const choice = await checkDisposition(key, version)
      check(!busy && !readState(profile) && !exists(mode), 'disposition-unavailable')
      if (!choice.excluded) {
        const excluded = readDispositions(dispositionFile)
        durable(dispositionFile, JSON.stringify({ version: 1, excluded: { ...excluded, [key]: choice.proof } }))
        preview = undefined
      }
      return 'excluded'
    },
    async execute() {
      if (exists(mode)) {
        check(readState(profile)?.phase === 'validated' && fs.readFileSync(mode, 'utf8') === authority, 'migration-unavailable')
        return status()
      }
      check(!busy && (preview || readState(profile)), 'migration-preview-required')
      busy = true
      failed = false
      let target
      try {
        await freeze()
        const plan = await scan()
        let state = readState(profile)
        check(plan.summary.canMigrate && plan.digest === (state?.digest ?? preview?.digest), 'migration-preview-changed')
        if (!state) {
          check(!exists(path.dirname(targetPath(profile))) && !exists(path.join(profile, migratedJournal)), 'migration-target-exists')
          state = { version: 1, id: randomUUID(), digest: plan.digest, total: plan.commands.length, done: 0, phase: 'migrating' }
          save(state)
        }
        check(state.total === plan.commands.length, 'migration-preview-changed')
        const targetFile = targetPath(profile)
        fs.mkdirSync(path.dirname(targetFile), { recursive: true })
        target = createNoteV2Store(workerConfig(resources, targetFile), () => {}, { readData, isSubjectConfirmed: confirmed })
        await target.open()
        const barriers = [...plan.barriers.sources.map(key => 'evidence:' + key), ...plan.barriers.sessions.map(key => 'session:' + key)]
        for (let i = 0; i < barriers.length; i += 32) await target.installErasureBarriers(barriers.slice(i, i + 32))
        for (const [index, draft] of plan.commands.entries()) {
          const command = { ...draft, operationId: asUuid(hash([state.id, draft.id])) }
          const receipt = await target.applyNoteOperation(command)
          check(receipt.fingerprint === operationFingerprint(command) && receipt.affectedNotes.length === 1
            && receipt.affectedNotes[0].id === command.id && receipt.affectedNotes[0].version === 1, 'migration-receipt-mismatch')
          if (index >= state.done) { state.done = index + 1; save(state) }
          checkpoint('imported')
        }
        state.phase = 'validating'
        save(state)
        const heads = await collect(after => target.listRecallHeads(after), 'notes', 1536)
        const expected = new Map(plan.commands.map(command => [command.id, command]))
        const all = await collect(after => target.listNoteHeads(after), 'notes', 1536)
        check(heads.length === expected.size && all.length === expected.size, 'migration-verification-failed')
        for (const { note, grounds, cumulativeEvidence } of heads) {
          const command = expected.get(note.id)
          const { id, createdAt, status, version, ...meaning } = note
          check(command && status === 'active' && version === 1 && isDeepStrictEqual(command.meaning, meaning)
            && isDeepStrictEqual(keys(command.sources.evidence), keys(grounds.evidence))
            && isDeepStrictEqual(keys([...command.sources.evidence, ...command.contextEvidence]), keys(cumulativeEvidence)), 'migration-verification-failed')
        }
        await target.close()
        target = undefined
        const verified = await scan()
        check(verified.summary.canMigrate && verified.digest === state.digest, 'migration-preview-changed')
        durable(path.join(profile, migratedJournal), JSON.stringify({ version: 2, pending: [], blocked: plan.barriers }))
        state.phase = 'validated'
        save(state)
        checkpoint('validated')
        check(!exists(mode), 'migration-authority-conflict')
        durable(mode, authority)
        return { phase: 'committed', busy: false, done: state.done, total: state.total }
      } catch (error) {
        failed = true
        throw error
      } finally {
        try { if (target) await target.close() }
        finally { busy = false }
      }
    },
  }
}

module.exports = { createMemoryMigration }
