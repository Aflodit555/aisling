const { app, BaseWindow, WebContentsView, Menu, ipcMain, nativeTheme, screen } = require('electron')
const path = require('node:path')
const { createDesktopObserver } = require('./desktop-activity.cjs')
const { createTypeSafeJudge } = require('./desktop-judge.cjs')
const {
  buildStageUrl,
  isBuiltRendererAvailable,
  registerStageScheme,
  registerStageProtocol,
} = require('./desktop-protocol.cjs')
const { registerStorageIpc, readStoredConfig } = require('./desktop-store.cjs')

// Must run before app.whenReady(): this makes `aisling://` a standard, secure
// origin so the built renderer keeps working localStorage + history routing.
registerStageScheme()

const DEFAULT_STAGE_URL = 'http://localhost:5174'
const desktopObserver = createDesktopObserver()
const semanticJudge = createTypeSafeJudge()
/** @type {AbortController | undefined} */
let judgeAbort

/**
 * Resolves the Jev API key: the frontend-saved config wins, then the
 * `TYPESAFE_API_KEY` environment variable as a fallback. The saved value is
 * never written back to the environment and never logged.
 * @returns {string}
 */
function resolveJevApiKey() {
  const config = readStoredConfig()
  const awareness = config && typeof config.desktopAwareness === 'object'
    ? /** @type {Record<string, unknown>} */ (config.desktopAwareness)
    : undefined
  const saved = awareness ? awareness.jevApiKey : undefined
  if (typeof saved === 'string' && saved.trim())
    return saved.trim()
  return process.env.TYPESAFE_API_KEY || ''
}

// Matches the renderer's paper/ink --bg so the window does not flash before the Stage paints.
const stageBackground = () => nativeTheme.shouldUseDarkColors ? '#0F0F1A' : '#F4ECD8'

/** @type {import('electron').BaseWindow | undefined} */
let mainWindow
/** @type {import('electron').BaseWindow | undefined} */
let desktopWindow
/** @type {import('electron').WebContentsView | undefined} */
let stageView
let mode = 'stage'
let switching = false
let quitting = false
let desktopDisplayId
let pointerTimer
let pointerBusy = false
let pointerKind = 'none'
let pointerIgnored

function stopDesktopPointer() {
  clearInterval(pointerTimer)
  pointerTimer = undefined
  pointerBusy = false
  pointerKind = 'none'
  pointerIgnored = undefined
}

function updateDesktopPointer(kind) {
  if (!desktopWindow || desktopWindow.isDestroyed() || !stageView) return
  const ignore = kind === 'none'
  if (pointerIgnored !== ignore) {
    desktopWindow.setIgnoreMouseEvents(ignore, { forward: true })
    pointerIgnored = ignore
  }
  if (pointerKind !== kind) {
    pointerKind = kind
    stageView.webContents.send('aisling:desktop-pointer', kind)
  }
}

async function pollDesktopPointer() {
  if (pointerBusy || mode !== 'desktop' || !desktopWindow || !stageView) return
  const point = screen.getCursorScreenPoint()
  const bounds = desktopWindow.getContentBounds()
  const x = point.x - bounds.x
  const y = point.y - bounds.y
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
    updateDesktopPointer('none')
    return
  }
  pointerBusy = true
  const desktop = desktopWindow
  try {
    const kind = await stageView.webContents.executeJavaScript(`(() => {
      const target = document.elementFromPoint(${x}, ${y})
      if (target?.closest('.character-hit')) return 'character'
      if (target?.closest('.desktop-composer')) return 'input'
      return target?.closest('[data-desktop-hit]') ? 'ui' : 'none'
    })()`)
    if (mode === 'desktop' && desktopWindow === desktop) updateDesktopPointer(kind)
  }
  catch { /* renderer may be loading or switching windows */ }
  finally { pointerBusy = false }
}
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
  app.on('before-quit', () => {
    quitting = true
    stopDesktopPointer()
    stopDesktopAwareness()
    if (stageView && !stageView.webContents.isDestroyed())
      stageView.webContents.close()
  })
}

function resizeView(window) {
  if (!stageView || window.isDestroyed()) return
  const [width, height] = window.getContentSize()
  stageView.setBounds({ x: 0, y: 0, width, height })
}

function desktopBounds() {
  const display = screen.getAllDisplays().find(item => item.id === desktopDisplayId)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const w = Math.min(360, width)
  const h = Math.min(460, height)
  return { x: x + width - w - Math.min(24, Math.max(0, width - w)), y: y + height - h, width: w, height: h }
}

function enterDesktopMode() {
  if (mode === 'desktop' || !mainWindow || !stageView) return
  desktopDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  desktopWindow = new BaseWindow({
    ...desktopBounds(), show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false, title: 'Aisling Desktop',
  })
  const desktop = desktopWindow
  desktop.setMenu(null)
  desktop.on('close', event => {
    if (!switching && !quitting) {
      event.preventDefault()
      returnToStage()
    }
  })
  desktop.on('closed', () => {
    if (desktopWindow === desktop) {
      stopDesktopPointer()
      desktopWindow = undefined
      if (!switching && !quitting && mode === 'desktop') returnToStage()
    }
  })
  desktop.on('resize', () => resizeView(desktop))
  switching = true
  mainWindow.contentView.removeChildView(stageView)
  desktop.contentView.addChildView(stageView)
  stageView.setBackgroundColor('#00000000')
  resizeView(desktop)
  mode = 'desktop'
  stageView.webContents.send('aisling:mode', mode)
  mainWindow.hide()
  desktop.show()
  // ponytail: one cursor probe every 50 ms; use native hit testing if this becomes measurable.
  pointerTimer = setInterval(() => void pollDesktopPointer(), 50)
  void pollDesktopPointer()
  switching = false
}

function returnToStage() {
  if (mode !== 'desktop' || !mainWindow || mainWindow.isDestroyed() || !stageView) return
  switching = true
  stopDesktopPointer()
  if (desktopWindow && !desktopWindow.isDestroyed())
    desktopWindow.contentView.removeChildView(stageView)
  mainWindow.contentView.addChildView(stageView)
  stageView.setBackgroundColor(stageBackground())
  resizeView(mainWindow)
  mode = 'stage'
  stageView.webContents.send('aisling:mode', mode)
  mainWindow.show()
  mainWindow.focus()
  stageView.webContents.focus()
  desktopWindow?.destroy()
  desktopWindow = undefined
  desktopDisplayId = undefined
  switching = false
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

  diagnostic(diagnostics, 'creating Stage window')
  diagnostic(diagnostics, `preload: ${preloadPath}`)
  mainWindow = new BaseWindow({
    show,
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    center: true,
    title: 'Aisling',
    backgroundColor: stageBackground(),
  })
  const window = mainWindow
  stageView = new WebContentsView({ webPreferences: {
    preload: preloadPath, contextIsolation: true, nodeIntegration: false,
    sandbox: true, backgroundThrottling: false,
  } })
  stageView.setBackgroundColor(stageBackground())
  window.contentView.addChildView(stageView)
  resizeView(window)
  window.on('resize', () => resizeView(window))
  window.setMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Desktop Mode', icon: path.join(__dirname, 'assets', 'desktop-mode.png'), click: enterDesktopMode },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
  const contents = stageView.webContents
  diagnostic(diagnostics, 'Stage window created')

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
      contents.focus()
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
  window.on('closed', () => {
    diagnostic(diagnostics, 'window closed')
    stopDesktopAwareness()
    if (mainWindow === window) mainWindow = undefined
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.destroy()
    if (stageView && !stageView.webContents.isDestroyed()) stageView.webContents.close()
    stageView = undefined
  })

  // Dev must never depend on ready-to-show: show the Stage before navigation.
  if (show) {
    window.center()
    window.show()
    diagnostic(diagnostics, 'window shown')
  }

  diagnostic(diagnostics, `loading: ${stageUrl}`)
  try {
    await contents.loadURL(stageUrl)
  }
  catch (error) {
    console.error(`[desktop] loadURL failed: ${stageUrl}`, describeError(error))
    if (show && !window.isDestroyed()) {
      window.show()
      contents.focus()
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
  screen.on('display-metrics-changed', () => {
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.setBounds(desktopBounds())
  })
  screen.on('display-removed', () => {
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.setBounds(desktopBounds())
  })

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
    const trusted = event => Boolean(stageView && event.sender === stageView.webContents
      && event.senderFrame === stageView.webContents.mainFrame
      && stageOriginOf(event.senderFrame.url) === allowedOrigin)
    ipcMain.handle('aisling:mode:get', event => {
      if (!trusted(event)) throw new Error('Untrusted mode request')
      return mode
    })
    ipcMain.handle('aisling:mode:return', event => {
      if (!trusted(event)) throw new Error('Untrusted mode request')
      returnToStage()
    })
    ipcMain.handle('aisling:desktop-awareness:set', (event, enabled) => {
      if (!trusted(event) || typeof enabled !== 'boolean')
        throw new Error('Untrusted desktop awareness request')
      if (!enabled) {
        stopDesktopAwareness()
        return desktopObserver.status()
      }
      return desktopObserver.start()
    })
    ipcMain.handle('aisling:desktop-awareness:read', async (event) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      const current = desktopObserver.status()
      if (current.enabled) {
        // On-demand: ask the long-running kernel for an immediate snapshot of
        // the cached foreground window instead of only serving the last timer poll.
        // A failed request falls back to the last known status (never throws).
        try {
          await desktopObserver.request()
        }
        catch { /* keep the last known status */ }
      }
      return desktopObserver.status()
    })
    ipcMain.handle('aisling:desktop-awareness:judge', async (event) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      const snapshot = desktopObserver.status()
      if (!snapshot.enabled || !snapshot.context)
        throw new Error(snapshot.error || 'Desktop observer has no current context.')
      const apiKey = resolveJevApiKey()
      if (!apiKey)
        throw new Error('Desktop semantic judge unavailable: no Jev API Key configured.')
      judgeAbort?.abort()
      const abort = new AbortController()
      judgeAbort = abort
      try {
        return { context: snapshot.context, scores: await semanticJudge.judge(snapshot.context, abort.signal, apiKey) }
      }
      finally {
        if (judgeAbort === abort)
          judgeAbort = undefined
      }
    })
    ipcMain.handle('aisling:desktop-awareness:test', async (event, apiKey) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : resolveJevApiKey()
      if (!key)
        throw new Error('No Jev API Key configured. Configure it or set TYPESAFE_API_KEY.')
      return semanticJudge.test(key)
    })
  }
  return createWindow({ ...options, stageUrl: target.url })
}

module.exports = { DEFAULT_STAGE_URL, createWindow, startDesktop, enterDesktopMode, returnToStage }
