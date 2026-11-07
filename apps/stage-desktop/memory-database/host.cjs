const fs = require('node:fs')
const path = require('node:path')
const { createMemoryDatabaseStore } = require('./store.cjs')
const { NOTE_V1_FILE } = require('./protocol.cjs')

/** @param {Electron.App} app */
function configureProfile(app, noteV1) {
  const directory = process.env.AISLING_MEMORY_DB_P0_PROFILE
  if (!directory || !path.isAbsolute(directory)) throw new Error('P0 requires an absolute, isolated profile directory')
  const profile = fs.realpathSync(directory)
  const existing = app.getPath('userData')
  const normal = fs.existsSync(existing) ? fs.realpathSync(existing) : path.resolve(existing)
  const overlap = (parent, target) => {
    const relative = path.relative(parent, target)
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)
  }
  if (overlap(normal, profile) || overlap(profile, normal)) throw new Error('P0 profile overlaps the existing application profile')
  const name = noteV1 ? 'aisling-memory-note-v1' : 'aisling-memory-db-p0'
  const mark = path.join(profile, `.${name}-profile`)
  if (fs.readdirSync(profile).length === 0) fs.writeFileSync(mark, `${name}\n`, { flag: 'wx' })
  if (!fs.existsSync(mark) || !fs.lstatSync(mark).isFile() || fs.readFileSync(mark, 'utf8') !== `${name}\n`)
    throw new Error('P0 profile must be empty on first use')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  return profile
}

/** @param {Electron.App} app @param {(event: string, detail: any) => void} [diagnostic] */
function attachMemoryDatabase(app, diagnostic, noteV1 = false) {
  const profile = configureProfile(app, noteV1)
  const report = (event, detail) => {
    if (event !== 'timing') console.log('[memory-db-p0]', JSON.stringify({ event, ...detail }))
    diagnostic?.(event, detail)
  }
  const store = createMemoryDatabaseStore(async () => {
    const resources = app.isPackaged
      ? path.join(process.resourcesPath, 'memory-database')
      : process.env.AISLING_MEMORY_DB_P0_RESOURCES || path.resolve(__dirname, '../../../.local/memory-database')
    if (!path.isAbsolute(resources)) throw new Error('P0 resources must use an absolute directory')
    const node = path.join(resources, 'runtime', 'node.exe')
    const entry = path.join(resources, 'worker.cjs')
    await Promise.all([fs.promises.access(node), fs.promises.access(entry)])
    const directory = path.join(profile, noteV1 ? 'memory-note-v1' : 'memory-db-p0')
    await fs.promises.mkdir(directory, { recursive: true })
    if (await fs.promises.realpath(directory) !== directory
      || (await fs.promises.readdir(directory, { withFileTypes: true })).some(item => !item.isFile()))
      throw new Error('Invalid P0 database directory')
    return { node, entry, file: path.join(directory, noteV1 ? NOTE_V1_FILE : 'memory.lbdb') }
  }, report)
  const ready = store.open()
  void ready.catch(error => report('startup-failed', { code: error.code || 'configuration', message: error.message }))
  let quitting = false
  let released = false
  /** @param {Electron.Event} event */
  function deferQuit(event) {
    if (released) return false
    event.preventDefault()
    if (!quitting) {
      quitting = true
      const started = performance.now()
      void store.close().catch(error => report('close-failed', { code: error.code, message: error.message })).finally(() => {
        report('closed', { elapsedMs: performance.now() - started })
        released = true
        app.quit()
      })
    }
    return true
  }
  return { store, ready, deferQuit }
}
module.exports = { attachMemoryDatabase }
