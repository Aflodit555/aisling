const { app, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

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
function readStore() {
  try {
    const raw = fs.readFileSync(storeFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function writeStore(data) {
  const file = storeFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
}

/** @param {unknown} key */
function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 256
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
    const data = readStore()
    data[key] = value
    writeStore(data)
    event.returnValue = true
  })
}

module.exports = { CHANNELS, registerStorageIpc }
