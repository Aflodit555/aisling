const { app, BaseWindow, WebContentsView, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const ICON_PATH = path.join(__dirname, 'assets', 'desktop-mode.png')
const { createDesktopObserver } = require('./desktop-activity.cjs')
const { createTypeSafeJudge, normalizeConversation, candidateForSnapshot, recentReplyForSnapshot } = require('./desktop-judge.cjs')
const {
  buildStageUrl,
  isBuiltRendererAvailable,
  registerStageScheme,
  registerStageProtocol,
} = require('./desktop-protocol.cjs')
const { registerStorageIpc, readStoredConfig, readStoredLanguage, readDesktopData,
  readRawReflections,writeRawReflections,writeDesktopData,configureMemoryLifecycle } = require('./desktop-store.cjs')

// Must run before app.whenReady(): this makes `aisling://` a standard, secure
// origin so the built renderer keeps working localStorage + history routing.
registerStageScheme()

const DEFAULT_STAGE_URL = 'http://localhost:5174'
const DEV_STAGE_ORIGINS = new Set([DEFAULT_STAGE_URL, 'http://127.0.0.1:5174'])
const DEV_RESTART_EXIT = 75
const desktopObserver = createDesktopObserver()
const semanticJudge = createTypeSafeJudge()
const desktopDiagnosticsEnabled = process.env.AISLING_DESKTOP_DIAGNOSTICS === '1'
const desktopDiagnosticReplyText = process.env.AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT === '1'
const desktopDiagnosticFile = path.join(__dirname, '..', '..', '.local', 'desktop-awareness-diagnostics.jsonl')
const desktopDiagnosticSession = desktopDiagnosticsEnabled ? randomUUID() : undefined
/** @type {import('node:fs').WriteStream | undefined} */
let desktopDiagnosticStream
let desktopDiagnosticFailed = false

function desktopDiagnosticArguments() {
  return desktopDiagnosticsEnabled ? ['--aisling-desktop-diagnostics',
    ...(desktopDiagnosticReplyText ? ['--aisling-desktop-diagnostics-reply-text'] : [])] : []
}

/** Local JSONL only. A broken diagnostic sink must not affect capture or models. */
function writeDesktopDiagnostic(record) {
  if (!desktopDiagnosticsEnabled || desktopDiagnosticFailed || !record || typeof record.type !== 'string') return
  if (['chat-first-text', 'chat-tool-round', 'chat-provider-result'].includes(record.type)) return
  try {
    // Whitelist excludes prompts, desktop bodies, conversation and credentials.
    const keys = ['at', 'type', 'sampleId', 'judgmentId', 'judgmentSampleId', 'candidateId', 'objectId', 'candidateSource', 'targetFingerprint', 'change', 'intendedTarget', 'stimulusId', 'turnId',
      'snapshot', 'checkedSnapshot', 'changedFields', 'initial', 'semanticChange',
      'app', 'titleFingerprint', 'uiaLength', 'uiaFingerprint', 'mediaCount', 'mediaFingerprints', 'micActive',
      'idleSeconds', 'observation', 'mode', 'historyRequested', 'historyIncluded',
      'score', 'reason', 'outcome', 'enabled', 'preference', 'replyTarget', 'replyLength',
      'replyFingerprint', 'delivered', 'replyHistoryWritten']
    let safe = Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]))
    if (record.type.startsWith('p2-') || record.type === 'context-assembled') {
      if (!['p2-a-update-start', 'p2-a-update-end', 'p2-a-settled', 'p2-a-http', 'p2-b-context', 'p2-b-request-start', 'p2-b-request-end', 'p2-b-delivery', 'context-assembled'].includes(record.type)) return
      // P2/Context never accept raw scope strings, errors, prompts or content, even with reply-text opt-in.
      safe = { type: record.type }
      for (const key of ['updateId', 'scopeId', 'conversationId', 'turnId', 'activeAUpdateId']) {
        if (typeof record[key] === 'string' && /^[a-f0-9-]{36}$/i.test(record[key])) safe[key] = record[key]
      }
      if (typeof record.requestId === 'string' && /^[a-f0-9-]{36}:\d+$/i.test(record.requestId)) safe.requestId = record.requestId
      for (const key of ['startedAt', 'finishedAt', 'durationMs', 'previousRevision', 'revision', 'availableRevision',
        'batchCount', 'observationCount', 'contextChars', 'round', 'aCalls', 'aCallsAtStart', 'aCallsDuringTurn', 'httpStatus',
        'firstReceivedAt', 'lastReceivedAt', 'scheduledAt', 'queueDelayMs', 'snapshotToCommitMs', 'latestSnapshotToCommitMs',
        'contentChars', 'reasoningChars', 'contentDeltaCount', 'reasoningDeltaCount', 'streamEventCount',
        'historyTokens', 'requiredTokens', 'selectedMessages', 'omittedMessages', 'basisCount',
        'reflectionCount', 'reflectionChars', 'reflectionTokens', 'reflectionRetrievalMs']) {
        if (Number.isFinite(record[key]) && record[key] >= 0) safe[key] = record[key]
      }
      for (const key of ['committed', 'usable', 'executorReturned', 'settled', 'injected', 'delivered', 'statePresent', 'abortRequested',
        'doneReceived', 'unsupportedContent', 'recallIncluded']) {
        if (typeof record[key] === 'boolean') safe[key] = record[key]
      }
      if (typeof record.scopeMatched === 'boolean' || record.scopeMatched === 'unknown') safe.scopeMatched = record.scopeMatched
      if (['injected', 'context-budget', 'disabled', 'conversation-error', 'unsafe-query', 'storage-error', 'empty',
        'no-match', 'invalid-source', 'candidate-budget', 'context-error', 'unavailable'].includes(record.reflectionReason)) safe.reflectionReason = record.reflectionReason
      if (Array.isArray(record.reflectionSelection)) safe.reflectionSelection = record.reflectionSelection.slice(0, 6).flatMap(item => {
        if (!item || typeof item.label !== 'string' || !/^R[1-6]$/.test(item.label) || !['event', 'fact', 'pattern', 'preference', 'project-state', 'open-question'].includes(item.kind)
          || !['relevance', 'invalid-source', 'selected', 'candidate-budget', 'context-budget', 'combination-value'].includes(item.reason)
          || !Number.isFinite(item.score) || item.score < 0 || !Number.isSafeInteger(item.matched) || item.matched < 0
          || typeof item.eligible !== 'boolean') return []
        const row = { label: item.label, kind: item.kind, score: item.score, matched: item.matched, eligible: item.eligible, reason: item.reason }
        if (typeof item.topical === 'boolean') row.topical = item.topical
        for (const key of ['chars', 'bytes', 'order']) if (Number.isSafeInteger(item[key]) && item[key] >= 0) row[key] = item[key]
        return [row]
      })
      if (['stop', 'length', 'tool_calls', 'function_call', 'content_filter', 'other', 'unknown'].includes(record.finishReason)) safe.finishReason = record.finishReason
      if (['empty-content', 'whitespace-only', 'markdown-fence', 'non-json-prefix', 'json-syntax', 'non-syntax-error'].includes(record.jsonParseFailure)) safe.jsonParseFailure = record.jsonParseFailure
      if (['provider-enter', 'fetch-start', 'headers-received', 'response-json-start', 'response-json-end', 'response-json-failed',
        'first-text', 'stream-end', 'result-ready', 'aborted', 'failed', 'model-json-start', 'model-json-end', 'model-json-failed'].includes(record.event)) safe.event = record.event
      if (['provider', 'fetch', 'response-json', 'response-shape', 'stream', 'model-json'].includes(record.stage)) safe.stage = record.stage
      if (['fetch-error', 'http-error', 'response-json-error', 'response-shape-error', 'stream-error', 'provider-error', 'model-json-error'].includes(record.errorKind)) safe.errorKind = record.errorKind
      if (['user-text', 'autonomous', 'visual', 'system'].includes(record.source)) safe.source = record.source
      if (['updated', 'failed', 'timeout', 'cancelled', 'invalidated', 'validation-rejected', 'returned', 'delivered', 'empty', 'generation-failed', 'not-delivered'].includes(record.outcome)) safe.outcome = record.outcome
      if (['committed', 'deadline', 'invalid-output', 'input-limit', 'executor-error', 'incompatible-result', 'disabled', 'disposed', 'reset',
        'invalid-observation', 'scope-changed', 'stale-observation', 'provider-changed', 'session-invalidated', 'feature-disabled',
        'no-ready-state', 'scope-unknown', 'state-expired', 'evidence-pending', 'target-mismatch',
        'context-limit', 'context-error', 'context-unavailable', 'unsupported-source', 'injected', 'session-window', 'candidate-only'].includes(record.reason)) safe.reason = record.reason
    }
    if (desktopDiagnosticReplyText && record.type === 'delivery' && record.delivered === true && typeof record.replyText === 'string') {
      safe.replyText = record.replyText.slice(0, 2000)
      safe.replyTextTruncated = record.replyText.length > 2000 || record.replyTextTruncated === true
    }
    const line = JSON.stringify({ ...safe, at: Number.isFinite(record.at) ? record.at : Date.now(), sessionId: desktopDiagnosticSession })
    if (line.length > 16000) return
    if (!desktopDiagnosticStream) {
      fs.mkdirSync(path.dirname(desktopDiagnosticFile), { recursive: true })
      desktopDiagnosticStream = fs.createWriteStream(desktopDiagnosticFile, { flags: 'a' })
      desktopDiagnosticStream.on('error', () => {
        desktopDiagnosticFailed = true
        console.warn('[desktop-awareness] diagnostic file unavailable; diagnostic logging stopped.')
      })
      console.log(`[desktop-awareness] diagnostics: ${desktopDiagnosticFile}`)
      desktopDiagnosticStream.write(`${JSON.stringify({ at: Date.now(), type: 'diagnostics-started', sessionId: desktopDiagnosticSession,
        schema: 'desktop-candidate-v1', replyTextEnabled: desktopDiagnosticReplyText })}\n`)
    }
    desktopDiagnosticStream.write(`${line}\n`)
  }
  catch { desktopDiagnosticFailed = true }
}
/** @type {AbortController | undefined} */
let judgeAbort
/** @type {AbortController | undefined} */
let emotionAbort

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

function isReplyHistoryEnabled() {
  const awareness = readStoredConfig()?.desktopAwareness
  return Boolean(awareness && typeof awareness === 'object'
    && /** @type {Record<string, unknown>} */ (awareness).replyHistoryEnabled === true)
}

// Matches the renderer's paper/ink --bg so the window does not flash before the Stage paints.
const stageBackground = () => nativeTheme.shouldUseDarkColors ? '#0F0F1A' : '#F4ECD8'

/** @type {import('electron').BaseWindow | undefined} */
let mainWindow
let tray
/** @type {import('electron').BaseWindow | undefined} */
let desktopWindow
/** @type {import('electron').WebContentsView | undefined} */
let stageView
let mode = 'stage'
let switching = false
let quitting = false
let desktopSize = { width: 360, height: 460 }
let desktopDisplayId
let pointerTimer
let pointerBusy = false
let pointerKind = 'none'
let pointerIgnored
let dragTimer
let desktopAlwaysOnTop = true

function stopDesktopPointer() {
  stopDesktopDrag()
  clearInterval(pointerTimer)
  pointerTimer = undefined
  pointerBusy = false
  pointerKind = 'none'
  pointerIgnored = undefined
}

function stopDesktopDrag() {
  clearInterval(dragTimer)
  dragTimer = undefined
}

// Allow the character center just beyond either screen edge, leaving a small half visible.
function clampDesktopX(x, width, work) {
  return Math.round(Math.max(work.x - width * 0.55, Math.min(work.x + work.width - width * 0.45, x)))
}

function startDesktopDrag() {
  if (mode !== 'desktop' || !desktopWindow || desktopWindow.isDestroyed() || dragTimer) return
  const desktop = desktopWindow
  const start = screen.getCursorScreenPoint().x
  // On Windows at fractional DPI, getBounds() rounds the outer frame up.
  // setPosition() reuses that size and grows the window on every move.
  const from = desktop.getContentBounds()
  dragTimer = setInterval(() => {
    if (desktop.isDestroyed()) return stopDesktopDrag()
    const display = screen.getAllDisplays().find(item => item.id === desktopDisplayId)
      ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = desktop.getContentBounds()
    const work = display.workArea
    const x = clampDesktopX(from.x + screen.getCursorScreenPoint().x - start, from.width, work)
    const y = work.y + work.height - from.height
    if (x !== bounds.x || y !== bounds.y)
      desktop.setContentBounds({ x, y, width: from.width, height: from.height })
  }, 16)
}

function updateDesktopPointer(kind) {
  if (!desktopWindow || desktopWindow.isDestroyed() || !stageView) return
  const ignore = !dragTimer && kind === 'none'
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
  if (mode !== 'desktop' || !desktopWindow || !stageView) return
  const point = screen.getCursorScreenPoint()
  const bounds = desktopWindow.getContentBounds()
  const x = point.x - bounds.x
  const y = point.y - bounds.y
  stageView.webContents.send('aisling:cursor', x, y)
  if (pointerBusy) return
  if (dragTimer) {
    updateDesktopPointer('character')
    return
  }
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
    if (url.username || url.password) return null
    if (url.protocol === 'aisling:')
      return `aisling://${url.host}`
    return url.protocol === 'http:' ? url.origin : null
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
function resolveStageTarget(stageUrl = process.env.AISLING_STAGE_URL) {
  const url = stageUrl || (isBuiltRendererAvailable() || app.isPackaged ? buildStageUrl() : DEFAULT_STAGE_URL)
  const origin = stageOriginOf(url)
  if (origin === 'aisling://stage') return { mode: 'prod', url, origin }
  if (!app.isPackaged && DEV_STAGE_ORIGINS.has(origin)) return { mode: 'dev', url, origin }
  throw new Error('untrusted-stage-origin')
}

function configureDevProfile() {
  const explicit = process.env.AISLING_DEV_PROFILE
  const directory = explicit ?? path.resolve(__dirname, '../../.local/desktop-dev-profile')
  if (!path.isAbsolute(directory) || (explicit && !fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()))
    throw new Error('dev-profile-must-be-an-existing-absolute-directory')
  if (!explicit) fs.mkdirSync(directory, { recursive: true })
  const profile = fs.realpathSync(directory)
  if (path.relative(profile, directory) || fs.lstatSync(directory).isSymbolicLink())
    throw new Error('canonical-memory-profile-required')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
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

/** @param {boolean} diagnostics @param {(event: Electron.Event) => boolean} [deferQuit] */
function registerAppDiagnostics(diagnostics, deferQuit) {
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
  app.on('before-quit', event => {
    if (deferQuit?.(event)) return
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
  if (width <= 0 || height <= 0) return
  const bounds = stageView.getBounds()
  if (bounds.width === width && bounds.height === height) return
  stageView.setBounds({ x: 0, y: 0, width, height })
}

function desktopBounds() {
  const display = screen.getAllDisplays().find(item => item.id === desktopDisplayId)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const w = Math.min(desktopSize.width, width)
  const h = Math.min(desktopSize.height, height)
  return { x: x + width - w - Math.min(24, Math.max(0, width - w)), y: y + height - h, width: w, height: h }
}

function enterDesktopMode() {
  if (mode === 'desktop' || !mainWindow || !stageView) return
  desktopDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
  desktopWindow = new BaseWindow({
    ...desktopBounds(), show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', alwaysOnTop: desktopAlwaysOnTop, skipTaskbar: true,
    resizable: false, hasShadow: false, title: `Aisling Desktop v${app.getVersion()}`,
  })
  const desktop = desktopWindow
  desktop.setContentBounds(desktopBounds())
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
  // ponytail: one cursor probe every 33 ms; use native hit testing if this becomes measurable.
  pointerTimer = setInterval(() => void pollDesktopPointer(), 33)
  void pollDesktopPointer()
  switching = false
}

function showStage() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  stageView?.webContents.focus()
}

function returnToStage(background = false) {
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
  if (background) mainWindow.minimize()
  else showStage()
  desktopWindow?.destroy()
  desktopWindow = undefined
  desktopDisplayId = undefined
  switching = false
}

const desktopText = (en, zh) => readStoredLanguage() === 'zh-CN' ? zh : en
const trayMenu = () => Menu.buildFromTemplate([
  { label: desktopText('Always on top', '始终置顶'), type: 'checkbox', checked: desktopAlwaysOnTop, click: item => {
    desktopAlwaysOnTop = item.checked
    desktopWindow?.setAlwaysOnTop(item.checked)
  } },
  { label: desktopText('Show Aisling', '显示 Aisling'), type: 'checkbox', checked: mode === 'desktop', click: item => {
    if (item.checked) enterDesktopMode()
    else returnToStage(true)
  } },
  { label: desktopText('Electron stage', '打开舞台'), click: () => mode === 'desktop' ? returnToStage() : showStage() },
  { type: 'separator' },
  { label: desktopText('Quit', '退出'), click: () => app.quit() },
])

function openDesktopMenu() {
  if (mode !== 'desktop' || !desktopWindow || desktopWindow.isDestroyed()) return
  trayMenu().popup({ window: desktopWindow })
}

function refreshWindowMenu() {
  mainWindow?.setMenu(Menu.buildFromTemplate([
    { label: desktopText('File', '文件'), submenu: [
      { label: desktopText('Desktop Mode', '桌面模式'), icon: nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 }), click: enterDesktopMode },
      { type: 'separator' }, { label: desktopText('Quit', '退出'), role: 'quit' },
    ] },
    { label: desktopText('Edit', '编辑'), role: 'editMenu' },
    { label: desktopText('View', '视图'), role: 'viewMenu' },
    { label: desktopText('Window', '窗口'), role: 'windowMenu' },
  ]))
}

function stopDesktopAwareness() {
  judgeAbort?.abort()
  judgeAbort = undefined
  desktopObserver.stop()
}

/**
 * Creates the real Stage window. `show: false` exists only for smoke callers;
 * the executable main entry always passes `show: true`.
 * @param {{ show?: boolean, diagnostics?: boolean, stageUrl?: string, noteV2?: boolean, migration?: boolean }} [options]
 */
async function createWindow(options = {}) {
  const show = options.show ?? true
  const diagnostics = options.diagnostics ?? true
  const { url: stageUrl } = resolveStageTarget(options.stageUrl)
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
    title: `Aisling v${app.getVersion()}`,
    icon: ICON_PATH,
    backgroundColor: stageBackground(),
  })
  const window = mainWindow
  stageView = new WebContentsView({ webPreferences: {
    preload: preloadPath, contextIsolation: true, nodeIntegration: false,
    sandbox: true, backgroundThrottling: false,
    additionalArguments: [...desktopDiagnosticArguments(), ...(options.noteV2 ? ['--aisling-note-v2'] : []),
      ...(options.migration ? ['--aisling-memory-migration'] : [])],
  } })
  stageView.setBackgroundColor(stageBackground())
  window.contentView.addChildView(stageView)
  resizeView(window)
  window.on('resize', () => resizeView(window))
  window.on('restore', () => resizeView(window))
  refreshWindowMenu()
  const contents = stageView.webContents
  diagnostic(diagnostics, 'Stage window created')

  if (options.noteV2) {
    contents.on('did-start-navigation', details => {
      if (details.isMainFrame && !details.isSameDocument) revokeNoteDocument()
    })
    contents.on('render-process-gone', revokeNoteDocument)
    contents.once('destroyed', revokeNoteDocument)
  }
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
    stopDesktopDrag()
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

/** @type {ReturnType<typeof import('./memory-database/host.cjs').attachMemoryDatabase> | undefined} */
let memoryDatabase
let organization
let migration
/** @type {ReturnType<typeof import('./note-formation.cjs').createNoteFormationService> | undefined} */
let noteFormation
let noteDocument = 0
/** @type {{ id: string, attempt: number } | undefined} */
let noteAttempt

function revokeNoteDocument() {
  noteDocument++
  const attempt = noteAttempt
  noteAttempt = undefined
  if (attempt && noteFormation)
    void noteFormation.fail(attempt.id, attempt.attempt, 'cancelled').catch(error => console.error('[note-v2] could not cancel renderer attempt', error.code ?? error.name))
}

/** @param {{ show?: boolean, diagnostics?: boolean, stageUrl?: string,
 * onMemoryDatabase?: (store: import('./memory-database/store').MemoryDatabaseStore | undefined, ready: Promise<void> | undefined) => void,
 * memoryDatabaseDiagnostic?: (event: string, detail: any) => void,
 * noteOnlyForNewProfiles?: boolean,
 * noteV2?: { resources?: string, embeddingConfig?: () => any, embeddingRequest?: typeof import('./note-embedding.cjs').embed,
 * onService?: (service: ReturnType<typeof import('./note-formation.cjs').createNoteFormationService>) => void } }} [options] */
async function startDesktop(options = {}) {
  const diagnostics = options.diagnostics ?? true
  const target = resolveStageTarget(options.stageUrl)
  if (options.noteOnlyForNewProfiles && target.mode === 'dev') configureDevProfile()
  const { assertMemoryAuthority, canStartNoteV2, readMigration } = require('./memory-authority.cjs')
  if ((options.noteOnlyForNewProfiles || options.noteV2) && !app.requestSingleInstanceLock())
    throw new Error('Memory requires exclusive profile access')
  const p0Experiment = !!options.onMemoryDatabase && process.env.AISLING_MEMORY_DB_P0 === '1'
  const useNoteV2 = options.noteOnlyForNewProfiles
    ? !p0Experiment && canStartNoteV2(app.getPath('userData'))
    : Boolean(options.noteV2)
  if (useNoteV2 && p0Experiment)
    throw new Error('Note v2 and legacy database experiment are mutually exclusive')
  if (!useNoteV2) assertMemoryAuthority(app.getPath('userData'), false)
  if (p0Experiment && !memoryDatabase)
    memoryDatabase = require('./memory-database/host.cjs').attachMemoryDatabase(app, options.memoryDatabaseDiagnostic)
  options.onMemoryDatabase?.(memoryDatabase?.store, memoryDatabase?.ready)
  await app.whenReady()
  const profile = app.getPath('userData')
  const resources = app.isPackaged ? path.join(process.resourcesPath, 'memory-database') : require('./memory-database/client.cjs').localWorkerResources
  const migrationState = readMigration(profile)
  const frozen = () => migration?.frozen() === true
  if (useNoteV2) {
    const v2Resources = options.noteV2?.resources ?? resources
    const { createNoteFormationService } = require('./note-formation.cjs')
    const archive = migrationState && require('./memory-archive.cjs').legacyArchive({ profile, resources: v2Resources, readData: readDesktopData,
      writeData: writeDesktopData, readReflections: readRawReflections, writeReflections: writeRawReflections })
    noteFormation = createNoteFormationService({
      autonomous: true,
      profile, resources: v2Resources, archive,
      consent: () => {
        const memory = /** @type {any} */ (readStoredConfig()?.memory)
        return memory?.enabled === true && memory?.formationEnabled === true
      },
      reviewConsent: () => /** @type {any} */ (readStoredConfig()?.memory)?.enabled === true,
      recallConsent: () => {
        const memory = /** @type {any} */ (readStoredConfig()?.memory)
        return memory?.enabled === true && memory?.noteRecallEnabled === true
      },
      readData: readDesktopData, writeData: writeDesktopData,
      embeddingConfig: options.noteV2?.embeddingConfig ?? (() => require('./note-embedding.cjs').resolveEmbeddingConfig(readStoredConfig())),
      ...(options.noteV2?.embeddingRequest && { embeddingRequest: options.noteV2.embeddingRequest }),
      report: (event, error) => console.error('[note-v2]', event, error.code ?? error.name),
    })
    configureMemoryLifecycle(noteFormation.privacy)
    options.noteV2?.onService?.(noteFormation)
    void noteFormation.recover().catch(error => console.error('[note-v2] recovery pending', error.code ?? error.name))
  } else {
    assertMemoryAuthority(profile, false)
    const legacyResources = options.noteV2?.resources ?? (app.isPackaged ? resources : process.env.AISLING_MEMORY_DB_P0_RESOURCES || resources)
    organization ||= require('./memory-organization.cjs').createMemoryOrganization({
      profile, resources: legacyResources,
      readData:readDesktopData, readReflections:readRawReflections,writeData:writeDesktopData,writeReflections:writeRawReflections,
      report:state=>{if(stageView&&!stageView.webContents.isDestroyed())stageView.webContents.send('aisling:organization:status',state)},
      consent:()=>{const config=readStoredConfig();const memory=/** @type {any} */(config?.memory);return !frozen()&&memory?.enabled===true&&memory?.organizationEnabled===true},
      recallConsent:()=>{const memory=/** @type {any} */(readStoredConfig()?.memory);return !frozen()&&memory?.enabled===true&&memory?.noteRecallEnabled===true},
    })
    if (options.noteOnlyForNewProfiles && !p0Experiment) {
      migration = require('./memory-migration.cjs').createMemoryMigration({ profile, resources: legacyResources, readData: readDesktopData,
        readReflections: readRawReflections, legacy: organization, freeze: () => organization.freeze() })
    }
    if (migrationState && !migration) throw new Error('memory-migration-requires-standard-main')
    configureMemoryLifecycle(organization.privacy)
    if (!frozen()) void organization.recoverSources().catch(()=>{})
  }
  diagnostic(diagnostics, 'app ready')
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 }))
    tray.setToolTip('Aisling')
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()))
  }
  registerAppDiagnostics(diagnostics, event => {
    if(memoryDatabase?.deferQuit(event))return true
    if (noteFormation) {
      const service = noteFormation
      noteFormation = undefined
      event.preventDefault()
      void service.close().catch(() => {}).finally(() => app.quit())
      return true
    }
    if(organization){const service=organization;organization=undefined;event.preventDefault();void service.close().finally(()=>app.quit());return true}
    return false
  })
  screen.on('display-metrics-changed', () => {
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.setContentBounds(desktopBounds())
  })
  screen.on('display-removed', () => {
    if (desktopWindow && !desktopWindow.isDestroyed()) desktopWindow.setContentBounds(desktopBounds())
  })

  if (target.mode === 'prod')
    registerStageProtocol()

  if (!ipcRegistered) {
    ipcRegistered = true
    const allowedOrigin = target.origin
    const trusted = event => Boolean(stageView && event.sender === stageView.webContents
      && event.senderFrame
      && event.senderFrame === stageView.webContents.mainFrame
      && stageOriginOf(event.senderFrame.url) === allowedOrigin)
    registerStorageIpc(trusted, !noteFormation, frozen)
    if (noteFormation) {
      ipcMain.handle('aisling:note-recall:snapshot', event => {
        if (!trusted(event) || !noteFormation) throw new Error('Untrusted Note Recall request')
        return noteFormation.recallSnapshot()
      })
      ipcMain.handle('aisling:note-recall:current', (event, version) => {
        return trusted(event) && noteFormation?.recallCurrent(version) === true
      })
      ipcMain.handle('aisling:note-recall:neighbors', (event, ids, version, evolution = false, history = false) => {
        if (!trusted(event) || !noteFormation) throw new Error('Untrusted Note Recall request')
        return noteFormation.recallNeighbors(ids, version, evolution, history)
      })
      ipcMain.handle('aisling:note-recall:candidates', (event, query, version) => {
        if (!trusted(event) || !noteFormation) throw new Error('Untrusted Note Recall request')
        return noteFormation.recallCandidates(query, version)
      })
      ipcMain.handle('aisling:note-review:list', event => {
        if (!trusted(event) || !noteFormation) throw new Error('Untrusted Note review request')
        return noteFormation.reviews()
      })
      let confirming = false
      ipcMain.handle('aisling:note-review:decide', async (event, key, approved) => {
        if (!trusted(event) || !noteFormation || typeof key !== 'string' || typeof approved !== 'boolean')
          throw new Error('Untrusted Note review decision')
        const service = noteFormation
        if (!approved) return service.decide(key, false)
        if (confirming) return 'busy'
        confirming = true
        try {
          const item = (await service.reviews()).items.find(row => row.key === key)
          if (!item?.approvable) return service.approvalOutcome(key)
          const chinese = readStoredLanguage() === 'zh-CN'
          const action = {
            ADD: ['Add memory', '新增记忆'], UPDATE: ['Revise memory', '修订记忆'],
            NOOP: ['Add evidence', '补充证据'], SUPERSEDE: ['Replace memory', '取代记忆'],
            RETRACT: ['Retract memory', '撤回记忆'],
          }[item.action]?.[chinese ? 1 : 0]
          const confirmed = await dialog.showMessageBox({
            type: 'question', message: chinese ? '批准此记忆操作？' : 'Approve this memory operation?',
            detail: [action, item.content, item.target, item.uncertainty].filter(Boolean).join('\n\n'),
            buttons: chinese ? ['取消', '批准'] : ['Cancel', 'Approve'], defaultId: 0, cancelId: 0, noLink: true,
          })
          if (confirmed.response !== 1 || service !== noteFormation || !trusted(event)) return 'cancelled'
          return service.decide(key, true)
        } finally { confirming = false }
      })
      for (const method of ['delivered', 'flush', 'next', 'prepare', 'submit', 'fail']) {
        ipcMain.handle('aisling:note-formation:' + method, async (event, ...args) => {
          const service = noteFormation
          if (!trusted(event) || !service) throw new Error('Untrusted Note Formation request')
          if (method === 'next') {
            const document = noteDocument
            const job = await service.next()
            if (job && (document !== noteDocument || !trusted(event))) {
              await service.fail(job.id, job.attempt, 'cancelled')
              return null
            }
            if (job) noteAttempt = job
            return job
          }
          if (['prepare', 'submit', 'fail'].includes(method)
            && (!noteAttempt || noteAttempt.id !== args[0] || noteAttempt.attempt !== args[1]))
            throw new Error('stale-formation-attempt')
          return service[method](...args)
        })
      }
    }
    if (migration) {
      let confirming = false
      let preview, checking = false
      ipcMain.handle('aisling:memory-migration:status', event => {
        if (!trusted(event)) throw new Error('Untrusted migration request')
        return migration.status()
      })
      ipcMain.handle('aisling:memory-migration:preflight', async event => {
        if (!trusted(event) || confirming || checking) throw new Error('Untrusted migration request')
        preview = undefined
        checking = true
        try { return preview = await migration.preflight() }
        finally { checking = false }
      })
      ipcMain.handle('aisling:memory-migration:exclude', async (event, key, version) => {
        if (!trusted(event) || confirming || checking) throw new Error('Untrusted migration request')
        confirming = true
        try {
          const item = await migration.dispositionChoice(key, version)
          if (item.excluded) return 'excluded'
          const chinese = readStoredLanguage() === 'zh-CN'
          const confirmed = await dialog.showMessageBox({
            type: 'question', message: chinese ? '将这条记忆留在历史中？' : 'Keep this memory in history only?',
            detail: (chinese ? '这条记忆不会进入升级后的召回。来源删除仍会清理它。'
              : 'This memory stays out of upgraded recall and is still cleared when its source is deleted.') + '\n\n' + item.label,
            buttons: chinese ? ['取消', '仅保留历史'] : ['Cancel', 'Keep in history'], defaultId: 0, cancelId: 0, noLink: true,
          })
          if (confirmed.response !== 1 || !trusted(event)) return 'cancelled'
          const result = await migration.exclude(key, version)
          preview = undefined
          return result
        } finally { confirming = false }
      })
      ipcMain.handle('aisling:memory-migration:execute', async event => {
        if (!trusted(event) || confirming || checking) throw new Error('Untrusted migration request')
        const state = migration.status()
        if (!preview?.canMigrate && !(state.total !== undefined && state.phase !== 'committed')) return state
        confirming = true
        try {
          const chinese = readStoredLanguage() === 'zh-CN'
          const confirmed = await dialog.showMessageBox({
            type: 'question', message: chinese ? '升级此资料的记忆？' : 'Upgrade this profile’s memory?',
            detail: chinese ? '应用会暂时停止写入，核对后切换记忆格式并重启。历史记录继续受来源删除约束。'
              : 'The app pauses writes, verifies the upgrade, and restarts. Historical records remain subject to source deletion.',
            buttons: chinese ? ['取消', '升级'] : ['Cancel', 'Upgrade'], defaultId: 0, cancelId: 0, noLink: true,
          })
          if (confirmed.response !== 1 || !trusted(event)) return migration.status()
          try {
            const result = await migration.execute()
            if (target.mode === 'dev' && process.env.AISLING_DEV === '1')
              app.once('will-quit', () => app.exit(DEV_RESTART_EXIT))
            else
              app.relaunch()
            setTimeout(() => app.quit(), 100)
            return result
          } catch (error) {
            console.error('[memory-migration]', error.code ?? error.name)
            return migration.status()
          } finally { preview = undefined }
        } finally { confirming = false }
      })
    }
    if (organization) {
      ipcMain.handle('aisling:organization:enabled',(event,enabled)=>{
        if(!trusted(event)||typeof enabled!=='boolean')throw new Error('Untrusted organization request')
        if (frozen()) return { ready: false, autoWrite: false, reason: 'migration-frozen' }
        return organization?.setEnabled(enabled) ?? {ready:false,autoWrite:false,reason:'disabled'}
      })
      ipcMain.handle('aisling:organization:candidates',event=>{
        if(!trusted(event))throw new Error('Untrusted organization request')
        if (frozen()) throw new Error('memory-migration-frozen')
        return organization.candidates()
      })
      ipcMain.handle('aisling:memory:recall-heads', event => {
        if (!trusted(event)) throw new Error('Untrusted Note Recall request')
        if (frozen()) return { notes: [], reason: 'unavailable', excluded: 0 }
        return organization.recallHeads()
      })
      ipcMain.handle('aisling:organization:settle',(event,batchId,index)=>{
        if(!trusted(event)||typeof batchId!=='string'||!/^[\w-]{1,128}$/.test(batchId)||!Number.isInteger(index)||index<0||index>=3)throw new Error('Untrusted organization proposal')
        if (frozen()) throw new Error('memory-migration-frozen')
        return organization.settle(batchId,index)
      })
    }
    ipcMain.on('aisling:desktop-awareness:diagnostic', (event, record) => {
      if (desktopDiagnosticsEnabled && trusted(event)) writeDesktopDiagnostic(record)
    })
    ipcMain.on('aisling:language:set', (event, language) => {
      if (!trusted(event) || (language !== 'en' && language !== 'zh-CN')) return
      refreshWindowMenu()
    })
    ipcMain.on('aisling:desktop-size', (event, width, height) => {
      if (!trusted(event) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width < 1 || height < 1 || mode !== 'desktop' || !desktopWindow) return
      desktopSize = { width, height }
      const next = desktopBounds()
      const current = desktopWindow.getContentBounds()
      if (current.width === next.width && current.height === next.height) return
      const area = screen.getDisplayMatching(current).workArea
      next.x = clampDesktopX(current.x + (current.width - next.width) / 2, next.width, area)
      desktopWindow.setContentBounds(next)
    })
    ipcMain.on('aisling:desktop-drag', (event, enabled) => {
      if (!trusted(event) || typeof enabled !== 'boolean') return
      if (enabled) startDesktopDrag()
      else {
        stopDesktopDrag()
        void pollDesktopPointer()
      }
    })
    ipcMain.handle('aisling:mode:get', event => {
      if (!trusted(event)) throw new Error('Untrusted mode request')
      return mode
    })
    ipcMain.on('aisling:desktop-menu', event => {
      if (trusted(event)) openDesktopMenu()
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
      if (!current.enabled)
        return { ...current, available: false, context: undefined }
      try {
        const context = await desktopObserver.request()
        return { enabled: desktopObserver.status().enabled, available: true, context, error: '' }
      }
      catch (cause) {
        // No fresh response for this read: never substitute the cached latest.
        return { enabled: desktopObserver.status().enabled, available: false,
          error: cause instanceof Error ? cause.message : String(cause) }
      }
    })
    ipcMain.handle('aisling:desktop-awareness:judge', async (event, request) => {
      if (!trusted(event))
        throw new Error('Untrusted desktop awareness request')
      const snapshot = desktopObserver.status()
      if (!snapshot.enabled || !snapshot.context)
        throw new Error(snapshot.error || 'Desktop observer has no current context.')
      const candidate = candidateForSnapshot(request, snapshot.context)
      const recentReply = recentReplyForSnapshot(request, snapshot.context, isReplyHistoryEnabled())
      const apiKey = resolveJevApiKey()
      if (!apiKey)
        throw new Error('Desktop semantic judge unavailable: no Jev API Key configured.')
      judgeAbort?.abort()
      const abort = new AbortController()
      judgeAbort = abort
      try {
        if (desktopDiagnosticsEnabled) {
          const ids = request?.diagnostic
          const validIds = ids && [ids.sampleId, ids.judgmentId].every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id))
          writeDesktopDiagnostic({ type: 'jev-call', mode: 'actual-call',
            ...(validIds ? { sampleId: ids.sampleId, judgmentId: ids.judgmentId } : {}), candidateId: candidate.id, objectId: candidate.objectId,
            candidateSource: candidate.source, change: candidate.change,
            snapshot: { capturedAt: snapshot.context.capturedAt, targetHwnd: snapshot.context.targetHwnd, sequence: snapshot.context.sequence },
            historyIncluded: Boolean(recentReply) })
        }
        return { context: snapshot.context, scores: await semanticJudge.judge(snapshot.context, abort.signal, apiKey, candidate, recentReply),
          historyIncluded: Boolean(recentReply) }
      }
      finally {
        if (judgeAbort === abort)
          judgeAbort = undefined
      }
    })
    ipcMain.handle('aisling:emotion:judge', async (event, conversation) => {
      if (!trusted(event))
        throw new Error('Untrusted emotion request')
      const turns = normalizeConversation(conversation)
      if (!turns.length)
        throw new Error('No conversation to judge.')
      // No key is the default setup, not an error: the character simply stays neutral.
      const apiKey = resolveJevApiKey()
      if (!apiKey)
        return null
      // The desktop is only included while the user has Desktop Awareness on.
      const snapshot = desktopObserver.status()
      const desktop = snapshot.enabled ? snapshot.context : undefined
      emotionAbort?.abort()
      const abort = new AbortController()
      emotionAbort = abort
      try {
        return await semanticJudge.judgeEmotion({ conversation: turns, desktop }, abort.signal, apiKey)
      }
      catch (error) {
        // A newer reply superseded this request; its verdict is the one that matters.
        if (emotionAbort !== abort && abort.signal.aborted)
          return null
        throw error
      }
      finally {
        if (emotionAbort === abort)
          emotionAbort = undefined
      }
    })
  }
  return createWindow({ ...options, stageUrl: target.url, noteV2: !!noteFormation, migration: !!migration })
}

module.exports = { DEFAULT_STAGE_URL, createWindow, startDesktop, enterDesktopMode, returnToStage, writeDesktopDiagnostic, desktopDiagnosticArguments }
