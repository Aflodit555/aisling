const assert = require('node:assert/strict')
const { app } = require('electron')
const { existsSync, realpathSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { attachMemoryDatabase } = require('./memory-database/host.cjs')
const { writeNoteFixture, verifyNoteFixture } = require('./memory-database/note-v1-fixture.cjs')

assert.equal(process.type, 'browser')
assert.equal(process.versions.electron, '44.4.3')
const { AISLING_NOTE_TEST_ROOT: root, AISLING_NOTE_TEST_PHASE: phase } = process.env
assert(['write', 'reopen'].includes(phase))
assert.equal(root, realpathSync(root))
assert.equal(readFileSync(join(root, 'synthetic-test'), 'utf8'), 'note-v1 smoke')
assert.equal(process.env.AISLING_MEMORY_DB_P0_PROFILE, realpathSync(join(root, 'note-profile')))
assert.equal(process.env.AISLING_MEMORY_DB_P0_RESOURCES, realpathSync(join(root, 'resources')))
for (const name of ['userData', 'sessionData']) app.setPath(name, join(root, 'base-profile'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
const timeout = setTimeout(() => app.exit(1), 45000)
let db
;(async () => {
  let worker
  db = attachMemoryDatabase(app, (event, detail) => { if (event === 'ready') worker = detail }, true)
  app.on('before-quit', db.deferQuit)
  await app.whenReady()
  await db.ready
  const profile = app.getPath('userData')
  assert.equal(profile, join(root, 'note-profile'))
  assert(worker.pid !== process.pid && worker.schema === 'note-v1' && worker.node === '24.12.0' && worker.ladybug === '0.22.1')
  assert.equal(worker.exe.toLowerCase(), join(root, 'resources', 'runtime', 'node.exe').toLowerCase())
  assert.equal(existsSync(join(profile, 'memory-note-v1', 'note-v1.lbdb')), true)
  assert.equal(existsSync(join(profile, 'memory-db-p0')), false)
  await (phase === 'write' ? writeNoteFixture : verifyNoteFixture)(db.store)
  console.log(JSON.stringify({ result: 'note-v1-passed', phase, electron: process.versions.electron,
    mainPid: process.pid, workerPid: worker.pid, profile, schema: worker.schema }))
  clearTimeout(timeout)
  app.quit()
})().catch(async error => {
  console.error(error)
  clearTimeout(timeout)
  await db?.store.close().catch(() => {})
  app.exit(1)
})
