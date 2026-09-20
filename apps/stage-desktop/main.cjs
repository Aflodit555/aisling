const { app } = require('electron')
const { startDesktop } = require('./desktop-app.cjs')

// This file is the executable Electron entry declared by package.json. Keep it
// unconditional: Electron's app entry is not a Node CLI and must not depend on
// `require.main === module` to decide whether to create the real window.
console.log('[desktop] main started')
console.log(`[desktop] electron version: ${process.versions.electron}`)

startDesktop({ show: true, diagnostics: true }).catch((error) => {
  console.error('[desktop] startup failed:', error)
  app.quit()
})
