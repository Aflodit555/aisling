const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')
const { createMemoryLifecycle } = require('./memory-lifecycle.cjs')
const { exists, v1Path, workerConfig } = require('./memory-authority.cjs')

function legacyArchive({ profile, resources, readData, writeData, readReflections, writeReflections }) {
  const file = v1Path(profile)
  const store = createMemoryDatabaseStore(workerConfig(resources, file), () => {})
  const privacy = createMemoryLifecycle({ profile, store, readData, writeData, readReflections, writeReflections,
    hasDatabase: () => exists(file) })
  return {
    store,
    freeze: () => store.close(),
    privacy,
    async erase(steps) {
      try {
        privacy.recordArchiveErasure(steps)
        await privacy.recover()
        privacy.assertReadable()
      } finally { await store.close() }
    },
  }
}

function profileArchive(directory, resources) {
  const fs = require('node:fs'), path = require('node:path')
  const read = name => {
    const value = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    if (name === 'aisling-reflections.v1.json' && (value.version !== 1 || !Array.isArray(value.reflections)
      || !Array.isArray(value.batches) || !Array.isArray(value.progress))) throw new Error('Invalid archived Reflection storage')
    return value
  }
  const write = (name, value) => require('./memory-files.cjs').durable(path.join(directory, name), JSON.stringify(value))
  return legacyArchive({ profile: directory, resources,
    readData: () => read('aisling-store.json'), writeData: value => write('aisling-store.json', value),
    readReflections: () => read('aisling-reflections.v1.json'), writeReflections: value => write('aisling-reflections.v1.json', value) })
}

function unifiedArchive(profile, resources) {
  const path = require('node:path')
  const { readUnifiedProfile, archiveName } = require('./desktop-profile.cjs')
  if (!readUnifiedProfile(profile)) throw new Error('invalid-unified-memory-profile')
  return profileArchive(path.join(profile, archiveName), resources)
}

module.exports = { legacyArchive, unifiedArchive, profileArchive }
