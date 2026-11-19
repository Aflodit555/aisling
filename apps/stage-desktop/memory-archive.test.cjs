const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { test } = require('node:test'), { randomUUID } = require('node:crypto')
const { profileArchive } = require('./memory-archive.cjs')
const { messageDigest } = require('./memory-evidence.cjs')
function fixture() {
  const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p4b/tests'); fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'archive-'))), file = path.join(profile, 'aisling-reflections.v1.json')
  const message = { role: 'user', content: 'Synthetic archived source' }, ref = { sessionId: 'source', messageIndex: 0, digest: messageDigest(message) }
  fs.writeFileSync(path.join(profile, 'aisling-store.json'), JSON.stringify({ 'aisling.conversations.v1': JSON.stringify({ sessions: [{ id: ref.sessionId, messages: [message] }] }) }))
  fs.writeFileSync(file, JSON.stringify({ version: 1, reflections: [{ id: 'old', sourceRefs: [ref], relatedReflectionIds: [], content: 'Synthetic archived recognition' }], progress: [], batches: [] }))
  const archive = profileArchive(profile, path.join(profile, 'not-opened-worker'))
  const steps = [{ operationId: randomUUID(), evidence: [], sessionIds: [ref.sessionId], originIds: [] }]
  return { profile, file, archive, steps }
}

test('archive deletion retains atomic write failure protection and resumes the durable erase intent', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(), before = fs.readFileSync(f.file, 'utf8'), mode = fs.statSync(f.file).mode
  fs.chmodSync(f.file, mode & ~0o222)
  try {
    await assert.rejects(f.archive.erase(f.steps), /EPERM|EACCES/)
    assert.equal(fs.readFileSync(f.file, 'utf8'), before)
    assert(f.archive.privacy.pending())
  } finally { fs.chmodSync(f.file, mode) }
  await f.archive.erase(f.steps)
  assert.equal(JSON.parse(fs.readFileSync(f.file)).reflections.length, 0)
  assert.equal(f.archive.privacy.pending(), false)
})

test('corrupt, unreadable or future archives cannot be silently overwritten during privacy cleanup', async () => {
  for (const old of ['{broken', JSON.stringify({ version: 2, reflections: [], progress: [], batches: [] })]) {
    const f = fixture(); fs.writeFileSync(f.file, old)
    await assert.rejects(f.archive.erase(f.steps))
    assert.equal(fs.readFileSync(f.file, 'utf8'), old)
  }
  const f = fixture(), before = fs.readFileSync(f.file, 'utf8'), originalRead = fs.readFileSync
  fs.readFileSync = function (file, ...args) {
    if (file === f.file) throw Object.assign(new Error('Synthetic unreadable archive'), { code: 'EACCES' })
    return originalRead.call(this, file, ...args)
  }
  try { await assert.rejects(f.archive.erase(f.steps), { code: 'EACCES' }) }
  finally { fs.readFileSync = originalRead }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
})
