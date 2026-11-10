const fs = require('node:fs')
const path = require('node:path')
const { NOTE_V1_FILE, NOTE_V2_FILE, NOTE_V2_RUNTIME_FILE } = require('./memory-database/protocol.cjs')
const { uuid } = require('./memory-database/note-v1.cjs')

const stateName = 'memory-migration.v1.json'
const dispositionName = 'memory-migration-dispositions.v1.json'
const migratedJournal = 'memory-erasure.v2.json'
const profileMode = 'note-v2\n'
const v1Path = profile => path.join(profile, 'memory-organization', NOTE_V1_FILE)
const hashes = /^[a-f0-9]{64}$/
const check = (value, reason) => { if (!value) throw new Error(reason) }

const legacyFiles = ['aisling-reflections.v1.json', 'memory-organization', 'memory-note-v1', 'memory-db-p0', NOTE_V2_FILE, dispositionName]
const v2Files = ['note-formation-jobs.v1.json', 'memory-note-v2', migratedJournal]
const unmarkedFiles = ['memory-erasure.v1.json', ...v2Files]
const databasePath = profile => path.join(profile, 'memory-note-v2', NOTE_V2_RUNTIME_FILE)

function exists(file) {
  const info = fs.lstatSync(file, { throwIfNoEntry: false })
  if (!info) return false
  check(!info.isSymbolicLink() && (!info.isFile() || info.nlink === 1), 'unsafe-migration-path')
  return true
}

function readMigration(profile) {
  const file = path.join(profile, stateName)
  if (!exists(file)) return undefined
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(state.version === 1 && uuid(state.id) && typeof state.digest === 'string' && hashes.test(state.digest)
    && ['migrating', 'validating', 'validated'].includes(state.phase) && Number.isSafeInteger(state.total) && state.total >= 0
    && Number.isSafeInteger(state.done) && state.done >= 0 && state.done <= state.total
    && (state.phase === 'migrating' || state.done === state.total), 'invalid-migration-state')
  return state
}

function canStartNoteV2(profile) {
  try { return fs.readFileSync(path.join(profile, 'memory-authority'), 'utf8') === profileMode }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    return !readMigration(profile) && ![...legacyFiles, ...unmarkedFiles].some(name => fs.existsSync(path.join(profile, name)))
  }
}

function assertMemoryAuthority(profile, activate) {
  const modeFile = path.join(profile, 'memory-authority')
  let existing
  try { existing = fs.readFileSync(modeFile, 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const migration = readMigration(profile)
  if (!activate) {
    check(existing === undefined && (migration || !v2Files.some(name => fs.existsSync(path.join(profile, name)))),
      'note-v2-profile-requires-explicit-mode')
    return
  }
  fs.mkdirSync(profile, { recursive: true })
  check(fs.realpathSync(profile) === profile, 'canonical-memory-profile-required')
  if (migration) {
    check(existing === profileMode && migration.phase === 'validated' && fs.existsSync(databasePath(profile))
      && fs.existsSync(path.join(profile, migratedJournal)), 'migration-not-committed')
    return
  }
  check(!legacyFiles.some(name => fs.existsSync(path.join(profile, name))), 'legacy-memory-profile-cannot-use-v2')
  if (existing !== undefined) {
    check(existing === profileMode, 'unknown-memory-authority')
    return
  }
  check(!unmarkedFiles.some(name => fs.existsSync(path.join(profile, name))),
    'unmarked-memory-state-requires-migration')
  fs.writeFileSync(modeFile, profileMode, { flag: 'wx', flush: true })
}

function workerConfig(resources, file, readOnly = false) {
  return async () => {
    const root = fs.realpathSync(resources)
    const node = path.join(root, 'runtime', 'node.exe'), entry = path.join(root, 'worker.cjs')
    check(fs.realpathSync(node) === node && fs.realpathSync(entry) === entry
      && fs.realpathSync(path.dirname(file)) === path.dirname(file), 'unsafe-migration-path')
    exists(file)
    return { node, entry, file, readOnly }
  }
}

module.exports = { stateName, dispositionName, migratedJournal, authority: profileMode, v1Path, databasePath, exists, readMigration,
  workerConfig, canStartNoteV2, assertMemoryAuthority }
