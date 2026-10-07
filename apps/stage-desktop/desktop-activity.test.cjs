const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { test } = require('node:test')
const { createDesktopObserver, normalizeKernelState } = require('./desktop-activity.cjs')

const packet = (sequence = null) => ({
  capturedAt: 1_800_000_000_000, targetHwnd: '18446744073709551615', sequence,
  idle_s: 2, focus: { app: 'Code', title: 'test', text: 'screen' },
})

function setup(t) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stdin = new PassThrough()
  child.kill = () => true
  const requests = []
  child.stdin.on('data', bytes => requests.push(bytes.toString()))
  const observer = createDesktopObserver({ ownPid: 123, spawnImpl: (_executable, args) => {
    assert.deepEqual(args, ['123'], 'no kernel polling argument')
    return child
  } })
  t.after(() => {
    observer.stop()
    child.stdout.destroy()
    child.stdin.destroy()
  })
  observer.start()
  return { observer, child, requests, emit: value => child.stdout.write(`${JSON.stringify(value)}\n`) }
}

test('capture metadata is preserved and invalid/legacy metadata is rejected', () => {
  const context = normalizeKernelState(packet())
  assert.equal(context.capturedAt, packet().capturedAt)
  assert.equal(context.targetHwnd, packet().targetHwnd)
  assert.equal(context.sequence, null)
  assert.equal(context.focus.text, 'screen')
  for (const value of [
    {}, { ...packet(), capturedAt: undefined }, { ...packet(), capturedAt: -1 },
    { ...packet(), targetHwnd: 123 }, { ...packet(), sequence: '1' }, { ...packet(), sequence: 0 },
  ])
    assert.throws(() => normalizeKernelState(value), /invalid snapshot metadata/)
})

test('startup, mismatched and invalid reports cannot satisfy a request', async (t) => {
  const { observer, child, requests, emit } = setup(t)
  const pending = observer.request()
  let settled = false
  void pending.then(() => { settled = true })
  assert.deepEqual(requests, ['1\n'])
  await assert.rejects(observer.request(), /already in flight/)
  emit(packet())
  emit(packet(99))
  child.stdout.write('invalid JSON\n')
  emit({ ...packet(1), capturedAt: undefined })
  await Promise.resolve()
  assert.equal(settled, false)
  emit(packet(1))
  emit(packet(100))
  assert.equal((await pending).sequence, 1, 'return the matched snapshot, not a later cached report')
  assert.equal(observer.status().context.sequence, 100)
})

test('timeout rejects; a late reply cannot satisfy the next request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { observer, requests, emit } = setup(t)
  emit(packet())
  const timedOut = assert.rejects(observer.request(), /timed out/)
  t.mock.timers.tick(5000)
  await timedOut

  const pending = observer.request()
  let settled = false
  void pending.then(() => { settled = true })
  emit(packet(1))
  await Promise.resolve()
  assert.equal(settled, false)
  emit(packet(2))
  assert.equal((await pending).sequence, 2)
  assert.deepEqual(requests, ['1\n', '2\n'])
})

test('stop and child exit reject an in-flight request', async (t) => {
  const { observer, child } = setup(t)
  const stopped = assert.rejects(observer.request(), /stopped/)
  observer.stop()
  await stopped
  observer.start()
  const exited = assert.rejects(observer.request(), /stopped unexpectedly/)
  child.emit('exit', 1)
  await exited
})
