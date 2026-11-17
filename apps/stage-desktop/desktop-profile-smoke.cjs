// Real Main entry; all data and Mirror writes remain inside the marked rehearsal root.
const { app, dialog, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const [base, mode = 'read'] = process.argv.slice(2)
const allowed = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p2')
assert(path.resolve(base).startsWith(allowed + path.sep))
const expected = base + '-note-v2'
app.setPath('userData', base); app.setPath('sessionData', base)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
dialog.showErrorBox = () => {}
let failed = false
const timeout = setTimeout(() => app.exit(2), 50000)
app.on('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith('http://localhost:5174/') }))
})
const store = require('./desktop-store.cjs')
const originalConfig = store.readStoredConfig
store.readStoredConfig = () => {
  const config = structuredClone(originalConfig())
  if (config) config.desktopAwareness = { ...config.desktopAwareness, enabled: false, situationEnabled: false }
  return config
}
// Redirect only the adapter's Vault destination; persisted user configuration remains intact.
const mirror = require('./obsidian-control.cjs'), vault = path.join(path.dirname(base), 'isolated-vault')
fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true })
mirror.mirrorConfig = () => ({ enabled: true, vault })
const desktop = require('./desktop-app.cjs'), start = desktop.startDesktop
desktop.startDesktop = async options => {
  let service
  try {
    const win = await start({ ...options, show: false, noteV2: { onService: value => { service = value } } })
    assert(!['lock', 'invalid'].includes(mode), 'Invalid/second instance unexpectedly opened')
    assert.equal(app.getPath('userData'), expected)
    assert.equal(app.getPath('sessionData'), expected)
    assert(service)
    const web = win.contentView.children[0].webContents
    const result = await web.executeJavaScript(`(async () => {
      const d = window.aislingDesktop;
      const snapshot = await d.noteRecall.snapshot();
      let legacyBlocked = false;
      try { await d.recallHeads() } catch { legacyBlocked = true }
      return { bridge: !!d.noteFormation, snapshot: !!snapshot, legacyBlocked: legacyBlocked && !d.memoryOrganization && !d.reflectionStorage };
    })()`)
    assert(result.bridge && result.snapshot && result.legacyBlocked, JSON.stringify(result))
    if (mode === 'concurrent') {
      const env = { ...process.env }; delete env.AISLING_DEV_PROFILE
      env.AISLING_STAGE_URL = ''; env.AISLING_DEV = ''
      const child = await promisify(execFile)(process.execPath, [__filename, base, 'lock'], { env, windowsHide: true, timeout: 25000 })
      assert.match(child.stdout, /p2-smoke:lock-blocked/)
    }
    const status = await service.mirrorStatus()
    assert.equal(status.vault, vault)
    console.log('p2-smoke:' + JSON.stringify({ mode, profile: expected, url: new URL(web.getURL()).origin, ...result }))
    clearTimeout(timeout); app.quit()
    return win
  } catch (error) {
    if (mode === 'lock' && /exclusive profile/.test(error.message)) console.log('p2-smoke:lock-blocked')
    else if (mode === 'invalid' && /unified|database|formation-jobs|erase-journal|authority/i.test(error.message)) console.log('p2-smoke:invalid-blocked')
    else { failed = true; console.error(error); process.exitCode = 1 }
    clearTimeout(timeout)
    throw error
  }
}
app.on('will-quit', () => { if (failed) process.exitCode = 1 })
require('./main.cjs')
