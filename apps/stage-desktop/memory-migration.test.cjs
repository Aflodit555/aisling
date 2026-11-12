const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFile, spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const test = process.env.AISLING_MIGRATION_CHILD === '1' ? () => {} : require('node:test').test
const { createMemoryMigration } = require('./memory-migration.cjs')
const { legacyArchive } = require('./memory-archive.cjs')
const { dispositionName, migratedJournal, stateName, readMigration: readState, assertMemoryAuthority, canStartNoteV2 } = require('./memory-authority.cjs')
const { createMemoryLifecycle } = require('./memory-lifecycle.cjs')
const { createMemoryOrganization } = require('./memory-organization.cjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { messageDigest } = require('./memory-evidence.cjs')
const { hash } = require('./memory-database/erasure.cjs')
const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')
const { startWorker } = require('./memory-database/client.cjs')

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p4')
const native = { skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES to prepared resources', timeout: 110_000 }
const key = 'aisling.conversations.v1'
const subject = 'profile-user'
const text = content => ({ role: 'user', content })
const session = (id, ...contents) => ({ id, messages: contents.map(text) })
const ref = (row, index = 0) => ({ sessionId: row.id, messageIndex: index, digest: messageDigest(row.messages[index]) })
const data = sessions => ({ [key]: JSON.stringify({ sessions }) })
const meaning = (content, extra = {}) => ({ content, subject, basis: 'direct', eventTime: null, ...extra })
function json(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return fallback }
}

function options(profile, workerResources = resources) {
  const raw = path.join(profile, 'aisling-store.json'), derived = path.join(profile, 'aisling-reflections.v1.json')
  return { profile, resources: workerResources, readData: () => json(raw, {}), writeData: value => fs.writeFileSync(raw, JSON.stringify(value)),
    readReflections: () => json(derived, { version: 1, reflections: [], batches: [], progress: [] }),
    writeReflections: value => fs.writeFileSync(derived, JSON.stringify(value)), consent: () => true }
}

function fixture(sessions, reflections = [], batches = []) {
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(root, 'profile-')))
  const f = options(profile)
  f.writeData(data(sessions))
  if (reflections.length || batches.length) f.writeReflections({ version: 1, reflections, batches, progress: [] })
  return f
}

function migration(f, checkpoint) {
  const legacy = createMemoryOrganization(f)
  return createMemoryMigration({ ...f, legacy, freeze: () => legacy.freeze(), checkpoint })
}

function row(id, content, sourceRefs, extra = {}) {
  return { id, version: 1, kind: 'fact', basis: 'direct', content, sourceRefs,
    tags: ['纸舟'], relatedReflectionIds: [], createdAt: 1, ...extra }
}

function batch(reflection, extra = {}) {
  return { id: 'batch-' + reflection.id, status: 'completed', reflectionIds: [reflection.id],
    sourceRefs: reflection.sourceRefs, contextSources: reflection.sourceRefs, ...extra }
}

function v1(f) {
  const directory = path.join(f.profile, 'memory-organization')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'note-v1.lbdb')
  return { file, store: createMemoryDatabaseStore(async () => ({ file, node: path.join(f.resources, 'runtime', 'node.exe'),
    entry: path.join(f.resources, 'worker.cjs') }), () => {}) }
}

function operation(id, action, origin, evidence, extra = {}) {
  return { id, action, operationId: randomUUID(), reason: 'Synthetic migration history',
    sources: { origins: [{ reflectionId: origin }], evidence }, ...extra }
}

function fingerprint(file) { return hash(fs.readFileSync(file).toString('base64')) }

test('classifies invalid and uncertain legacy records without changing source data or starting a migration', async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const missing = row('missing', '用户报告纸舟已经暂停。', [{ ...ref(a), sessionId: 'missing' }])
  const changed = row('changed', '用户报告纸舟可以使用。', [{ ...ref(a), digest: 'b'.repeat(64) }])
  const uncertain = row('uncertain', '某个项目可以使用。', [ref(a)])
  const unsupported = row('unsupported', '用户报告纸舟通常可用。', [ref(a)], { kind: 'pattern', basis: 'inferred', uncertainty: '只见一次。' })
  const dependency = row('dependency', '用户报告纸舟功能上线。', [ref(a)])
  const rows = [missing, changed, uncertain, unsupported, dependency]
  const f = fixture([a], rows, rows.map(r => batch(r, r === dependency ? { organization: { contextNoteIds: [randomUUID()] } } : {})))
  const db = migration(f)
  const old = JSON.stringify(f.readReflections())
  const result = await db.preflight()
  assert.equal(result.canMigrate, false)
  const reasons = result.reasons.map(item => item.code)
  for (const reason of ['source-missing', 'source-changed', 'identity-uncertain', 'insufficient-support', 'unproven-context'])
    assert(reasons.includes(reason), reason)
  assert.equal(result.unavailable, 2)
  assert.equal(result.historyIssues, 3)
  assert.equal(JSON.stringify(f.readReflections()), old)
  assert.equal(readState(f.profile), undefined)
  assert(!fs.existsSync(path.join(f.profile, 'memory-note-v2')))
})

test('unqualified old proposals stay archival, and changes after confirmation preview block execution', async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const proposal = row('rejected', a.messages[0].content, [ref(a)])
  const f = fixture([a], [proposal], [batch(proposal, { organization: {
    items: [{ status: 'rejected', reflectionId: proposal.id }], contextSources: [],
  } })])
  const transfer = migration(f)
  const checked = await transfer.preflight()
  assert.equal(checked.canMigrate, true)
  assert.equal(checked.reflections, 0)
  assert.equal(checked.history, 1)
  f.writeData(data([a, session('new', '另一段对话。')]))
  await assert.rejects(transfer.execute(), /migration-preview-changed/)
  assert.equal(readState(f.profile), undefined)
  assert.equal(transfer.frozen(), false)
  assert(!fs.existsSync(path.join(f.profile, 'memory-authority')))
})

test('only proven independent records can be excluded, and a persisted choice cannot promote or replay a stale record', native, async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const accepted = row('accepted', a.messages[0].content, [ref(a)])
  const uncertain = row('uncertain', '某个项目可以使用。', [ref(a)])
  const weak = row('weak', '用户报告纸舟通常可用。', [ref(a)], { kind: 'pattern', basis: 'inferred', uncertainty: '只有一次报告。' })
  const linked = row('linked', '另一个项目也许可用。', [ref(a)])
  const link = row('link', '用户报告纸舟可以访问。', [ref(a)], { relatedReflectionIds: ['linked'] })
  const broken = row('broken', '一个项目状态未知。', [{ ...ref(a), digest: 'b'.repeat(64) }])
  const rows = [accepted, uncertain, weak, linked, link, broken]
  const f = fixture([a], rows, rows.map(record => batch(record)))
  let transfer = migration(f)
  const preview = await transfer.preflight()
  assert.equal(preview.canMigrate, false)
  assert.deepEqual(preview.choices.map(item => item.label), [uncertain.content, weak.content])
  const [first, second] = preview.choices
  await assert.rejects(transfer.exclude(hash(linked.id), preview.version), /preview-changed/)
  await assert.rejects(transfer.exclude(hash(broken.id), preview.version), /preview-changed/)
  assert.equal((await transfer.dispositionChoice(first.key, preview.version)).label, uncertain.content)
  const old = JSON.stringify(f.readReflections())
  assert.equal(await transfer.exclude(first.key, preview.version), 'excluded')
  assert.equal(JSON.stringify(f.readReflections()), old)
  const incomplete = fixture([a])
  fs.copyFileSync(path.join(f.profile, dispositionName), path.join(incomplete.profile, dispositionName))
  assert.equal(canStartNoteV2(incomplete.profile), false)
  assert.equal((await migration(incomplete).preflight()).canMigrate, false)
  assert.equal(await migration(f).exclude(first.key, preview.version), 'excluded')
  await assert.rejects(transfer.exclude(second.key, preview.version), /preview-changed/)
  const refreshed = await transfer.preflight()
  assert.equal(refreshed.excluded, 1)
  assert.equal(refreshed.canMigrate, false)
  assert.equal(await transfer.exclude(second.key, refreshed.version), 'excluded')
  assert.equal((await transfer.preflight()).canMigrate, false)
  const altered = rows.map(record => record === uncertain ? { ...record, content: '这条记录已经修改。' } : record)
  f.writeReflections({ version: 1, reflections: altered, batches: altered.map(record => batch(record)), progress: [] })
  assert((await transfer.preflight()).reasons.some(reason => reason.code === 'disposition-changed'))
  await assert.rejects(transfer.exclude(first.key, preview.version), /preview-changed/)

  const retained = rows.filter(record => ![linked, link, broken].includes(record))
  f.writeReflections({ version: 1, reflections: retained, batches: retained.map(record => batch(record)), progress: [] })
  transfer = migration(f)
  const ready = await transfer.preflight()
  assert.equal(ready.excluded, 2)
  assert.equal(ready.reflections, 1)
  assert.equal(ready.canMigrate, true)
  assert.equal((await transfer.execute()).phase, 'committed')
  const service = createNoteFormationService({ ...f, archive: legacyArchive(f) })
  try {
    const snapshot = await service.recallSnapshot()
    assert.deepEqual(snapshot.notes.map(({ note }) => note.content), [accepted.content])
    assert(f.readReflections().reflections.some(record => record.id === uncertain.id))
    const next = data([])
    service.privacy.beforeConversationChange(f.readData(), next)
    f.writeData(next)
    await service.recover()
    assert.deepEqual(f.readReflections().reflections, [])
    assert.deepEqual((await service.recallSnapshot()).notes, [])
    await assert.rejects(transfer.preflight(), /migration-unavailable/)
  } finally { await service.close() }
})

test('pending or blocked deletion prevents transfer without preflight settling it', async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const old = row('old', a.messages[0].content, [ref(a)])
  const f = fixture([a], [old], [batch(old)])
  const legacy = { privacy: createMemoryLifecycle({ ...f, hasDatabase: () => false }) }
  legacy.privacy.beforeConversationChange(f.readData(), data([]))
  const journal = path.join(f.profile, 'memory-erasure.v1.json')
  const before = fingerprint(journal)
  const result = await createMemoryMigration({ ...f, legacy, freeze: () => legacy.freeze() }).preflight()
  assert.equal(result.canMigrate, false)
  assert(result.reasons.some(reason => reason.code === 'cleanup-pending'))
  assert(result.reasons.some(reason => reason.code === 'source-blocked'))
  assert.equal(fingerprint(journal), before)
  assert.deepEqual(f.readData(), data([a]))
})

test('a v1-only profile with missing Origins is held and the read-only Worker leaves the database untouched', native, async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const f = fixture([a])
  const { file, store } = v1(f)
  await store.open()
  await store.applyNoteOperation(operation(randomUUID(), 'ADD', 'missing', [ref(a)], { meaning: meaning(a.messages[0].content) }))
  await store.close()
  const before = fingerprint(file)
  const result = await migration(f).preflight()
  assert.equal(result.canMigrate, false)
  assert(result.reasons.some(reason => reason.code === 'unproven-history'))
  assert.equal(fingerprint(file), before)
  assert.equal(readState(f.profile), undefined)
})

test('verifiable Notes and Reflection migrate through a process crash, resume, restart and archival deletion', native, async () => {
  const a = session('a', '用户报告纸舟的第一版已经发布。')
  const b = session('b', '用户报告纸舟的第二版已经发布。')
  const c = session('c', '用户补充纸舟的第一版已发布。')
  const d = session('d', '用户报告纸舟的第三版取代第二版。')
  const e = session('e', '用户报告纸舟有一个已撤回的备选方案。')
  const old = row('first', a.messages[0].content, [ref(a)])
  const update = row('update', b.messages[0].content, [ref(b)])
  const supplement = row('supplement', a.messages[0].content, [ref(c)])
  const successor = row('successor', d.messages[0].content, [ref(d)])
  const separate = row('separate', '用户报告纸舟有第三版。', [ref(d)])
  const pattern = row('pattern', '用户在两次纸舟发布中都报告了版本。', [ref(a), ref(b)],
    { kind: 'pattern', basis: 'inferred', uncertainty: '只依据这两次报告。' })
  const retired = row('retired', e.messages[0].content, [ref(e)])
  const rows = [old, update, supplement, successor, separate, pattern, retired]
  const f = fixture([a, b, c, d, e], rows, rows.map(r => batch(r)))
  const { file, store } = v1(f)
  const firstId = randomUUID(), successorId = randomUUID(), retiredId = randomUUID()
  await store.open()
  const add = operation(firstId, 'ADD', old.id, old.sourceRefs, { meaning: meaning(old.content) })
  const noop = operation(firstId, 'NOOP', supplement.id, supplement.sourceRefs, { expectedVersion: 1 })
  const revise = operation(firstId, 'UPDATE', update.id, update.sourceRefs, { expectedVersion: 1, meaning: meaning(update.content) })
  const replace = operation(firstId, 'SUPERSEDE', successor.id, successor.sourceRefs, { expectedVersion: 2, newId: successorId,
    meaning: meaning(successor.content), transition: 'explicit-same-scope-change' })
  const retiredAdd = operation(retiredId, 'ADD', retired.id, retired.sourceRefs, { meaning: meaning(retired.content) })
  const retract = operation(retiredId, 'RETRACT', retired.id, retired.sourceRefs, { expectedVersion: 1 })
  for (const command of [add, noop, revise, replace, retiredAdd, retract]) await store.applyNoteOperation(command)
  await store.close()
  const before = fingerprint(file)
  const preview = await migration(f).preflight()
  assert.equal(preview.canMigrate, true, JSON.stringify(preview))
  assert.equal(preview.notes, 1)
  assert.equal(preview.reflections, 2)
  assert.equal(preview.duplicates, 1)
  assert.equal(preview.revisions, 6)
  assert.equal(preview.receipts, 6)
  assert.equal(fingerprint(file), before)
  assert.equal(readState(f.profile), undefined)

  const child = spawnSync(process.execPath, ['-e', [
    "const fixture = require('./apps/stage-desktop/memory-migration.test.cjs')",
    "const [profile, resources, phase] = process.argv.slice(1)",
    "const runtime = fixture.migration(fixture.options(profile, resources), event => { if (event === phase) process.exit(87) })",
    "runtime.preflight().then(() => runtime.execute()).catch(error => { console.error(error); process.exit(1) })",
  ].join('\n'), f.profile, f.resources, 'validated'], { cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, AISLING_MIGRATION_CHILD: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.equal(child.status, 87, child.stdout + child.stderr)
  assert.equal(readState(f.profile).phase, 'validated')
  assert.equal(canStartNoteV2(f.profile), false)
  assert.doesNotThrow(() => assertMemoryAuthority(f.profile, false))
  assert.throws(() => assertMemoryAuthority(f.profile, true), /migration-not-committed/)
  assert.equal(fingerprint(file), before)

  const resume = migration(f)
  assert.equal((await resume.execute()).phase, 'committed')
  assert.equal((await resume.execute()).phase, 'committed')
  assert.equal(canStartNoteV2(f.profile), true)
  assert.throws(() => assertMemoryAuthority(f.profile, false), /explicit-mode/)
  const brokenArchive = legacyArchive({ ...f, resources: path.join(f.profile, 'unavailable-archive-worker') })
  let service = createNoteFormationService({ ...f, archive: brokenArchive })
  try {
    const snapshot = await service.recallSnapshot()
    assert.equal(snapshot.reason, 'ready')
    assert.deepEqual(new Set(snapshot.notes.map(head => head.note.content)), new Set([successor.content, separate.content, pattern.content]))
    assert(snapshot.notes.some(head => head.note.id === successorId && head.note.version === 1))
    assert(!snapshot.notes.some(head => [firstId, retiredId].includes(head.note.id)))
    assert.equal(fingerprint(file), before)
    const next = data([a, b, d, e])
    service.privacy.beforeConversationChange(f.readData(), next)
    f.writeData(next)
    assert.equal(service.recallCurrent(snapshot.version), false)
    await assert.rejects(service.recover())
    assert(json(path.join(f.profile, migratedJournal)).pending.length > 0)
    await assert.rejects(service.recallSnapshot())
    await service.close()
    service = createNoteFormationService({ ...f, archive: legacyArchive(f) })
    await service.recover()
    await service.recover()
    assert.equal((await service.recallSnapshot()).notes.length, 2)
    await store.open()
    assert.equal(await store.getNoteV1(successorId), null)
    assert.equal(await store.getRevision(firstId, 1), null)
    assert.equal(await store.getOperationReceipt(noop.operationId), null)
    assert.equal((await store.getNoteV1(retiredId)).status, 'retracted')
    assert(!f.readReflections().reflections.some(r => r.id === 'supplement'))
    assert.equal(json(path.join(f.profile, migratedJournal)).pending.length, 0)
  } finally { await service.close(); await store.close() }
})

test('target transactions roll back and a lost successful ADD reply reuses the migration Receipt', native, async () => {
  const a = session('a', '用户报告纸舟已经上线。')
  const record = row('first', a.messages[0].content, [ref(a)])
  const f = fixture([a], [record], [batch(record)])
  const worker = path.join(f.profile, 'faulty-worker')
  fs.cpSync(f.resources, worker, { recursive: true })
  const entry = path.join(worker, 'worker.cjs'), control = path.join(f.profile, 'fault')
  fs.renameSync(entry, path.join(worker, 'worker-real.cjs'))
  fs.writeFileSync(entry, [
    "const fs = require('node:fs')",
    'const control = ' + JSON.stringify(control),
    "const target = process.argv.at(-1).endsWith('note-v2.lbdb')",
    "const fault = () => fs.readFileSync(control, 'utf8')",
    "const api = require('@ladybugdb/core')",
    'const prepare = api.Connection.prototype.prepare',
    'api.Connection.prototype.prepare = function(statement) {',
    "  if (target && fault() === 'rollback' && statement.includes('CREATE (:NoteOperation')) throw new Error('synthetic-late-import-error')",
    '  return prepare.call(this, statement)',
    '}',
    'const send = process.stdout.write.bind(process.stdout)',
    'process.stdout.write = (line, callback) => {',
    "  if (target && fault() === 'lost' && JSON.parse(line).result?.action === 'ADD') process.exit(86)",
    '  return send(line, callback)',
    '}',
    "require('./worker-real.cjs')",
  ].join('\n'))
  const target = path.join(f.profile, 'memory-note-v2', 'note-v2.lbdb')
  const inspect = async () => {
    const child = startWorker({ node: path.join(f.resources, 'runtime', 'node.exe'), entry: path.join(f.resources, 'worker.cjs'), file: target })
    try {
      await child.ready
      return (await child.request('listNoteHeads', [''])).value.notes
    } finally { await child.close() }
  }
  const launch = migration(options(f.profile, worker))
  fs.writeFileSync(control, 'rollback')
  assert((await launch.preflight()).canMigrate)
  await assert.rejects(launch.execute(), /synthetic-late-import-error/)
  const pending = readState(f.profile)
  assert.equal(pending.done, 0)
  assert.deepEqual(await inspect(), [])
  assert(launch.frozen())
  assert.equal(canStartNoteV2(f.profile), false)
  fs.writeFileSync(control, 'lost')
  await assert.rejects(migration(options(f.profile, worker)).execute(), { code: 'outcome-unknown' })
  const [committed] = await inspect()
  assert(committed)
  assert.equal(readState(f.profile).id, pending.id)
  assert.equal(readState(f.profile).done, 0)
  fs.writeFileSync(control, 'ok')
  assert.equal((await migration(options(f.profile, worker)).execute()).phase, 'committed')
  assert.deepEqual(await inspect(), [committed])
})

function desktopProfiles() {
  const s = session('a', '用户报告纸舟第一版已发布。')
  const original = row('migration-entry', s.messages[0].content, [ref(s)])
  const ambiguous = row('migration-ambiguous', '有个项目可能发布了。', [ref(s)])
  const records = [original, ambiguous]
  const f = fixture([s], records, records.map(record => batch(record, { sessionId: s.id, units: 1, attempts: 1 })))
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(root, 'profile-')))
  const unmarked = fixture([s]).profile
  const blocked = fixture([s]).profile
  fs.writeFileSync(path.join(blocked, stateName), JSON.stringify({
    version: 1, id: randomUUID(), digest: 'a'.repeat(64), total: 1, done: 0, phase: 'migrating',
  }))
  for (const profile of [f.profile, fresh, unmarked, blocked]) fs.writeFileSync(path.join(profile, '.migration-fixture'), 'aisling-p4-synthetic\n')
  f.writeData({ ...f.readData(), 'aisling.config.v1': JSON.stringify({ memory: { enabled: true, noteRecallEnabled: true } }) })
  return [['legacy', f.profile], ['v2', f.profile], ['fresh', fresh], ['unmarked', unmarked], ['blocked', blocked]]
}

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(name)))

test('standard Electron entry checks and confirms an upgrade, excludes an old writer, then restarts in v2', native, () => {
  const electron = require('electron')
  for (const [phase, profile] of desktopProfiles()) {
    const child = spawnSync(electron, [path.join(__dirname, 'memory-migration-smoke.cjs'), phase, profile, resources], {
      windowsHide: true, encoding: 'utf8', timeout: 55_000,
      env: { ...cleanEnv(), ...(phase === 'fresh' && { AISLING_MEMORY_DB_P0: '1' }) },
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert(child.stdout.includes('p4-smoke:' + phase), child.stdout + child.stderr)
  }
})

test('real Vite and Electron use the same authority, review, Recall, erasure and IPC boundaries', { ...native, timeout: 180_000 }, async () => {
  const stage = path.resolve(__dirname, '../stage-web')
  const stageRequire = createRequire(path.join(stage, 'package.json'))
  const viteEntry = path.join(path.dirname(stageRequire.resolve('vite/package.json')), 'dist/node/index.js')
  const { createServer } = await import(pathToFileURL(viteEntry).href)
  const server = await createServer({ root: stage, logLevel: 'error', plugins: [{
    name: 'aisling-test-hot-update',
    configureServer(server) {
      server.middlewares.use('/__aisling_test_hmr', async (_request, response) => {
        try {
          const module = await server.moduleGraph.getModuleByUrl('/src/pages/settings/memory.vue')
          assert(module?.isSelfAccepting)
          await server.reloadModule(module)
          response.end('updated')
        } catch (error) {
          response.statusCode = 500
          response.end(error.message)
        }
      })
    },
  }] })
  const electron = require('electron')
  const launch = promisify(execFile)
  try {
    await server.listen()
    for (const [phase, profile] of desktopProfiles()) {
      const result = await launch(electron, [path.join(__dirname, 'memory-migration-smoke.cjs'), phase, profile, resources], {
        windowsHide: true, timeout: 50_000, env: { ...cleanEnv(), AISLING_DEV: '1', AISLING_DEV_PROFILE: profile },
      }).catch(error => {
        if (phase === 'legacy' && error.code === 75) return error
        throw new Error(phase + '\n' + error.stdout + '\n' + error.stderr, { cause: error })
      })
      if (phase === 'legacy') assert.equal(result.code, 75)
      assert.match(result.stdout, new RegExp('p4-smoke:' + phase), result.stderr)
    }
    const fixtureRoot = path.resolve(__dirname, '../../artifacts/memory-note-only-p1')
    fs.mkdirSync(fixtureRoot, { recursive: true })
    const profile = fs.realpathSync(fs.mkdtempSync(path.join(fixtureRoot, 'vite-')))
    fs.writeFileSync(path.join(profile, '.note-formation-test'), 'aisling-note-formation-p1-fixture\n')
    const result = await launch(electron, [path.join(__dirname, 'note-formation-smoke.cjs'), 'dev', profile], {
      windowsHide: true, timeout: 80_000,
      env: { ...cleanEnv(), AISLING_STAGE_URL: 'http://localhost:5174/settings/memory', AISLING_DEV_PROFILE: profile },
    }).catch(error => { throw new Error(error.stdout + '\n' + error.stderr, { cause: error }) })
    assert.match(result.stdout, /"result":"note-formation-passed"/, result.stderr)
  } finally {
    await server.close()
  }
})

module.exports = { migration, options }
