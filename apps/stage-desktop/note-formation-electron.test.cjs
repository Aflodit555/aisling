const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { sourceMessageLookup } = require('./memory-evidence.cjs')

const prepared = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
test('real Stage delivery through isolated Note Formation, Main, Worker and restart', {
  skip: !prepared && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to prepared Worker resources',
  timeout: 220_000,
}, async () => {
  const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p1')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'electron-')))
  const resources = path.join(profile, 'resources')
  fs.cpSync(prepared, resources, { recursive: true })
  fs.writeFileSync(path.join(profile, '.note-formation-test'), 'aisling-note-formation-p1-fixture\n')
  const entry = path.join(resources, 'worker.cjs')
  fs.renameSync(entry, path.join(resources, 'worker-real.cjs'))
  fs.writeFileSync(entry, [
    "const fs = require('node:fs')",
    'const marker = ' + JSON.stringify(path.join(profile, 'worker-commit-reply-lost')),
    'const send = process.stdout.write.bind(process.stdout)',
    'process.stdout.write = (line, callback) => {',
    '  const packet = JSON.parse(line)',
    "  if (packet.ok && packet.result?.action === 'SUPERSEDE' && !fs.existsSync(marker)) {",
    "    fs.writeFileSync(marker, 'committed')",
    '    process.exit(81)',
    '  }',
    '  return send(line, callback)',
    '}',
    "require('./worker-real.cjs')",
  ].join('\n'))
  const electron = require('electron')
  const pids = []
  const launch = phase => {
    const result = spawnSync(electron, [path.join(__dirname, 'note-formation-smoke.cjs'), phase, profile, resources], {
      cwd: __dirname, windowsHide: true, encoding: 'utf8', timeout: 78_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(name))),
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr)
    const line = result.stdout.split(/\r?\n/).find(line => line.includes('"result":"note-formation-passed"'))
    assert(line, result.stdout + '\n' + result.stderr)
    pids.push(JSON.parse(line).pid)
  }
  for (const phase of ['default', 'write', 'reopen']) launch(phase)
  assert.equal(new Set(pids).size, 3)
  assert(fs.existsSync(path.join(profile, 'worker-commit-reply-lost')))
  const batches = JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8')).batches
  const [pattern, fact, review] = batches[1].items
  const replacement = batches[6].items[0]
  const readData = () => JSON.parse(fs.readFileSync(path.join(profile, 'aisling-store.json'), 'utf8'))
  const store = createNoteV2Store(async () => ({ node: path.join(resources, 'runtime', 'node.exe'), entry,
    file: path.join(profile, 'memory-note-v2', 'note-v2.lbdb') }), () => {}, { readData, isSubjectConfirmed: id => id === 'profile-user' })
  try {
    await store.open()
    const learned = await store.getRevision(pattern.noteId, 1)
    assert.equal(learned.snapshot.kind, 'pattern')
    assert.equal(learned.snapshot.basis, 'inferred')
    assert.equal(new Set(learned.grounds.evidence.map(ref => ref.sessionId)).size, 2)
    assert(learned.grounds.evidence.every(sourceMessageLookup(readData())))
    const original = await store.getRevision(fact.noteId, 1)
    assert.match(original.snapshot.content, /去年未买.*现在已买.*尚未开始/)
    assert.equal(original.snapshot.eventTime, null)
    assert.equal((await store.getRevision(fact.noteId, 2)).snapshot.content, '用户报告手碟已购买并开始练习。')
    assert.equal((await store.getVersionSourceChanges(fact.noteId, 2)).changes.length, 1)
    assert.equal((await store.getRevision(fact.noteId, 3)).successorId, replacement.noteId)
    assert.equal((await store.getNoteV2(fact.noteId)).status, 'superseded')
    assert.equal((await store.getNoteV2(replacement.noteId)).status, 'active')
    assert.equal((await store.getOperationReceipt(replacement.operationId)).affectedNotes.length, 2)
    assert.equal(await store.getNoteV2(review.noteId), null)
    assert.equal((await store.listRecallHeads()).notes.length, 2)
  } finally { await store.close() }
  launch('erase')
})
