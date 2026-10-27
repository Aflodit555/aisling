const { app, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { Buffer } = require('node:buffer')

/**
 * Thin Desktop persistence bridge. The renderer keeps its existing
 * `localStorage`-shaped stores; when it runs inside Electron those stores are
 * routed through this file-backed store so Settings and Conversations have a
 * single, stable home in the Electron userData directory regardless of the
 * renderer origin (dev server vs built `aisling://stage`).
 *
 * Synchronous `ipcMain.on` + `event.returnValue` handlers back the renderer's
 * `sendSync` calls. The store is a single small JSON file; reads/writes are
 * infrequent and tiny, so this stays a bridge rather than a database.
 */
const CHANNELS = {
  get: 'aisling:storage:get',
  set: 'aisling:storage:set',
}

function storeFilePath() {
  return path.join(app.getPath('userData'), 'aisling-store.json')
}

/** @returns {Record<string, unknown>} */
function readStore(strict = false, file = storeFilePath()) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    if (strict) throw new Error('Invalid desktop storage')
    return {}
  }
  catch (error) {
    if (strict && error.code !== 'ENOENT') throw error
    return {}
  }
}

function writeStore(data, file = storeFilePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(data))
    fs.renameSync(temporary, file)
  }
  finally {
    try { fs.unlinkSync(temporary) }
    catch { /* A failed cleanup must not replace the original write result. */ }
  }
}

/** @param {unknown} key */
function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 256
}

/**
 * Reads the renderer's saved platform config (`aisling.config.v1`) straight from
 * the same JSON file the storage bridge writes, so the main process can use
 * renderer-persisted settings (e.g. the Jev API Key) without an IPC round-trip.
 * @returns {Record<string, unknown> | null}
 */
function readStoredConfig() {
  const raw = readStore()['aisling.config.v1']
  if (typeof raw !== 'string')
    return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  }
  catch {
    return null
  }
}

function readStoredLanguage() {
  return readStore()['aisling.language.v1'] === 'zh-CN' ? 'zh-CN' : 'en'
}

let registered = false

function registerStorageIpc() {
  if (registered)
    return
  registered = true

  ipcMain.on(CHANNELS.get, (event, key) => {
    if (!isValidKey(key)) {
      event.returnValue = null
      return
    }
    const value = readStore()[key]
    event.returnValue = typeof value === 'string' ? value : null
  })

  ipcMain.on(CHANNELS.set, (event, key, value) => {
    if (!isValidKey(key) || typeof value !== 'string') {
      event.returnValue = false
      return
    }
    try {
      const data = readStore(true)
      data[key] = value
      writeStore(data)
      event.returnValue = true
    }
    catch {
      event.returnValue = false
    }
  })

  const reflectionsFile = () => path.join(app.getPath('userData'), 'aisling-reflections.v1.json')
  ipcMain.on('aisling:reflections:read', event => {
    try { event.returnValue = { ok: true, value: fs.readFileSync(reflectionsFile(), 'utf8') } }
    catch (error) { event.returnValue = error.code === 'ENOENT' ? { ok: true, value: null } : { ok: false } }
  })
  ipcMain.on('aisling:reflections:write', (event, value) => {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2_000_000) { event.returnValue = false; return }
    try {
      const data = JSON.parse(value)
      if (!data || data.version !== 1 || !Array.isArray(data.reflections) || !Array.isArray(data.batches) || !Array.isArray(data.progress)) { event.returnValue = false; return }
      const previous = readStore(true, reflectionsFile())
      if (Object.keys(previous).length && previous.version !== 1) { event.returnValue = false; return }
      writeStore(data, reflectionsFile())
      event.returnValue = true
    }
    catch { event.returnValue = false }
  })
}

module.exports = { CHANNELS, registerStorageIpc, readStoredConfig, readStoredLanguage }
