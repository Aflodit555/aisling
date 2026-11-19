const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto'), { test } = require('node:test'), { spawnSync } = require('node:child_process')
const { createNoteV2Store } = require('./memory-database/store.cjs'), { messageDigest } = require('./memory-evidence.cjs')
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared isolated Worker required', timeout: 140000 }
async function fixture() {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p4b/tests'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'privacy-')))
  const a = { id: 'source-a', title: 'synthetic', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: '灯塔 source-private 报告。' }] }
  const b = { ...a, id: 'source-b', messages: [{ role: 'user', content: '灯塔 public-retained 报告。' }] }
  const ref = s => ({ sessionId: s.id, messageIndex: 0, digest: messageDigest(s.messages[0]) }), ra = ref(a), rb = ref(b)
  const data = { 'aisling.conversations.v1': JSON.stringify({ sessions: [a, b], activeId: b.id }),
    'aisling.config.v1': JSON.stringify({ memory: { enabled: true, formationEnabled: false, noteRecallEnabled: true }, consciousness: {} }) }
  const write = (name, value) => fs.writeFileSync(path.join(profile, name), typeof value === 'string' ? value : JSON.stringify(value))
  write('.privacy-test', 'aisling-p4b-synthetic\n'); write('memory-authority', 'note-v2\n'); write('aisling-store.json', data)
  fs.mkdirSync(path.join(profile, 'memory-note-v2'))
  const admin = () => createNoteV2Store(async () => ({ node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'), file: path.join(profile, 'memory-note-v2/note-v2.lbdb') }), () => {}, { readData: () => data, isSubjectConfirmed: () => true })
  const op = (text, evidence, contextEvidence = []) => ({ action: 'ADD', id: randomUUID(), operationId: randomUUID(), reason: 'Synthetic source closure',
    meaning: { subject: 'profile-user', kind: 'fact', basis: 'direct', eventTime: null, content: text }, sources: { evidence }, contextEvidence })
  const privateNote = op('灯塔 source-private 报告。', [ra], [rb]), retained = op('灯塔 public-retained 报告。', [rb])
  const store = admin(); try { await store.open(); await store.applyNoteOperation(privateNote); await store.applyNoteOperation(retained) } finally { await store.close() }
  write('note-formation-jobs.v1.json', { version: 1, progress: {}, batches: [] })
  fs.mkdirSync(path.join(profile, 'legacy-profile-archive'))
  write('legacy-profile-archive/aisling-store.json', data)
  write('legacy-profile-archive/aisling-reflections.v1.json', { version: 1, progress: [], batches: [], reflections: [
    { id: 'private-origin', sourceRefs: [ra], relatedReflectionIds: [], content: 'NEVER-INJECT-ARCHIVE-private' },
    { id: 'retained-origin', sourceRefs: [rb], relatedReflectionIds: [], content: 'NEVER-INJECT-ARCHIVE-public' },
  ] })
  write('memory-profile-unification.v1.json', { version: 1, id: randomUUID(), phase: 'committed', manifest: 'a'.repeat(64), archive: 'legacy-profile-archive' })
  write('fixture.private.json', { data })
  return { profile, admin, privateNote, retained }
}
function launch(f, phase) {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'memory-lifecycle-smoke.cjs'), f.profile, resources, phase], {
    cwd: __dirname, windowsHide: true, encoding: 'utf8', timeout: 60000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(name))),
  })
  assert.ifError(result.error); assert.equal(result.status, phase === 'intent' ? 74 : 0, result.stdout + result.stderr)
  if (phase !== 'intent') assert.match(result.stdout, /p4b-privacy-passed/)
}
for (const phases of [['erase'], ['intent', 'resume']]) test('retired Runtime retains current IPC, archive erasure and Receipt barriers: ' + phases.join('/'), native, async () => {
  const f = await fixture(); for (const phase of phases) launch(f, phase)
  const store = f.admin(); try {
    await store.open(); assert.equal(await store.getNoteV2(f.privateNote.id), null); assert.equal(await store.getRevision(f.privateNote.id, 1), null)
    assert.equal(await store.getOperationReceipt(f.privateNote.operationId), null)
    if (phases[0] === 'erase') assert.equal((await store.getNoteV2(f.retained.id)).content, f.retained.meaning.content)
    await assert.rejects(store.applyNoteOperation(f.privateNote), { code: 'erased' })
  } finally { await store.close() }
})
