const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { createDesktopObserver } = require('./desktop-activity.cjs')
const { createTypeSafeJudge } = require('./desktop-judge.cjs')
const {
  buildStageUrl,
  isBuiltRendererAvailable,
  registerStageScheme,
  registerStageProtocol,
} = require('./desktop-protocol.cjs')
const { registerStorageIpc } = require('./desktop-store.cjs')

// Must run before app.whenReady(): this makes `aisling://` a standard, secure
// origin so the built renderer keeps working localStorage + history routing.
registerStageScheme()

const DEFAULT_STAGE_URL = 'http://localhost:5174'
const desktopObserver = createDesktopObserver()
const semanticJudge = createTypeSafeJudge()
/** @type {AbortController | undefined} */
let judgeAbort
/** @type {import('electron').BrowserWindow | undefined} */
let mainWindow
let ipcRegistered = false
let appEventsRegistered = false

/**
 * Origin of a Stage URL. Electron registers `aisling` as standard+secure, but
 * Node's `new URL()` (used in the main process) does not know that and returns
 * `"null"` for non-special schemes, so the custom scheme is handled explicitly.
 * @param {string} value
 * @returns {string | null}
 */
function stageOriginOf(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'aisling:')
      return `aisling://${url.host}`
    return url.origin
  }
  catch {
    return null
  }
}

/** @param {string} value @param {string} stageUrl */
function isStageUrl(value, stageUrl) {
  const a = stageOriginOf(value)
  const b = stageOriginOf(stageUrl)
  return Boolean(a && b && a === b)
}

/**
 * Resolves how the Stage is loaded:
 *  - `AISLING_STAGE_URL` set        → development (Vite dev server)
 *  - built renderer available       → production (`aisling://stage`)
 *  - otherwise                      → development fallback (keeps smoke/back-compat)
 * @returns {{ mode: 'dev' | 'prod', url: string, origin: string | null }}
 */
function resolveStageTarget() {
  const envUrl = process.env.AISLING_STAGE_URL
  if (envUrl)
    return { mode: 'dev', url: envUrl, origin: stageOriginOf(envUrl) }
  if (isBuiltRendererAvailable()) {
    const url = buildStageUrl()
    return { mode: 'prod', url, origin: stageOriginOf(url) }
  }
  return { mode: 'dev', url: DEFAULT_STAGE_URL, origin: stageOriginOf(DEFAULT_STAGE_URL) }
}

/** @param {boolean} enabled @param {string} message @param {...unknown} rest */
function diagnostic(enabled, message, ...rest) {
  if (enabled)
    console.log(`[desktop] ${message}`, ...rest)
}

/** @param {unknown} error */
function describeError(error) {
  return error instanceof Error ? (error.stack || error.message) : String(error)
}

/** @param {boolean} diagnostics */
function registerAppDiagnostics(diagnostics) {
  if (appEventsRegistered)
    return
  appEventsRegistered = true
  app.on('child-process-gone', (_event, details) => {
    diagnostic(diagnostics, `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
  })
  app.on('window-all-closed', () => {
    diagnostic(diagnostics, 'window-all-closed')
    app.quit()
  })
  app.on('before-quit', stopDesktopAwareness)
}

function stopDesktopAwareness() {
  judgeAbort?.abort()
  judgeAbort = undefined
  desktopObserver.stop()
}

/**
 * Creates the real Stage window. `show: false` exists only for smoke callers;
 * the executable main entry always passes `show: true`.
 * @param {{ show?: boolean, diagnostics?: boolean, stageUrl?: string }} [options]
 */
async function createWindow(options = {}) {
  const show = options.show ?? true
  const diagnostics = options.diagnostics ?? true
  const stageUrl = options.stageUrl ?? resolveStageTarget().url
  if (stageUrl.startsWith('aisling:'))
    registerStageProtocol()
  const preloadPath = path.join(__dirname, 'preload.cjs')

  diagnostic(diagnostics, 'creating BrowserWindow')
  diagnostic(diagnostics, `preload: ${preloadPath}`)
  mainWindow = new BrowserWindow({
    show,
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    center: true,
    title: 'Aisling',
    backgroundColor: '#0d0b16',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const window = mainWindow
  const contents = window.webContents
  diagnostic(diagnostics, 'BrowserWindow created')

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isStageUrl(url, stageUrl)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isStageUrl(url, stageUrl)) event.preventDefault()
  })
  contents.on('did-start-loading', () => diagnostic(diagnostics, 'did-start-loading'))
  contents.on('did-finish-load', () => {
    diagnostic(diagnostics, 'did-finish-load')
    if (show && !window.isDestroyed()) {
      window.show()
      window.focus()
    }
    void contents.executeJavaScript(`({
      desktop: typeof window.aislingDesktop,
      readDesktopContext: typeof window.aislingDesktop?.readDesktopContext,
    })`, true).then((bridge) => {
      diagnostic(diagnostics, `renderer bridge: ${bridge.desktop}, readDesktopContext: ${bridge.readDesktopContext}`)
    }).catch(error => console.error('[desktop] renderer bridge check failed:', describeError(error)))
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[desktop] did-fail-load: code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} ${errorDescription}`)
  })
  contents.on('render-process-gone', (_event, details) => {
    console.error(`[desktop] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
  })
  contents.on('preload-error', (_event, failedPreloadPath, error) => {
    console.error(`[desktop] preload-error: ${failedPreloadPath}`, describeError(error))
  })
  contents.on('console-message', (...args) => {
    if (!diagnostics)
      return
    // Electron 44 supplies one details object after the event. Keep a legacy
    // fallback without declaring the deprecated five-argument listener shape.
    const payload = /** @type {unknown} */ (args[1])
    if (typeof payload === 'object' && payload) {
      const details = /** @type {{ message?: unknown, sourceId?: unknown, lineNumber?: unknown }} */ (payload)
      console.log(`[desktop] renderer console: ${String(details.message ?? '')} (${String(details.sourceId ?? '')}:${String(details.lineNumber ?? '')})`)
    }
    else {
      console.log(`[desktop] renderer console: ${String(args[2] ?? '')} (${String(args[4] ?? '')}:${String(args[3] ?? '')}) level=${String(payload ?? '')}`)
    }
  })
  window.on('ready-to-show', () => {
    diagnostic(diagnostics, 'ready-to-show')
    if (show && !window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })
  window.on('unresponsive', () => console.error('[desktop] window unresponsive'))
  window.on('closed', () => {
    diagnostic(diagnostics, 'window closed')
    stopDesktopAwareness()
    if (mainWindow === window)
      mainWindow = undefined
  })

  // Dev must never depend on ready-to-show: make the dark, normally-sized
  // window visible before navigation, then show/focus it again after loading.
  if (show) {
    window.center()
    window.show()
    window.focus()
    diagnostic(diagnostics, 'window shown')
  }

  diagnostic(diagnostics, `loading: ${stageUrl}`)
  try {
    await window.loadURL(stageUrl)
  }
  catch (error) {
    console.error(`[desktop] loadURL failed: ${stageUrl}`, describeError(error))
    if (show && !window.isDestroyed()) {
      window.show()
      window.focus()
    }
  }
  return window
}

/** @param {{ show?: boolean, diagnostics?: boolean, stageUrl?: string }} [options] */
async function startDesktop(options = {}) {
  const diagnostics = options.diagnostics ?? true
  await app.whenReady()
  diagnostic(diagnostics, 'app ready')
  registerAppDiagnostics(diagnostics)
  registerStorageIpc()

  const target = options.stageUrl
    ? {
        mode: options.stageUrl.startsWith('aisling:') ? 'prod' : 'dev',
        url: options.stageUrl,
        origin: stageOriginOf(options.stageUrl),
      }
    : resolveStageTarget()
  if (target.mode === 'prod')
    registerStageProtocol()

  if (!ipcRegistered) {
    ipcRegistered = true
    const allowedOrigin = target.origin
    const trusted = event => Boolean(mainWindow && event.sender === mainWindow.webContents
      && event.senderFrame === mainWindow.webContents.mainFrame
      && stageOriginOf(event.senderFrame.url) === allowedOrigin)
    ipcMain.handle('aisling:desktop-awareness:set', (event, enabled) => {
      if (!trusted(event) || typeof enabled !== 'boolean')
        throw new Error('Untrusted desktop awareness request')
      if (!enabled) {
        stopDesktopAwareness()
        return desktopObserver.status()
      }
      return desktopObserver.start()
    })
    ipcMain.handle('aisling:desktop-awareness:read', (event) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      return desktopObserver.status()
    })
    ipcMain.handle('aisling:desktop-awareness:judge', async (event) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      const snapshot = desktopObserver.status()
      if (!snapshot.enabled || !snapshot.context)
        throw new Error(snapshot.error || 'Desktop observer has no current context.')
      judgeAbort?.abort()
      const abort = new AbortController()
      judgeAbort = abort
      try {
        return { context: snapshot.context, scores: await semanticJudge.judge(snapshot.context, abort.signal) }
      }
      finally {
        if (judgeAbort === abort)
          judgeAbort = undefined
      }
    })
  }
  return createWindow({ ...options, stageUrl: target.url })
}

module.exports = { DEFAULT_STAGE_URL, createWindow, startDesktop }
