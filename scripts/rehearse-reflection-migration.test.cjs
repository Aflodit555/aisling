const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto'), { test } = require('node:test')
const { rehearse, digest } = require('./rehearse-reflection-migration.cjs')
const { messageDigest } = require('../apps/stage-desktop/memory-evidence.cjs')
const { createNoteV2Store } = require('../apps/stage-desktop/memory-database/store.cjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 60000 }
async function fixture() {
  const root = path.resolve(__dirname, '../artifacts/memory-v0.4.0-p4a/tests'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'review-'))), id = randomUUID()
  const message = { role: 'user', content: '我喜欢安静的房间。' }, ref = { sessionId: 'synthetic', messageIndex: 0, digest: messageDigest(message) }
  const data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [{ id: ref.sessionId, messages: [message] }] }) }
  const raw = path.join(profile, 'aisling-store.json'); fs.writeFileSync(raw, JSON.stringify(data))
  fs.writeFileSync(path.join(profile, 'memory-authority'), 'note-v2\n')
  fs.mkdirSync(path.join(profile, 'legacy-profile-archive')); const original = { id: randomUUID(), content: '用户说喜欢安静的房间。', sourceRefs: [ref] }
  fs.writeFileSync(path.join(profile, 'legacy-profile-archive/aisling-reflections.v1.json'), JSON.stringify({ version: 1, reflections: [original] }))
  fs.writeFileSync(path.join(profile, '.p4a-isolated-profile.json'), JSON.stringify({ id, role: 'isolated-rehearsal' }))
  fs.mkdirSync(path.join(profile, 'memory-note-v2'))
  const config = async () => ({ node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'), file: path.join(profile, 'memory-note-v2/note-v2.lbdb') })
  const readData = () => JSON.parse(fs.readFileSync(raw))
  const admin = () => createNoteV2Store(config, () => {}, { readData, isSubjectConfirmed: () => true })
  const seed = admin(); try { await seed.open() } finally { await seed.close() }
  const manifest = { version: 1, id, reviewStatus: 'codex-reviewed-awaiting-user',
    records: [{ reviewId: 'R01', reflectionId: original.id, originalReflectionDigest: digest(original), category: 'A', approvedRefs: [ref], approvedContext: [] }],
    snapshotFiles: [{ name: 'aisling-store.json', sha256: createHash('sha256').update(fs.readFileSync(raw)).digest('hex') }],
    operations: [{ reviewIds: ['R01'], operation: { action: 'ADD', id: randomUUID(), operationId: randomUUID(), reason: 'Synthetic manually reviewed user evidence',
      meaning: { subject: 'profile-user', content: message.content, kind: 'preference', basis: 'direct', eventTime: null }, sources: { evidence: [ref] }, contextEvidence: [] } }] }
  return { profile, manifest, admin }
}

test('rehearsal resumes a committed lost reply and repeated execution creates no duplicates', native, async () => {
  const f = await fixture()
  await assert.rejects(rehearse({ ...f, resources, checkpoint: phase => { if (phase === 'after-commit') throw Error('synthetic interruption') } }), /interruption/)
  assert.equal((await rehearse({ ...f, resources })).reused, 1)
  assert.equal((await rehearse({ ...f, resources })).applied, 0)
  const store = f.admin(); try { await store.open(); const page = await store.listRecallHeads(''); assert.equal(page.notes.length, 1); assert.equal(page.notes[0].note.version, 1) } finally { await store.close() }
  const changed = structuredClone(f.manifest); changed.operations[0].operation.meaning.content = 'changed'
  await assert.rejects(rehearse({ ...f, manifest: changed, resources }), /Manifest changed/)
})

test('formal/unmarked destinations, incomplete review, non-A operations and unreviewed sources fail closed', native, async () => {
  const f = await fixture()
  await assert.rejects(rehearse({ ...f, profile: path.resolve(__dirname, '..'), resources }), /isolated/)
  const missing = structuredClone(f.manifest); missing.records = []
  await assert.rejects(rehearse({ ...f, manifest: missing, resources }), /incomplete/)
  const notA = structuredClone(f.manifest); notA.records[0].category = 'D'
  await assert.rejects(rehearse({ ...f, manifest: notA, resources }), /Unreviewed/)
  const bad = structuredClone(f.manifest); bad.operations[0].operation.sources.evidence[0] = { ...bad.operations[0].operation.sources.evidence[0], digest: 'f'.repeat(64) }
  await assert.rejects(rehearse({ ...f, manifest: bad, resources }), /unreviewed evidence/)
  const altered = structuredClone(f.manifest); altered.records[0].originalReflectionDigest = '0'.repeat(64)
  await assert.rejects(rehearse({ ...f, manifest: altered, resources }), /original changed/)
  fs.linkSync(path.join(f.profile, 'aisling-store.json'), path.join(f.profile, 'shared-raw.json'))
  await assert.rejects(rehearse({ ...f, resources }), /shared file/)
  const linked = await fixture()
  fs.symlinkSync(path.join(linked.profile, 'legacy-profile-archive'), path.join(linked.profile, 'linked-archive'), 'junction')
  await assert.rejects(rehearse({ ...linked, resources }), /contains a link/)
})
