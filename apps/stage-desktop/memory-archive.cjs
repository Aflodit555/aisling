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

module.exports = { legacyArchive }
