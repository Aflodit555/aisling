const { app, dialog } = require('electron')
const { startDesktop } = require('./desktop-app.cjs')

// This file is the executable Electron entry declared by package.json. Keep it
// unconditional: Electron's app entry is not a Node CLI and must not depend on
// `require.main === module` to decide whether to create the real window.
console.log('[desktop] main started')
console.log(`[desktop] electron version: ${process.versions.electron}`)

startDesktop({ show: true, diagnostics: true, noteOnlyForNewProfiles: true }).catch((error) => {
  console.error('[desktop] startup failed:', error)
  if (['note-v2-profile-requires-explicit-mode', 'legacy-memory-profile-cannot-use-v2', 'unmarked-memory-state-requires-migration',
    'unknown-memory-authority', 'invalid-formation-jobs', 'migration-not-committed', 'invalid-migration-state',
    'memory-migration-requires-built-stage', 'migration-archive-required'].includes(error.message)) {
    const chinese = app.getLocale().toLowerCase().startsWith('zh')
    dialog.showErrorBox(chinese ? '记忆无法启动' : 'Memory could not start',
      chinese ? '当前资料的记忆格式无法安全打开。请保留资料文件。'
        : 'This profile’s memory format could not be opened safely. Keep the profile files.')
  }
  app.quit()
})
