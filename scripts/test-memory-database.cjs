const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { createInterface } = require('node:readline')
const { join, resolve } = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')

const root = resolve(__dirname, '..')
const desktop = join(root, 'apps/stage-desktop')
const artifacts = join(root, 'artifacts/memory-db-p0')
mkdirSync(artifacts, { recursive: true })
const run = mkdtempSync(join(artifacts, 'electron-'))
const electron = require(join(desktop, 'node_modules/electron'))
const resources = process.env.AISLING_MEMORY_DB_P0_RESOURCES || join(root, '.local/memory-database')
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(key)))
const isolated = join(run, 'p0-profile')
const legacy = join(run, 'legacy-profile')
const off = join(run, 'off-profile')
for (const path of [isolated, legacy, off]) mkdirSync(path)
const sentinels = ['aisling-store.json', 'aisling-reflections.v1.json']
for (const file of sentinels) writeFileSync(join(legacy, file), 'fake legacy data; must remain untouched')

function config(phase) {
  return { cwd: desktop, windowsHide: true, env: { ...env,
    AISLING_P0_SMOKE_PHASE: phase, AISLING_P0_SMOKE_BASE_PROFILE: phase === 'off' ? off : legacy,
    AISLING_MEMORY_DB_P0: phase === 'off' ? '0' : '1', AISLING_MEMORY_DB_P0_PROFILE: isolated,
    AISLING_MEMORY_DB_P0_RESOURCES: phase === 'off' ? join(run, 'missing-resources') : resources,
  } }
}
function assertExited(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
}
function stage(phase) {
  const result = spawnSync(electron, ['memory-database-smoke.cjs'], { ...config(phase), encoding: 'utf8', timeout: 55000 })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.ifError(result.error)
  assert.equal(result.status, 0, phase)
  const record = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{"result":"pass"')).map(JSON.parse)[0]
  assert(record && record.phase === phase)
  if (record.workerPid) {
    assert.match(result.stdout, /"event":"closed"/)
    assertExited(record.workerPid)
  }
  return record
}

async function killParent() {
  const app = spawn(electron, ['memory-database-smoke.cjs'], { ...config('parent-kill'), stdio: ['ignore', 'pipe', 'inherit'] })
  const closed = once(app, 'close')
  const reader = createInterface({ input: app.stdout })
  const timer = setTimeout(() => app.kill('SIGKILL'), 45000)
  let workerPid
  try {
    for await (const line of reader) {
      console.log(line)
      if (!line.startsWith('{"event":"parent-kill-ready"')) continue
      workerPid = JSON.parse(line).workerPid
      assert.equal(app.kill('SIGKILL'), true)
      break
    }
    assert(workerPid, 'Missing ready Worker for forced parent exit')
    await closed
    for (let index = 0; index < 200; index++) {
      try { process.kill(workerPid, 0) }
      catch (error) {
        assert.equal(error.code, 'ESRCH')
        console.log(JSON.stringify({ event: 'parent-kill-reaped-worker', workerPid }))
        return
      }
      await sleep(25)
    }
    process.kill(workerPid, 'SIGKILL')
    assert.fail('Worker remained after forced parent exit and was cleaned up by test')
  }
  finally { clearTimeout(timer); reader.close() }
}

;(async () => {
  const disabled = stage('off')
  assert.equal(disabled.workerPid, undefined)
  const first = stage('write')
  stage('worker-kill')
  await killParent()
  assert.notEqual(stage('reopen').workerPid, first.workerPid)
  for (const file of sentinels) assert.equal(readFileSync(join(legacy, file), 'utf8'), 'fake legacy data; must remain untouched')
  for (const [flag, evidence] of [['AISLING_MEMORY_SMOKE', /"memorySmoke":"passed"/],
    ['AISLING_FORMATION_SMOKE', /"formationSmoke":"passed"/]]) {
    const failure = join(run, flag + '-profile')
    mkdirSync(failure)
    const fail = spawnSync(electron, ['prod-smoke.cjs'], { ...config('failure'), encoding: 'utf8', timeout: 55000,
      env: { ...config('failure').env, AISLING_MEMORY_DB_P0_PROFILE: failure,
        AISLING_MEMORY_DB_P0_RESOURCES: join(run, 'missing-resources'),
        AISLING_MEMORY_DB_P0_EXPECT_FAILURE: '1', [flag]: '1' } })
    process.stdout.write(fail.stdout || '')
    process.stderr.write(fail.stderr || '')
    assert.ifError(fail.error)
    assert.equal(fail.status, 0)
    assert.match(fail.stdout, /"memoryDatabaseStartupFailure":"passed"/)
    assert.match(fail.stdout, evidence)
    assert.match(fail.stdout, /"event":"closed"/)
  }
  console.log(JSON.stringify({ result: 'all-p0-smokes-passed', run }))
})().catch(error => { console.error(error); process.exitCode = 1 })
