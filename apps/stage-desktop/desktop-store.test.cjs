const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function fixture() {
  const file = path.join('user-data', 'aisling-store.json'), files = new Map(), handlers = new Map()
  let failWrite = false, failRead = false
  const module = { exports: {} }
  vm.runInNewContext(readFileSync(path.join(__dirname, 'desktop-store.cjs'), 'utf8'), {
    module, require: name => name === 'electron'
      ? { app: { getPath: () => 'user-data' }, ipcMain: { on: (channel, handler) => handlers.set(channel, handler) } }
      : name === 'node:fs' ? {
        mkdirSync() {},
        readFileSync: target => {
          if (failRead) throw Object.assign(new Error('private path'), { code: 'EACCES' })
          if (!files.has(target)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
          return files.get(target)
        },
        writeFileSync: (target, text) => {
          files.set(target, failWrite ? 'partial' : text)
          if (failWrite) throw Object.assign(new Error('private path'), { code: 'ENOSPC' })
        },
        renameSync: (source, target) => { files.set(target, files.get(source)); files.delete(source) },
        unlinkSync: target => { files.delete(target) },
      } : require(name),
  })
  module.exports.registerStorageIpc()
  return { files, file, setFailWrite: value => { failWrite = value }, setFailRead: value => { failRead = value },
    invoke(channel, ...args) { const event = {}; handlers.get(channel)(event, ...args); return event.returnValue } }
}

test('failed desktop write returns a result and preserves all previously durable keys', () => {
  const f = fixture(), old = JSON.stringify({ 'aisling.conversations.v1': 'old history', 'aisling.config.v1': 'old config' })
  f.files.set(f.file, old); f.setFailWrite(true)
  assert.equal(f.invoke('aisling:storage:set', 'aisling.conversations.v1', 'new history'), false)
  assert.equal(f.files.get(f.file), old)
  assert.equal(f.files.size, 1)
  f.setFailWrite(false)
  assert.equal(f.invoke('aisling:storage:set', 'aisling.conversations.v1', 'new history'), true)
  assert.deepEqual(JSON.parse(f.files.get(f.file)), { 'aisling.conversations.v1': 'new history', 'aisling.config.v1': 'old config' })
})

test('unreadable or corrupt desktop storage cannot be replaced by an empty fallback', () => {
  const f = fixture(), old = JSON.stringify({ 'aisling.config.v1': 'preserve' })
  f.files.set(f.file, old); f.setFailRead(true)
  assert.equal(f.invoke('aisling:storage:set', 'aisling.conversations.v1', 'new'), false)
  assert.equal(f.files.get(f.file), old)
  f.setFailRead(false); f.files.set(f.file, '{invalid')
  assert.equal(f.invoke('aisling:storage:set', 'aisling.conversations.v1', 'new'), false)
  assert.equal(f.files.get(f.file), '{invalid')
})

test('preload preserves the desktop write result without paths or content', () => {
  let bridge, response = false
  vm.runInNewContext(readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
    process: { argv: [] }, require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } },
      ipcRenderer: { sendSync: () => response } }),
  })
  assert.equal(bridge.storage.setItem('key', 'private content'), false)
  response = true; assert.doesNotThrow(() => bridge.storage.setItem('key', 'value'))
  response = null; assert.equal(bridge.storage.getItem('key'), null)
  response = 'stored'; assert.equal(bridge.storage.getItem('key'), 'stored')
})
