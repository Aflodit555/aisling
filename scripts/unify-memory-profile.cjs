// One-shot offline transfer. Invoke through unify-memory-profile.ps1 for process/file locks.
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const desktop = path.resolve(__dirname, '../apps/stage-desktop')
const { durable } = require(path.join(desktop, 'memory-files.cjs'))
const { databasePath, authority, assertMemoryAuthority } = require(path.join(desktop, 'memory-authority.cjs'))
const { receiptFile, retiredFile, archiveName, readUnifiedProfile } = require(path.join(desktop, 'desktop-profile.cjs'))
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const save = (file, value) => durable(file, JSON.stringify(value, null, 2))
const check = (value, message) => { if (!value) throw new Error(message) }
const critical = name => /^(aisling-|memory-|note-formation)/.test(name.split(/[\\/]/)[0])

function canonical(directory) {
  check(path.isAbsolute(directory) && fs.realpathSync(directory) === path.normalize(directory)
    && !fs.lstatSync(directory).isSymbolicLink(), 'Noncanonical profile path')
  return path.normalize(directory)
}

function inventory(directory) {
  canonical(directory)
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), stat = fs.lstatSync(file)
      check(!stat.isSymbolicLink(), 'Profile contains a link')
      if (stat.isDirectory()) walk(file)
      else {
        check(stat.isFile() && stat.nlink === 1, 'Profile contains a special or shared file')
        files.push({ name: path.relative(directory, file), bytes: stat.size, mode: stat.mode,
          sha256: hash(fs.readFileSync(file)) })
      }
    }
  }
  walk(directory)
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

const content = files => files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((a, b) => a.name.localeCompare(b.name))
function same(directory, files, ignore = []) {
  check(isDeepStrictEqual(content(inventory(directory).filter(f => !ignore.includes(f.name))), content(files)), 'Profile files changed')
}
function copy(source, target, files) {
  fs.mkdirSync(target, { recursive: true })
  canonical(target)
  for (const item of files) {
    const from = path.join(source, item.name), to = path.join(target, item.name)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    if (fs.existsSync(to)) check(hash(fs.readFileSync(to)) === item.sha256, 'Partial transfer differs; preserve for review')
    else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    check(hash(fs.readFileSync(to)) === item.sha256, 'Transfer hash mismatch')
  }
  same(target, files)
}

function compare(source, legacy) {
  const data = json(path.join(source, 'aisling-store.json')), old = json(path.join(legacy, 'aisling-store.json'))
  const sessions = JSON.parse(data['aisling.conversations.v1']).sessions
  const previous = JSON.parse(old['aisling.conversations.v1']).sessions
  check(new Set(sessions.map(s => s.id)).size === sessions.length && new Set(previous.map(s => s.id)).size === previous.length, 'Duplicate session IDs')
  check(previous.every(s => sessions.some(current => isDeepStrictEqual(current, s))), 'Independent or divergent legacy sessions; automatic transfer blocked')
  const differences = []
  function diff(a, b, prefix) {
    if (isDeepStrictEqual(a, b)) return
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b))
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], prefix ? prefix + '.' + key : key)
    else differences.push(prefix)
  }
  diff(JSON.parse(data['aisling.config.v1']), JSON.parse(old['aisling.config.v1']), '')
  return { sessions: sessions.length, messages: sessions.reduce((n, s) => n + s.messages.length, 0), legacySessions: previous.length,
    reflections: json(path.join(legacy, 'aisling-reflections.v1.json')).reflections.length,
    configurationDifferences: differences }
}

function backup({ source, legacy, target, run }) {
  [source, legacy, run].forEach(canonical)
  check(path.isAbsolute(target) && canonical(path.dirname(target)) === path.dirname(target), 'Invalid target parent')
  const roots = [source, legacy, target, run].map(p => path.resolve(p).toLowerCase())
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++)
    check(roots[i] !== roots[j] && !roots[i].startsWith(roots[j] + path.sep) && !roots[j].startsWith(roots[i] + path.sep), 'Overlapping transfer paths')
  const file = path.join(run, 'transfer.json')
  let plan
  if (fs.existsSync(file)) {
    plan = json(file)
    check(plan.source === source && plan.legacy === legacy && plan.target === target, 'Transfer plan does not match')
  } else {
    check(!fs.existsSync(target), 'Target already exists; never overwrite')
    check(!fs.existsSync(path.join(source, receiptFile)) && !fs.existsSync(path.join(source, retiredFile))
      && !fs.existsSync(path.join(legacy, retiredFile)) && !fs.existsSync(path.join(source, 'memory-migration.v1.json')),
    'Previously migrated/retired profile requires review')
    check(fs.readFileSync(path.join(source, 'memory-authority'), 'utf8') === authority, 'Invalid source authority')
    assertMemoryAuthority(source, true)
    plan = { version: 1, id: randomUUID(), source, legacy, target, run, phase: 'backup', createdAt: new Date().toISOString(),
      sourceFiles: inventory(source), legacyFiles: inventory(legacy) }
    save(file, plan)
  }
  if (plan.phase === 'committed') { check(readUnifiedProfile(target)?.id === plan.id, 'Committed target missing'); return plan }
  same(source, plan.sourceFiles, [retiredFile]); same(legacy, plan.legacyFiles, [retiredFile])
  for (const [name, origin, files] of [['v2', source, plan.sourceFiles], ['legacy', legacy, plan.legacyFiles]]) {
    copy(origin, path.join(run, 'backup', name), files)
    save(path.join(run, name + '-manifest.json'), files)
  }
  plan.summary = compare(path.join(run, 'backup/v2'), path.join(run, 'backup/legacy'))
  plan.manifest = hash(JSON.stringify([content(plan.sourceFiles), content(plan.legacyFiles)]))
  plan.phase = 'backed-up'
  save(file, plan)
  same(source, plan.sourceFiles, [retiredFile]); same(legacy, plan.legacyFiles, [retiredFile])
  return plan
}

/** Recover WAL only in a disposable full copy, then hash every table's logical rows. */
async function verifyDatabase(profile, resources, destination) {
  copy(profile, destination, inventory(profile))
  const { createRequire } = require('node:module')
  const api = createRequire(path.join(resources, 'package.json'))('@ladybugdb/core')
  check(process.versions.node === '24.12.0' && api.VERSION === '0.22.1', 'Pinned native runtime required')
  const file = databasePath(destination)
  check(fs.statSync(file).size > 0, 'Missing database')
  const store = require(path.join(desktop, 'memory-database/adapter.cjs')).openLadybug(api, file, 'note-v2-runtime', false, true)
  try {
    await store.initialize()
    const snapshot = await store.mirrorSnapshot()
    const lookup = require(path.join(desktop, 'memory-evidence.cjs')).sourceMessageLookup(json(path.join(destination, 'aisling-store.json')))
    check(snapshot.notes.every(note => [...note.sources, ...note.contextEvidence].every(ref => lookup(ref))), 'Note source validation failed')
  } finally { await store.close() }
  const db = new api.Database(file), connection = new api.Connection(db)
  async function query(sql) { const result = await connection.query(sql); try { return await result.getAll() } finally { result.close() } }
  try {
    const tables = await query('CALL show_tables() RETURN name, type')
    const result = {}
    for (const { name, type } of tables.sort((a, b) => a.name.localeCompare(b.name))) {
      check(/^\w+$/.test(name), 'Unexpected table identifier')
      const columns = await query(`CALL table_info('${name}') RETURN *`)
      const rows = await query(type === 'REL' ? `MATCH (a)-[r:${name}]->(b) RETURN a, r, b` : `MATCH (n:${name}) RETURN n`)
      const normalized = rows.map(row => JSON.stringify(row, (key, value) => key === '_id' || key === '_src' || key === '_dst' ? undefined
        : typeof value === 'bigint' ? value.toString() : value)).sort()
      result[name] = { rows: rows.length, schema: hash(JSON.stringify(columns, (_, v) => typeof v === 'bigint' ? String(v) : v)), sha256: hash(JSON.stringify(normalized)) }
    }
    return result
  } finally { connection.close(); db.close() }
}

function publish(plan, checkpoint = () => {}) {
  const { source, legacy, target, run } = plan
  check(plan.version === 1 && /^[a-f0-9-]{36}$/.test(plan.id), 'Invalid plan')
  check(hash(JSON.stringify([content(plan.sourceFiles), content(plan.legacyFiles)])) === plan.manifest, 'Transfer manifest changed')
  for (const file of [...plan.sourceFiles, ...plan.legacyFiles])
    check(!path.isAbsolute(file.name) && path.normalize(file.name) === file.name && !file.name.split(path.sep).includes('..'), 'Unsafe manifest path')
  if (fs.existsSync(target) && readUnifiedProfileIfCommitted(target)?.id === plan.id) {
    for (const root of [source, legacy]) check(json(path.join(root, retiredFile)).id === plan.id, 'Source is not sealed')
    plan.phase = 'committed'; save(path.join(run, 'transfer.json'), plan)
    return plan
  }
  same(source, plan.sourceFiles, [retiredFile]); same(legacy, plan.legacyFiles, [retiredFile])
  same(path.join(run, 'backup/v2'), plan.sourceFiles); same(path.join(run, 'backup/legacy'), plan.legacyFiles)
  const rehearsal = json(path.join(run, 'verified.json'))
  check(rehearsal.id === plan.id && rehearsal.manifest === plan.manifest && rehearsal.startup && rehearsal.restore
    && rehearsal.database && rehearsal.database.Note.rows > 0, 'Isolated verification required')
  const stage = target + '.stage-' + plan.id
  if (!fs.existsSync(target)) {
    fs.mkdirSync(stage, { recursive: true })
    // Extra archive/receipt entries are checked separately when resuming a prepared stage.
    const extra = [archiveName, receiptFile]
    const partial = inventory(stage).filter(f => !extra.includes(f.name.split(path.sep)[0]))
    check(partial.every(f => plan.sourceFiles.some(s => s.name === f.name && s.sha256 === f.sha256)), 'Unknown staged files')
    for (const item of plan.sourceFiles) {
      const to = path.join(stage, item.name)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(run, 'backup/v2', item.name), to, fs.constants.COPYFILE_EXCL)
      check(hash(fs.readFileSync(to)) === item.sha256, 'Staged source mismatch')
    }
    copy(path.join(run, 'backup/legacy'), path.join(stage, archiveName), plan.legacyFiles)
    save(path.join(stage, receiptFile), { version: 1, id: plan.id, phase: 'prepared', manifest: plan.manifest, archive: archiveName })
    checkpoint('staged')
    fs.renameSync(stage, target)
    checkpoint('published')
  }
  const state = json(path.join(target, receiptFile))
  check(state.id === plan.id && state.phase === 'prepared' && state.manifest === plan.manifest, 'Unexpected target state')
  same(target, [...plan.sourceFiles, ...plan.legacyFiles.map(f => ({ ...f, name: path.join(archiveName, f.name) }))], [receiptFile])
  for (const [root, files] of [[source, plan.sourceFiles], [legacy, plan.legacyFiles]]) {
    const marker = path.join(root, retiredFile)
    if (fs.existsSync(marker)) check(json(marker).id === plan.id, 'Retirement marker conflict')
    else save(marker, { version: 1, id: plan.id, target, backup: run })
    // Windows read-only files also prevent an old build replacing these files by rename.
    for (const item of files.filter(f => critical(f.name))) fs.chmodSync(path.join(root, item.name), item.mode & ~0o222)
    checkpoint(root === source ? 'source-sealed' : 'legacy-sealed')
  }
  same(source, plan.sourceFiles, [retiredFile]); same(legacy, plan.legacyFiles, [retiredFile])
  save(path.join(target, receiptFile), { ...state, phase: 'committed', committedAt: new Date().toISOString() })
  plan.phase = 'committed'; save(path.join(run, 'transfer.json'), plan)
  return plan
}
function readUnifiedProfileIfCommitted(target) {
  return json(path.join(target, receiptFile)).phase === 'committed' ? readUnifiedProfile(target) : undefined
}

function restoreSources(plan) {
  // Restore only source sealing, never overwrite a live/changed target. Caller keeps the target as a recovery artifact.
  for (const [root, files] of [[plan.source, plan.sourceFiles], [plan.legacy, plan.legacyFiles]]) {
    same(root, files, [retiredFile])
    const marker = path.join(root, retiredFile)
    if (fs.existsSync(marker)) check(json(marker).id === plan.id, 'Wrong retirement marker')
    for (const item of files.filter(f => critical(f.name))) fs.chmodSync(path.join(root, item.name), item.mode)
    if (fs.existsSync(marker)) fs.renameSync(marker, marker + '.restored-' + randomUUID())
  }
}

module.exports = { inventory, same, copy, compare, backup, verifyDatabase, publish, restoreSources, critical, hash, save }
if (require.main === module) {
  const [mode, input] = process.argv.slice(2)
  Promise.resolve().then(async () => {
    const args = json(path.resolve(input))
    if (mode === 'backup') return backup(args).summary
    const plan = json(path.join(args.run, 'transfer.json'))
    check(['source', 'legacy', 'target', 'run'].every(key => plan[key] === args[key]), 'Transfer input does not match locked paths')
    if (mode === 'verify') {
      const result = await verifyDatabase(path.join(args.run, 'backup/v2'), args.resources, path.join(args.run, 'database-check-' + randomUUID()))
      save(path.join(args.run, 'database-verified.json'), { id: plan.id, manifest: plan.manifest, database: result })
      return result
    }
    if (mode === 'publish') return { phase: publish(plan).phase }
    throw new Error('Expected backup, verify or publish')
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
