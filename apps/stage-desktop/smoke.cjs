// Run with Electron, after `pnpm dev`. Isolated storage, hidden window, no real provider calls.
// Pin the dev server so this smoke always exercises the Vite renderer path even
// when a built renderer exists (which would otherwise select `aisling://stage`).
process.env.AISLING_STAGE_URL = 'http://localhost:5174'

const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop } = require('./desktop-app.cjs')

app.setPath('userData', path.join(os.tmpdir(), `aisling-desktop-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1) }, 30000)

;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false })
  const preferences = win.webContents.getLastWebPreferences()
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)

  const result = await win.webContents.executeJavaScript(`(async () => {
    const { useStageStore } = await import('/src/stores/stage.ts')
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    const stage = useStageStore()
    const settings = useSettingsStore()
    await settings.load()
    const desktop = await window.aislingDesktop.readActivity()
    const calls = []
    settings.activeChatProvider = { id: 'smoke', complete: async (request) => {
      calls.push(request)
      return { text: 'A moment with your foreground app. (smoke)' }
    } }
    const spoken = []
    settings.activeSpeechProvider = { id: 'smoke-speech', synthesize: async ({ text }) => {
      spoken.push(text)
      return { spoken: true }
    } }
    const controls = document.querySelector('.autonomous-controls')
    controls.querySelector('summary').click()
    const toggle = controls.querySelector('input[type=checkbox]')
    const label = controls.querySelector('.proactive-control')
    const bridgeStatus = controls.querySelector('.bridge-status').textContent.replace(/\\s+/g, ' ').trim()
    const toggleInitiallyDisabled = toggle.disabled
    label.click()
    await Promise.resolve()
    const enabledAfterLabelClick = stage.autonomous.enabled
    toggle.click()
    await Promise.resolve()
    const disabledAfterInputClick = !stage.autonomous.enabled
    toggle.click()
    await Promise.resolve()
    const enabledForTrigger = stage.autonomous.enabled
    const threshold = controls.querySelector('input[type=number]')
    threshold.value = '10'
    threshold.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    const thresholdAfterUiChange = stage.autonomous.thresholdSeconds
    // Only shorten time for this smoke; the native snapshot and IPC remain real.
    stage.autonomous.thresholdSeconds = 0
    await stage.tickAutonomous()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    const firstRoles = stage.messages.map(message => message.role)
    const firstKind = stage.lastTurn?.stimulus.kind
    const runtimeAppPresent = Boolean(stage.autonomous.latestActivity.app)
    const runtimeTitleLength = stage.autonomous.latestActivity.title?.length ?? 0
    await stage.tickAutonomous()
    const cooldownCallCount = calls.length
    stage.send('User input still works')
    for (let i = 0; i < 20; i++) await Promise.resolve()
    stage.setAutonomousEnabled(false)
    await stage.tickAutonomous()
    return {
      bridge: typeof window.aislingDesktop.readActivity,
      bridgeStatus,
      toggleInitiallyDisabled,
      enabledAfterLabelClick,
      disabledAfterInputClick,
      enabledForTrigger,
      thresholdAfterUiChange,
      nodeAccess: typeof window.require,
      nativeAvailable: desktop.available,
      nativeAppPresent: Boolean(desktop.activity.app),
      nativeTitleLength: desktop.activity.title?.length ?? 0,
      runtimeAppPresent,
      runtimeTitleLength,
      idleFinite: Number.isFinite(desktop.idleSeconds),
      firstRoles, firstKind, cooldownCallCount,
      roles: stage.messages.map(message => message.role),
      callCount: calls.length, spokenCount: spoken.length,
      hasAutonomousSystem: calls[0]?.messages.some(message => message.role === 'system' && message.content.includes('Autonomous observation')),
      silence: stage.autonomous.silenceSeconds,
    }
  })()`)
  assert.equal(result.bridge, 'function')
  assert.equal(result.bridgeStatus, 'Desktop bridge: connected')
  assert.equal(result.toggleInitiallyDisabled, false)
  assert.equal(result.enabledAfterLabelClick, true)
  assert.equal(result.disabledAfterInputClick, true)
  assert.equal(result.enabledForTrigger, true)
  assert.equal(result.thresholdAfterUiChange, 10)
  assert.equal(result.nodeAccess, 'undefined')
  assert.equal(result.nativeAvailable, true, 'Run on an unlocked interactive Windows desktop')
  assert.equal(result.nativeAppPresent, true)
  assert.equal(result.runtimeAppPresent, true)
  assert.equal(result.runtimeTitleLength > 0, true)
  assert.equal(result.idleFinite, true)
  assert.deepEqual(result.firstRoles, ['assistant'])
  assert.equal(result.firstKind, 'autonomous')
  assert.equal(result.cooldownCallCount, 1)
  assert.deepEqual(result.roles, ['assistant', 'user', 'assistant'])
  assert.equal(result.callCount, 2)
  assert.equal(result.spokenCount, 2)
  assert.equal(result.hasAutonomousSystem, true)
  assert.equal(result.silence, 0)

  await new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve)
    win.webContents.reload()
  })
  const refreshed = await win.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const toggle = document.querySelector('.autonomous-controls input[type=checkbox]')
      if (toggle) {
        document.querySelector('.autonomous-controls summary').click()
        const status = document.querySelector('.autonomous-controls .bridge-status').textContent.replace(/\\s+/g, ' ').trim()
        const disabled = toggle.disabled
        document.querySelector('.autonomous-controls .proactive-control').click()
        await Promise.resolve()
        const { useStageStore } = await import('/src/stores/stage.ts')
        const enabled = useStageStore().autonomous.enabled
        toggle.click()
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          status,
          disabled,
          enabled,
          disabledAgain: !useStageStore().autonomous.enabled,
          checkedAfterOff: toggle.checked,
          summaryAfterOff: document.querySelector('.autonomous-controls summary').textContent.replace(/\\s+/g, ' ').trim(),
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Autonomous controls did not render after refresh')
  })()`)
  assert.equal(refreshed.status, 'Desktop bridge: connected')
  assert.equal(refreshed.disabled, false)
  assert.equal(refreshed.enabled, true)
  assert.equal(refreshed.disabledAgain, true)
  assert.equal(refreshed.checkedAfterOff, false)
  assert.equal(refreshed.summaryAfterOff, 'Autonomous Speak · Off')

  const browserWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  await browserWindow.loadURL('http://localhost:5174')
  const browserOnly = await browserWindow.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const controls = document.querySelector('.autonomous-controls')
      if (controls) {
        controls.querySelector('summary').click()
        const toggle = controls.querySelector('input[type=checkbox]')
        const status = controls.querySelector('.bridge-status').textContent.replace(/\\s+/g, ' ').trim()
        const hint = controls.querySelector('.unavailable-hint').textContent.replace(/\\s+/g, ' ').trim()
        const cursor = getComputedStyle(controls.querySelector('.proactive-control')).cursor
        controls.querySelector('.proactive-control').click()
        const { useStageStore } = await import('/src/stores/stage.ts')
        return { status, hint, cursor, disabled: toggle.disabled, enabled: useStageStore().autonomous.enabled }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Browser-only autonomous controls did not render')
  })()`)
  assert.equal(browserOnly.status, 'Desktop bridge: unavailable')
  assert.equal(browserOnly.disabled, true)
  assert.equal(browserOnly.enabled, false)
  assert.equal(browserOnly.cursor, 'not-allowed')
  assert.equal(browserOnly.hint, 'Desktop activity unavailable — open Aisling Desktop to enable autonomous speaking.')
  browserWindow.destroy()

  await new Promise(resolve => setTimeout(resolve, 50))
  const screenshot = path.join(app.getPath('userData'), 'stage-smoke.png')
  writeFileSync(screenshot, (await win.capturePage()).toPNG())
  console.log(JSON.stringify({ ok: true, ...result, refreshed, browserOnly }))
  console.log(`Screenshot: ${screenshot}`)
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
})().catch((error) => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
