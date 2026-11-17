const fs = require('node:fs')
const path = require('node:path')
const { exists, authority, databasePath } = require('./memory-authority.cjs')
const { UNIFIED_PROFILE_FILE } = require('./memory-database/protocol.cjs')
const { uuid } = require('./memory-database/note-v1.cjs')

const retiredFile = 'memory-profile-retired.v1.json'
const archiveName = 'legacy-profile-archive'
const check = value => { if (!value) throw new Error('invalid-unified-memory-profile') }
const read = file => { try { check(exists(file)); return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new Error('invalid-unified-memory-profile') } }

function readUnifiedProfile(profile) {
  const file = path.join(profile, UNIFIED_PROFILE_FILE)
  if (!exists(file)) return undefined
  const state = read(file)
  check(state.version === 1 && uuid(state.id) && state.phase === 'committed'
    && /^[a-f0-9]{64}$/.test(state.manifest) && state.archive === archiveName)
  check(exists(path.join(profile, archiveName)) && fs.statSync(path.join(profile, archiveName)).isDirectory())
  check(fs.realpathSync(path.join(profile, archiveName)) === path.join(profile, archiveName))
  const archived = read(path.join(profile, archiveName, 'aisling-reflections.v1.json'))
  check(archived.version === 1 && Array.isArray(archived.reflections) && Array.isArray(archived.batches))
  check(Array.isArray(JSON.parse(read(path.join(profile, archiveName, 'aisling-store.json'))['aisling.conversations.v1']).sessions))
  check(exists(path.join(profile, 'memory-authority')) && fs.readFileSync(path.join(profile, 'memory-authority'), 'utf8') === authority)
  check(!exists(path.join(profile, 'memory-migration.v1.json')))
  check(exists(databasePath(profile)) && fs.statSync(databasePath(profile)).size > 0)
  check(exists(path.join(profile, 'aisling-store.json')) && exists(path.join(profile, 'note-formation-jobs.v1.json')))
  const data = read(path.join(profile, 'aisling-store.json'))
  check(Array.isArray(JSON.parse(data['aisling.conversations.v1']).sessions))
  check(typeof JSON.parse(data['aisling.config.v1']).memory === 'object')
  return state
}

/** Select before app readiness and before Electron's profile-scoped instance lock. */
function configureDefaultProfile(app) {
  const explicit = process.env.AISLING_DEV_PROFILE
  const directory = explicit || app.getPath('userData') + '-note-v2'
  if (!path.isAbsolute(directory) || !fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory())
    throw new Error('unified-memory-profile-not-prepared')
  const profile = fs.realpathSync(directory)
  check(profile === path.normalize(directory) && !fs.lstatSync(directory).isSymbolicLink())
  if (exists(path.join(profile, retiredFile))) throw new Error('retired-memory-profile')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  return !explicit
}

module.exports = { configureDefaultProfile, readUnifiedProfile, retiredFile, archiveName, receiptFile: UNIFIED_PROFILE_FILE }
