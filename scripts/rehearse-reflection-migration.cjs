// P4-A only: reviewed operations may write exclusively to a marked artifacts copy.
const fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto')
const { createNoteV2Store } = require('../apps/stage-desktop/memory-database/store.cjs')
const { sourceMessageLookup } = require('../apps/stage-desktop/memory-evidence.cjs')
const { validRuntimeOperation, operationFingerprint, uuid } = require('../apps/stage-desktop/memory-database/note-v1.cjs')
const { sameRecognition } = require('../apps/stage-desktop/note-organization-v2.mjs')
const { durable } = require('../apps/stage-desktop/memory-files.cjs')
const { inventory } = require('./unify-memory-profile.cjs')
const root = path.resolve(__dirname, '../artifacts/memory-v0.4.0-p4a')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const check = (value, message) => { if (!value) throw new Error(message) }

async function rehearse({ profile, manifest, resources, checkpoint = () => {} }) {
  check(path.isAbsolute(profile) && fs.realpathSync(profile) === profile && profile.startsWith(root + path.sep), 'P4-A requires an isolated artifacts profile')
  const marker = json(path.join(profile, '.p4a-isolated-profile.json'))
  check(manifest.version === 1 && uuid(manifest.id) && marker.id === manifest.id && marker.role === 'isolated-rehearsal', 'Invalid rehearsal marker/manifest')
  // Reject nested junctions and hard links before a Worker can follow them outside the copy.
  const files = inventory(profile)
  check(manifest.reviewStatus === 'codex-reviewed-awaiting-user' && Array.isArray(manifest.records) && Array.isArray(manifest.operations), 'Review manifest required')
  const ids = new Set(manifest.records.map(r => r.reflectionId)), operations = manifest.operations
  const originals = json(path.join(profile, 'legacy-profile-archive/aisling-reflections.v1.json')).reflections
  check(originals.length === ids.size && originals.every(r => manifest.records.some(row => row.reflectionId === r.id && row.originalReflectionDigest === digest(r))), 'Reflection review incomplete or original changed')
  check(ids.size === manifest.records.length && operations.every(item => uuid(item.operation?.operationId)
    && ['ADD', 'NOOP'].includes(item.operation.action) && validRuntimeOperation(item.operation)
    && item.reviewIds?.length && item.reviewIds.every(id => manifest.records.some(r => r.reviewId === id && r.category === 'A'))), 'Unreviewed or invalid operation')
  check(new Set(operations.map(item => item.operation.operationId)).size === operations.length, 'Duplicate operation IDs')
  for (const item of operations) {
    const reviewed = manifest.records.filter(r => item.reviewIds.includes(r.reviewId))
    check(item.operation.sources.evidence.every(ref => reviewed.some(r => r.approvedRefs?.some(allowed => digest(allowed) === digest(ref))))
      && (item.operation.contextEvidence ?? []).every(ref => reviewed.some(r => r.approvedContext?.some(allowed => digest(allowed) === digest(ref)))), 'Operation uses unreviewed evidence')
  }
  const file = path.join(profile, 'p4a-rehearsal-journal.json'), fingerprint = digest(manifest)
  const journal = fs.existsSync(file) ? json(file) : { version: 1, manifest: fingerprint, completed: [] }
  check(journal.manifest === fingerprint, 'Manifest changed after rehearsal started')
  const save = () => durable(file, JSON.stringify(journal, null, 2))
  if (!fs.existsSync(file)) {
    check(Array.isArray(manifest.snapshotFiles) && manifest.snapshotFiles.length > 0, 'Snapshot manifest required')
    for (const item of manifest.snapshotFiles) {
      check(!path.isAbsolute(item.name) && !item.name.split(/[\\/]/).includes('..'), 'Unsafe snapshot path')
      check(files.some(file => file.name === item.name && file.sha256 === item.sha256), 'Rehearsal snapshot differs')
    }
    save()
  }
  const readData = () => json(path.join(profile, 'aisling-store.json'))
  const store = createNoteV2Store(async () => ({ node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'),
    file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }), () => {}, { readData, isSubjectConfirmed: subject => subject === 'profile-user' })
  let applied = 0, reused = 0
  try {
    await store.open()
    for (const [index, item] of operations.entries()) {
      const op = item.operation, lookup = sourceMessageLookup(readData())
      check(op.sources.evidence.every(ref => lookup(ref)?.role === 'user') && (op.contextEvidence ?? []).every(lookup), 'Migration source missing/changed or not user evidence')
      const receipt = await store.getOperationReceipt(op.operationId)
      if (receipt) { check(receipt.fingerprint === operationFingerprint(op), 'Receipt conflict'); reused++ }
      else {
        if (op.action === 'ADD') {
          let cursor = ''
          do {
            const page = await store.listRecallHeads(cursor)
            check(!page.notes.some(head => sameRecognition(head.note, op.meaning)), 'Duplicate recognition requires manifest review')
            cursor = page.nextCursor
          } while (cursor)
        }
        checkpoint('before-operation', index)
        await store.applyNoteOperation(op); applied++
        checkpoint('after-commit', index)
      }
      if (!journal.completed.includes(op.operationId)) journal.completed.push(op.operationId)
      save()
    }
    return { applied, reused, completed: journal.completed.length, manifest: fingerprint }
  } finally { await store.close() }
}

module.exports = { rehearse, digest }
if (require.main === module) {
  const [manifestFile, profile, resources] = process.argv.slice(2)
  Promise.resolve().then(() => rehearse({ manifest: json(path.resolve(manifestFile)), profile: path.resolve(profile), resources: path.resolve(resources) }))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
