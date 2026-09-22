/**
 * Chooses the renderer persistence backend. In Electron the Stage keeps its
 * existing `localStorage`-shaped stores but routes them through the thin
 * desktop bridge, so Settings and Conversations live in one stable file in the
 * Electron userData directory regardless of whether the renderer was loaded from
 * the Vite dev server or the built `aisling://stage` scheme. In a plain browser
 * it keeps using `localStorage`.
 *
 * `Pick<Storage, 'getItem' | 'setItem'>` is the exact surface the two stores use.
 */
export type PersistentStorage = Pick<Storage, 'getItem' | 'setItem'>

const AISLING_KEYS = [
  'aisling.config.v1',
  'aisling.consciousness.config.v1',
  'aisling.conversations.v1',
  'aisling.conversation.v1',
  'aisling.presentation.character-display.v1',
]

function desktopBridge(): PersistentStorage | undefined {
  if (typeof window === 'undefined')
    return undefined
  return window.aislingDesktop?.storage
}

/**
 * One-time minimal migration: when the desktop bridge is empty and the current
 * renderer origin's `localStorage` already holds Aisling data (from a previous
 * dev-server run), copy those keys into the bridge so existing configuration
 * and conversations are not silently orphaned.
 */
function migrateLocalStorageIfNeeded(bridge: PersistentStorage): void {
  if (typeof window === 'undefined')
    return
  const local = window.localStorage
  if (!local)
    return
  const bridgeHasData = AISLING_KEYS.some(key => bridge.getItem(key) !== null)
  if (bridgeHasData)
    return
  const localHasData = AISLING_KEYS.some(key => local.getItem(key) !== null)
  if (!localHasData)
    return
  for (const key of AISLING_KEYS) {
    const value = local.getItem(key)
    if (value !== null)
      bridge.setItem(key, value)
  }
}

export function resolvePersistentStorage(): PersistentStorage {
  const bridge = desktopBridge()
  if (!bridge)
    return window.localStorage
  migrateLocalStorageIfNeeded(bridge)
  return bridge
}
