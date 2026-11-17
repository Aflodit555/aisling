const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')
const { createMemoryLifecycle } = require('./memory-lifecycle.cjs')
const { exists, v1Path, workerConfig } = require('./memory-authority.cjs')

function legacyArchive({ profile, resources, readData, writeData, readReflections, writeReflections }) {
  const file = v1Path(profile)
  const store = createMemoryDatabaseStore(workerConfig(resources, file), () => {})
  const privacy = createMemoryLifecycle({ profile, store, readData, writeData, readReflections, writeReflections,
    hasDatabase: () => exists(file) })
  return {
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

function unifiedArchive(profile, resources) {
  const fs = require('node:fs'), path = require('node:path')
  const { readUnifiedProfile, archiveName } = require('./desktop-profile.cjs')
  if (!readUnifiedProfile(profile)) throw new Error('invalid-unified-memory-profile')
  const directory = path.join(profile, archiveName)
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
  const write = (name, value) => require('./memory-migration.cjs').durable(path.join(directory, name), JSON.stringify(value))
  return legacyArchive({ profile: directory, resources,
    readData: () => read('aisling-store.json'), writeData: value => write('aisling-store.json', value),
    readReflections: () => read('aisling-reflections.v1.json'), writeReflections: value => write('aisling-reflections.v1.json', value) })
}

module.exports = { legacyArchive, unifiedArchive }
