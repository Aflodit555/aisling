const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { configureDefaultProfile, readUnifiedProfile, receiptFile, retiredFile, archiveName, maintenanceFile } = require('./desktop-profile.cjs')
const transfer = require('../../scripts/unify-memory-profile.cjs')
const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p2/tests')
fs.mkdirSync(root, { recursive: true })
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const fresh = () => fs.realpathSync(fs.mkdtempSync(path.join(root, 'profile-')))
const write = (dir, name, value) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value)) }
const config = { memory: { enabled: true, formationEnabled: false, noteRecallEnabled: true, obsidianMirror: { enabled: false, vault: '' } } }
const session = { id: 'synthetic', messages: [{ role: 'user', content: '合成测试：我喜欢蓝色。' }] }
function setup() {
  const dir = fresh(), source = path.join(dir, 'dev'), legacy = path.join(dir, 'old'), target = legacy + '-note-v2', run = path.join(dir, 'backup-run')
  for (const d of [source, legacy, run]) fs.mkdirSync(d)
  for (const d of [source, legacy]) write(d, 'aisling-store.json', { 'aisling.conversations.v1': JSON.stringify({ sessions: [session] }), 'aisling.config.v1': JSON.stringify(config) })
  write(source, 'memory-authority', 'note-v2\n')
  write(source, 'note-formation-jobs.v1.json', { version: 1, progress: {}, batches: [], organization: { tasks: [] } })
  write(source, 'memory-erasure.v1.json', { version: 2, pending: [], blocked: { sources: [], sessions: [] } })
  write(legacy, 'aisling-reflections.v1.json', { version: 1, reflections: [{ id: 'old-reflection', content: session.messages[0].content,
    sourceRefs: [{ sessionId: session.id, messageIndex: 0, digest: require('./memory-evidence.cjs').messageDigest(session.messages[0]) }], relatedReflectionIds: [] }], batches: [], progress: [] })
  write(source, 'memory-note-v2/note-v2.lbdb', 'placeholder')
  return { source, legacy, target, run }
}
function certify(plan) {
  transfer.save(path.join(plan.run, 'verified.json'), { id: plan.id, manifest: plan.manifest, startup: true, restore: true, database: { Note: { rows: 1 } } })
}

test('normal aliases share Main and mode-independent selection; explicit isolation and retired guards work', () => {
  const pkg = require('../../package.json')
  assert.equal(pkg.scripts.start, 'pnpm dev:desktop')
  assert.equal(pkg.scripts['dev:desktop'], 'node scripts/dev-desktop.mjs')
  assert.equal(pkg.scripts['start:desktop'], 'node scripts/dev-desktop.mjs --prod')
  const base = fresh(), target = base + '-note-v2'; fs.mkdirSync(target)
  const saved = process.env.AISLING_DEV_PROFILE; delete process.env.AISLING_DEV_PROFILE
  try {
    for (const _mode of ['start', 'dev:desktop', 'start:desktop']) {
      const paths = { userData: base }, app = { getPath: name => paths[name], setPath: (name, value) => { paths[name] = value } }
      assert.equal(configureDefaultProfile(app), true)
      assert.equal(paths.userData, target); assert.equal(paths.sessionData, target)
    }
    const isolated = fresh(); process.env.AISLING_DEV_PROFILE = isolated
    const paths = { userData: base }
    assert.equal(configureDefaultProfile({ getPath: name => paths[name], setPath: (name, value) => { paths[name] = value } }), false)
    assert.equal(paths.userData, isolated)
    write(isolated, maintenanceFile, { kind: 'synthetic maintenance' })
    assert.throws(() => configureDefaultProfile({ getPath: () => base, setPath() {} }), /memory-maintenance-active/)
    fs.unlinkSync(path.join(isolated, maintenanceFile))
    write(isolated, retiredFile, {})
    assert.throws(() => configureDefaultProfile({ getPath: () => base, setPath() {} }), /retired/)
  } finally { if (saved === undefined) delete process.env.AISLING_DEV_PROFILE; else process.env.AISLING_DEV_PROFILE = saved }
})

test('normal Profile validation never reads Reflection contents as runtime input', () => {
  const args = setup(), plan = transfer.backup(args); certify(plan); transfer.publish(plan)
  const originalRead = fs.readFileSync
  fs.readFileSync = function (file, ...rest) {
    if (String(file).endsWith('aisling-reflections.v1.json')) throw Error('Archive content must be privacy/offline only')
    return originalRead.call(this, file, ...rest)
  }
  try { assert.equal(readUnifiedProfile(args.target).id, plan.id) }
  finally { fs.readFileSync = originalRead }
})

test('unified archives keep original Note v2 erasure barriers and reject ambiguous dual journals', async () => {
  const args = setup(), barrier = require('./memory-database/erasure.cjs').hash('already-deleted')
  write(args.source, 'note-formation-jobs.v1.json', { version: 1, progress: {}, batches: [] })
  write(args.source, 'memory-erasure.v1.json', { version: 2, pending: [], blocked: { sources: [], sessions: [barrier] } })
  const plan = transfer.backup(args); certify(plan); transfer.publish(plan)
  const { unifiedArchive } = require('./memory-archive.cjs'), { createNoteFormationService } = require('./note-formation.cjs')
  const worker = path.join(root, 'not-opened'), readData = () => JSON.parse(fs.readFileSync(path.join(args.target, 'aisling-store.json')))
  const options = { profile: args.target, resources: worker, readData, writeData: value => write(args.target, 'aisling-store.json', value),
    archive: unifiedArchive(args.target, worker), consent: () => false }
  const service = createNoteFormationService(options)
  try {
    assert.deepEqual(service.privacy.readJournal().blocked.sessions, [barrier])
    const data = { ...readData(), 'aisling.conversations.v1': JSON.stringify({ sessions: [session, { id: 'already-deleted', messages: [] }] }) }
    assert.deepEqual(JSON.parse(service.privacy.sanitizedData(data)['aisling.conversations.v1']).sessions.map(s => s.id), [session.id])
    assert(!fs.existsSync(path.join(args.target, 'memory-erasure.v2.json')))
  } finally { await service.close() }
  write(args.target, 'memory-erasure.v2.json', { version: 2, pending: [], blocked: { sources: [], sessions: [] } })
  assert.throws(() => createNoteFormationService(options), /unified-erasure-journals-require-reconciliation/)
})

test('exact transfer resumes every publication boundary, preserves config/jobs/archive, and is idempotent', () => {
  for (const interruption of ['staged', 'published', 'source-sealed', 'legacy-sealed']) {
    const args = setup(), plan = transfer.backup(args); certify(plan)
    assert.throws(() => transfer.publish(plan, point => { if (point === interruption) throw new Error('power interruption') }), /interruption/)
    if (fs.existsSync(args.target)) assert.throws(() => readUnifiedProfile(args.target), /invalid-unified/)
    transfer.publish(plan)
    const before = transfer.inventory(args.target)
    assert.equal(readUnifiedProfile(args.target).id, plan.id)
    transfer.publish(plan); transfer.same(args.target, before)
    transfer.same(path.join(args.target, archiveName), plan.legacyFiles)
    assert.equal(fs.readFileSync(path.join(args.source, 'aisling-store.json'), 'utf8'), fs.readFileSync(path.join(args.target, 'aisling-store.json'), 'utf8'))
    if (process.platform === 'win32') {
      const attempted = path.join(path.dirname(args.source), 'old-build-attempt')
      fs.writeFileSync(attempted, 'must not replace sealed Memory')
      assert.throws(() => fs.renameSync(attempted, path.join(args.source, 'aisling-store.json')), /EPERM|EACCES/)
    }
    transfer.restoreSources(plan)
    for (const [dir, files] of [[args.source, plan.sourceFiles], [args.legacy, plan.legacyFiles]]) {
      assert(!fs.existsSync(path.join(dir, retiredFile)))
      for (const file of files.filter(f => transfer.critical(f.name))) assert.equal(fs.statSync(path.join(dir, file.name)).mode, file.mode)
    }
  }
})

test('conflicts, edited sources, unverified transfers, existing destinations and corrupt state fail closed', () => {
  const args = setup()
  const data = JSON.parse(fs.readFileSync(path.join(args.legacy, 'aisling-store.json')))
  data['aisling.conversations.v1'] = JSON.stringify({ sessions: [{ ...session, messages: [] }] })
  write(args.legacy, 'aisling-store.json', data)
  assert.throws(() => transfer.backup(args), /divergent/)
  const good = setup(), plan = transfer.backup(good)
  assert.throws(() => transfer.publish(plan), /ENOENT/)
  certify(plan); write(good.source, 'new-private-file', 'changed')
  assert.throws(() => transfer.publish(plan), /changed/)
  const ready = setup(), p = transfer.backup(ready); certify(p); transfer.publish(p)
  const wrongInput = path.join(ready.run, 'wrong-input.json')
  transfer.save(wrongInput, { ...ready, source: ready.source + '-unlocked' })
  const blocked = require('node:child_process').spawnSync(process.execPath,
    [path.resolve(__dirname, '../../scripts/unify-memory-profile.cjs'), 'publish', wrongInput], { windowsHide: true, encoding: 'utf8' })
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /locked paths/)
  assert.throws(() => transfer.backup({ ...ready, run: fresh() }), /Target already exists/)
  fs.renameSync(path.join(ready.target, 'memory-note-v2/note-v2.lbdb'), path.join(ready.target, 'saved-db'))
  assert.throws(() => readUnifiedProfile(ready.target), /invalid-unified/)
  assert(!fs.existsSync(path.join(ready.target, 'memory-note-v2/note-v2.lbdb')))
  write(ready.target, receiptFile, '{')
  assert.throws(() => readUnifiedProfile(ready.target))
})

test('native graph and P1 history survive; archived Reflection participates in source erasure', {
  skip: !resources && 'Prepared Worker required', timeout: 180000,
}, async () => {
  const args = setup()
  fs.unlinkSync(path.join(args.source, 'memory-note-v2/note-v2.lbdb'))
  fs.unlinkSync(path.join(args.source, 'note-formation-jobs.v1.json'))
  const readData = () => JSON.parse(fs.readFileSync(path.join(args.source, 'aisling-store.json')))
  const f = require('./note-formation.cjs').createNoteFormationService({ profile: args.source, resources, readData,
    writeData: value => write(args.source, 'aisling-store.json', value), consent: () => true, autonomous: true, authorize: () => true })
  try {
    await f.delivered(session.id, [0]); await f.flush(session.id)
    let job = await f.next(false); await f.prepare(job.id, job.attempt, [])
    await f.fail(job.id, job.attempt, require('./note-formation-errors.mjs').formationFailure({ status: 503 }, 'provider'))
    await f.retry(job.id, job.attempt)
    job = await f.next(false); await f.prepare(job.id, job.attempt, [])
    await f.submit(job.id, job.attempt, JSON.stringify({ items: [{ action: 'ADD', target: null, reason: '合成测试',
      draft: { subject: 'S1', content: session.messages[0].content, kind: 'preference', basis: 'direct', eventTime: null,
        tags: ['蓝色'], sources: [{ label: 'E1', quote: session.messages[0].content }] } }] }))
    await f.recover()
  } finally { await f.close() }
  const plan = transfer.backup(args)
  const savedJobs = JSON.parse(fs.readFileSync(path.join(args.source, 'note-formation-jobs.v1.json')))
  assert(savedJobs.batches[0].history.length >= 2)
  assert.equal(savedJobs.batches[0].autoRetries, 1)
  const before = await transfer.verifyDatabase(path.join(args.run, 'backup/v2'), resources, path.join(args.run, 'native-before'))
  certify(plan); transfer.publish(plan)
  const after = await transfer.verifyDatabase(args.target, resources, path.join(args.run, 'native-after'))
  assert.deepEqual(after, before); assert.equal(after.Note.rows, 1)
  assert.equal(fs.readFileSync(path.join(args.source, 'note-formation-jobs.v1.json'), 'utf8'), fs.readFileSync(path.join(args.target, 'note-formation-jobs.v1.json'), 'utf8'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AISLING_|ELECTRON_RUN_AS_NODE$|TYPESAFE_API_KEY$)/i.test(name)))
  const launch = require('node:util').promisify(require('node:child_process').execFile)
  const smoke = mode => launch(require('electron'), [path.join(__dirname, 'desktop-profile-smoke.cjs'), args.legacy, mode],
    { env, windowsHide: true, timeout: 60000 }).then(result => {
    assert.match(result.stdout, /p2-smoke:/, result.stdout + result.stderr)
    assert.doesNotMatch(result.stderr, /startup failed/, result.stderr)
  })
  await smoke('read')
  const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url')
  const stage = path.resolve(__dirname, '../stage-web'), loader = createRequire(path.join(stage, 'package.json'))
  const vite = await import(pathToFileURL(path.join(path.dirname(loader.resolve('vite/package.json')), 'dist/node/index.js')).href)
  const server = await vite.createServer({ root: stage, logLevel: 'error', server: { host: 'localhost', port: 5174, strictPort: true } })
  try {
    await server.listen(); env.AISLING_STAGE_URL = 'http://localhost:5174'; env.AISLING_DEV = '1'
    await smoke('concurrent')
  } finally { await server.close(); delete env.AISLING_STAGE_URL; delete env.AISLING_DEV }
  await smoke('read')
  const archive = require('./memory-archive.cjs').unifiedArchive(args.target, resources)
  await archive.erase([{ operationId: randomUUID(), evidence: [], sessionIds: [session.id] }])
  assert.equal(JSON.parse(fs.readFileSync(path.join(args.target, archiveName, 'aisling-reflections.v1.json'))).reflections.length, 0)
  const archivedData = JSON.parse(fs.readFileSync(path.join(args.target, archiveName, 'aisling-store.json')))
  assert.equal(JSON.parse(archivedData['aisling.conversations.v1']).sessions.length, 0)
  assert(!fs.existsSync(path.join(args.target, archiveName, 'memory-organization')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(args.legacy, 'aisling-reflections.v1.json'))).reflections.length, 1)
  const file = path.join(args.target, 'memory-note-v2/note-v2.lbdb'), saved = file + '.saved'
  fs.renameSync(file, saved)
  for (const corrupt of [false, true]) {
    if (corrupt) fs.writeFileSync(file, 'invalid native database')
    const invalid = await launch(require('electron'), [path.join(__dirname, 'desktop-profile-smoke.cjs'), args.legacy, 'invalid'],
      { env, windowsHide: true, timeout: 60000 })
    assert.match(invalid.stdout, /p2-smoke:invalid-blocked/)
    if (corrupt) { assert.equal(fs.readFileSync(file, 'utf8'), 'invalid native database'); fs.unlinkSync(file) }
    else assert(!fs.existsSync(file))
  }
  fs.renameSync(saved, file)
})
