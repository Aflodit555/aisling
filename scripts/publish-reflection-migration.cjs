// One-shot P4-B maintenance; ordinary applications never import this entry.
const fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { inventory, same, save } = require('./unify-memory-profile.cjs')
const { readUnifiedProfile, maintenanceFile } = require('../apps/stage-desktop/desktop-profile.cjs')
const { createNoteV2Store } = require('../apps/stage-desktop/memory-database/store.cjs')
const { sourceMessageLookup } = require('../apps/stage-desktop/memory-evidence.cjs')
const { validRuntimeOperation, operationFingerprint, uuid } = require('../apps/stage-desktop/memory-database/note-v1.cjs')
const { parseNoteProposals } = require('../apps/stage-desktop/note-formation-contract.mjs')
const { authorizeOrganization, sameRecognition } = require('../apps/stage-desktop/note-organization-v2.mjs')
const { registerNotes } = require('../apps/stage-desktop/note-formation.cjs')
const speakers = require('../apps/stage-desktop/memory-subjects.json')
const root = path.resolve(__dirname, '../artifacts/memory-v0.4.0-p4b')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const check = (value, reason) => { if (!value) throw new Error(reason) }
const inside = dir => path.isAbsolute(dir) && fs.realpathSync(dir) === dir && dir.startsWith(root + path.sep)
const databaseFile = name => /^memory-note-v2[\\/]/.test(name)
const jobsName = 'note-formation-jobs.v1.json'
const serialized = value => JSON.stringify(value, null, 2)
const bytesHash = value => createHash('sha256').update(value).digest('hex')
function importedJobs(backup, notes) {
  const original = json(path.join(backup, jobsName)), next = structuredClone(original)
  registerNotes(next, notes)
  check(original.organization.tasks.every(task => next.organization.tasks.some(row => isDeepStrictEqual(row, task))), 'Import must preserve all existing organization tasks')
  next.embeddingPriority = [...new Set([...notes.map(note => note.id), ...(next.embeddingPriority ?? [])])]
  check(next.embeddingPriority.length <= 64 && Buffer.byteLength(serialized(next)) <= 2_000_000, 'Imported jobs exceed existing capacity')
  return next
}

async function publish({ plan, mode, checkpoint = () => {} }) {
  check(plan.version === 1 && uuid(plan.id) && plan.kind === 'p4b-reviewed-reflection-migration'
    && inside(plan.run) && ['rehearse', 'publish'].includes(mode), 'Invalid P4-B plan/mode')
  const profile = mode === 'publish' ? plan.profile : plan.rehearsalProfile, fingerprint = digest(plan)
  check(path.isAbsolute(profile) && fs.realpathSync(profile) === profile && profile !== plan.run, 'Noncanonical migration destination')
  if (mode === 'publish') {
    const guard = json(path.join(profile, maintenanceFile))
    check(!inside(profile) && readUnifiedProfile(profile) && guard.kind === plan.kind && guard.id === plan.id
      && guard.manifest === fingerprint && guard.token === process.env.AISLING_P4B_OFFLINE_LOCK, 'Offline maintenance wrapper required')
    const proof = json(path.join(plan.run, 'rehearsal-verified.json'))
    check(proof.manifest === fingerprint && proof.complete && proof.integrity && proof.idempotent && proof.recovery, 'Fresh verified rehearsal required')
  } else {
    check(inside(profile), 'Rehearsal requires an artifacts copy')
    const marker = json(path.join(profile, '.p4b-isolated-profile.json'))
    check(marker.id === plan.id && marker.role === 'isolated-p4b-rehearsal', 'Invalid P4-B rehearsal marker')
  }
  const files = inventory(profile)
  check(files.every(file => plan.sourceFiles.some(original => original.name === file.name) || databaseFile(file.name)
    || file.name === maintenanceFile || file.name === '.p4b-isolated-profile.json'), 'Unexpected profile files; audit before resuming')
  const backup = plan.backupProfile ?? path.join(plan.run, 'backup/profile')
  check(inside(backup) && backup !== profile, 'Invalid independent backup')
  same(backup, plan.sourceFiles)
  if (plan.postCommit?.registerImportedNotes) importedJobs(backup, plan.operations.map(item => ({ id: item.operation.id, version: 1 })))
  const originals = json(path.join(profile, 'legacy-profile-archive/aisling-reflections.v1.json')).reflections
  check(new Set(plan.records.map(r => r.reflectionId)).size === originals.length && plan.records.length === originals.length
    && originals.every(r => plan.records.some(row => row.reflectionId === r.id && row.originalReflectionDigest === digest(r))), 'Reflection review incomplete/changed')
  check(new Set(plan.operations.map(item => item.operation.operationId)).size === plan.operations.length, 'Duplicate operation IDs')
  for (const item of plan.operations) {
    const op = item.operation, rows = plan.records.filter(r => item.reviewIds?.includes(r.reviewId))
    check(op.action === 'ADD' && validRuntimeOperation(op) && op.meaning.subject === speakers.user.subject
      && rows.length === item.reviewIds.length && rows.every(r => r.category === 'A'), 'Unreviewed migration operation')
    for (const [refs, key] of [[op.sources.evidence, 'approvedRefs'], [op.contextEvidence ?? [], 'approvedContext']])
      check(refs.every(ref => rows.some(row => row[key]?.some(allowed => isDeepStrictEqual(allowed, ref)))), 'Unreviewed migration source')
  }
  const journalFile = path.join(plan.run, mode + '-journal.json')
  const journal = fs.existsSync(journalFile) ? json(journalFile) : { version: 1, manifest: fingerprint, outcomes: [] }
  check(journal.manifest === fingerprint, 'Publish manifest changed after starting')
  const queuedHash = plan.postCommit?.registerImportedNotes && journal.databaseComplete
    ? bytesHash(serialized(importedJobs(backup, journal.importedNotes))) : undefined
  for (const item of plan.sourceFiles.filter(file => !fs.existsSync(journalFile) || !databaseFile(file.name)))
    check(files.some(file => file.name === item.name && (file.sha256 === item.sha256
      || item.name === jobsName && queuedHash && file.sha256 === queuedHash)), 'Frozen source changed; re-audit required')
  check(json(path.join(profile, 'memory-erasure.v1.json')).pending.length === 0, 'Deletion recovery pending')
  save(journalFile, journal)
  const readData = () => json(path.join(profile, 'aisling-store.json'))
  const store = createNoteV2Store(async () => ({ node: path.join(plan.resources, 'runtime/node.exe'), entry: path.join(plan.resources, 'worker.cjs'),
    file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }), () => {}, { readData, isSubjectConfirmed: subject => subject === speakers.user.subject })
  let applied = 0, reused = 0, covered = 0
  try {
    await store.open()
    for (const [index, item] of plan.operations.entries()) {
      const op = item.operation, lookup = sourceMessageLookup(readData()), refs = [...op.sources.evidence, ...(op.contextEvidence ?? [])]
      check(op.sources.evidence.every(ref => lookup(ref)?.role === 'user') && refs.every(lookup), 'Source missing/changed or not user evidence')
      const context = { speakers, notes: [], candidatesComplete: true,
        evidence: refs.map(ref => ({ ref, message: lookup(ref), scope: 'current' })) }
      const proposal = parseNoteProposals(JSON.stringify({ items: [item.wire] }), context)[0]
      check(isDeepStrictEqual(proposal.draft?.meaning, op.meaning) && proposal.draft.confirmed
        && proposal.action === op.action && proposal.target === null
        && isDeepStrictEqual(proposal.draft.citations.map(c => c.ref), refs), 'Proposal differs from frozen operation/evidence')
      const heads = []; let cursor = ''
      do { const page = await store.listRecallHeads(cursor); heads.push(...page.notes); cursor = page.nextCursor } while (cursor)
      const automatic = authorizeOrganization(proposal, { heads, complete: true, lookup })
      const approved = item.approved && item.approved.operationId === op.operationId && item.approved.noteId === op.id
        && item.approved.fingerprint === operationFingerprint(op) && item.approved.content === op.meaning.content
        && plan.approval.answer === '明确批准两条迁移' && plan.approval.operations.some(a => isDeepStrictEqual(a, item.approved))
      const receipt = await store.getOperationReceipt(op.operationId)
      if (receipt) { check(receipt.fingerprint === operationFingerprint(op), 'Receipt conflict'); reused++ }
      else {
        const duplicate = heads.find(head => sameRecognition(head.note, op.meaning))
        if (duplicate) { covered++; journal.outcomes[index] = { operationId: op.operationId, status: 'covered', noteId: duplicate.note.id }; save(journalFile, journal); continue }
        check(automatic || approved, 'Explicit approval required; automatic policy unchanged')
        checkpoint('before-operation', index)
        await store.applyNoteOperation(op); applied++
        checkpoint('after-commit', index)
      }
      journal.outcomes[index] = { operationId: op.operationId, noteId: op.id, status: receipt ? 'receipt-confirmed' : 'committed', authorization: approved ? 'user-approved' : 'automatic' }
      save(journalFile, journal)
    }
    if (plan.postCommit?.registerImportedNotes) {
      const notes = []
      for (const item of plan.operations) {
        const receipt = await store.getOperationReceipt(item.operation.operationId)
        if (!receipt) continue
        check(receipt.fingerprint === operationFingerprint(item.operation), 'Receipt changed before queue registration')
        notes.push(...receipt.affectedNotes.map(note => ({ id: note.id, version: note.version })))
      }
      journal.importedNotes = notes; journal.databaseComplete = true; save(journalFile, journal)
      if (notes.length) save(path.join(profile, jobsName), importedJobs(backup, notes))
      checkpoint('after-jobs', 0)
    }
    journal.complete = true; save(journalFile, journal)
    return { manifest: fingerprint, applied, reused, covered, complete: true }
  } finally { await store.close() }
}

module.exports = { publish, digest }
if (require.main === module) {
  const [file, mode] = process.argv.slice(2)
  Promise.resolve().then(() => publish({ plan: json(path.resolve(file)), mode })).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
