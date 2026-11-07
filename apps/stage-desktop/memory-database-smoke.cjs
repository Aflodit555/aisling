const assert = require('node:assert/strict')
const { app } = require('electron')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { startDesktop } = require('./desktop-app.cjs')
const { writeFixture, verifyFixture } = require('./memory-database/contract-fixture.cjs')

assert.equal(process.type, 'browser')
const phase = process.env.AISLING_P0_SMOKE_PHASE
assert(['off', 'write', 'reopen', 'worker-kill', 'parent-kill'].includes(phase))
app.setPath('userData', process.env.AISLING_P0_SMOKE_BASE_PROFILE)
app.setPath('sessionData', process.env.AISLING_P0_SMOKE_BASE_PROFILE)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
const timeout = setTimeout(() => { console.error('P0 smoke timed out'); app.exit(1) }, 45000)
let store, ready, worker, samples
console.log(JSON.stringify({ event: 'main', phase, pid: process.pid, type: process.type,
  electron: process.versions.electron, node: process.versions.node }))

;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false,
    onMemoryDatabase(value, startup) { store = value; ready = startup },
    memoryDatabaseDiagnostic(event, detail) {
      if (event === 'ready') worker = detail
      if (event === 'timing') samples?.push(detail)
    },
  })
  const contents = win.contentView.children[0].webContents
  const stage = await contents.executeJavaScript(`(async () => {
    for (let i = 0; i < 150; i++) {
      if (document.querySelector('.stage')) {
        return { origin: location.origin, legacy: !!window.aislingDesktop?.storage, db: 'memoryDatabase' in window.aislingDesktop }
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  })()`)
  assert.deepEqual(stage, { origin: 'aisling://stage', legacy: true, db: false })

  if (phase === 'off') {
    assert.equal(store, undefined)
    assert.equal(ready, undefined)
    assert.equal(existsSync(join(app.getPath('userData'), 'memory-db-p0')), false)
  }
  else {
    await ready
    assert(worker && worker.pid !== process.pid && worker.node === '24.12.0' && worker.ladybug === '0.22.1')
    assert.equal(store.status(), 'ready')
    await store.open()
    if (phase === 'write') await writeFixture(store)
    await verifyFixture(store)
    if (phase === 'worker-kill') {
      const previous = worker.pid
      process.kill(previous, 'SIGKILL')
      for (let index = 0; store.status() !== 'failed' && index < 150; index++) await sleep(25)
      assert.equal(store.status(), 'failed')
      await assert.rejects(store.getNote('a'), { code: 'worker-unavailable' })
      await store.open()
      assert.notEqual(worker.pid, previous)
      await verifyFixture(store)
      console.log(JSON.stringify({ event: 'host-reopen-after-worker-exit', previous, next: worker.pid }))
    }
    if (phase === 'parent-kill') {
      console.log(JSON.stringify({ event: 'parent-kill-ready', workerPid: worker.pid }))
      return
    }
    samples = []
    for (let index = 0; index < 12; index++) {
      await store.getNote('a')
      await store.getRelatedNotes('a', 1)
      await store.getRelatedNotes('a', 2)
    }
    console.log(JSON.stringify({ event: 'samples', samples }))
  }
  console.log(JSON.stringify({ result: 'pass', phase, workerPid: worker?.pid, profile: app.getPath('userData') }))
  clearTimeout(timeout)
  app.quit()
})().catch(async error => {
  console.error(error)
  clearTimeout(timeout)
  await store?.close().catch(() => {})
  app.exit(1)
})
