const fs = require('node:fs/promises')
const path = require('node:path')
const { validateVault, defaultVault } = require('./memory-database/obsidian-mirror.cjs')

function mirrorConfig(config) {
  const saved = config?.memory?.obsidianMirror
  return saved ? { enabled: saved.enabled === true, vault: typeof saved.vault === 'string' ? saved.vault.trim() : '' }
    : { enabled: false, vault: defaultVault }
}

async function openObsidian(vault, registryFile, openExternal) {
  try {
    const canonical = await validateVault(vault)
    const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'))
    const id = Object.keys(registry.vaults || {}).find(key => /^[a-f0-9]{16}$/.test(key)
      && typeof registry.vaults[key]?.path === 'string'
      && path.resolve(registry.vaults[key].path).toLowerCase() === canonical.toLowerCase())
    if (!id) return { error: 'Open this vault in Obsidian first.' }
    await openExternal(`obsidian://open?vault=${encodeURIComponent(id)}`)
    return { error: '' }
  } catch { return { error: 'Could not open Obsidian. Check the vault and installation.' } }
}

module.exports = { mirrorConfig, openObsidian }
