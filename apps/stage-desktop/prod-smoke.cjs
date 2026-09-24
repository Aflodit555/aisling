// Production loading smoke: no dev server. Loads the built renderer through the
// `aisling://stage` custom scheme and verifies the renderer mounts, the desktop
// bridge is present, and the file-backed storage bridge round-trips.
const { app, BaseWindow, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop, enterDesktopMode, returnToStage } = require('./desktop-app.cjs')

// The smoke runs hidden and may execute without a compositor/GPU; keep it
// deterministic on headless/CI Windows hosts too.
app.disableHardwareAcceleration()

delete process.env.AISLING_STAGE_URL
app.setPath('userData', path.join(os.tmpdir(), `aisling-desktop-prod-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Desktop prod smoke timed out'); app.exit(1) }, 30000)

;(async () => {
  const visible = process.env.AISLING_FOCUS_SMOKE === '1'
  const win = await startDesktop({ show: visible, diagnostics: false })
  const contents = win.contentView.children[0].webContents
  if (visible) assert.equal(contents.isFocused(), true, 'Stage renderer must own focus after startup')
  const preferences = contents.getLastWebPreferences()
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)
  assert.equal(nativeImage.createFromPath(path.join(__dirname, 'assets', 'desktop-mode.png')).isEmpty(), false)

  const result = await contents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const stage = document.querySelector('.stage')
      const bridge = window.aislingDesktop
      if (stage && bridge && typeof bridge.readDesktopContext === 'function' && bridge.storage) {
        bridge.storage.setItem('aisling.prod-smoke', 'hello')
        const stored = bridge.storage.getItem('aisling.prod-smoke')
        return {
          stageMounted: true,
          bridge: typeof bridge.readDesktopContext,
          storageGet: stored,
          nodeAccess: typeof window.require,
          origin: window.location.origin,
          appChildCount: document.getElementById('app')?.childElementCount ?? 0,
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return { stageMounted: false, bridge: typeof window.aislingDesktop?.readDesktopContext, origin: window.location.origin }
  })()`)

  assert.equal(result.stageMounted, true)
  assert.equal(result.bridge, 'function')
  assert.equal(result.storageGet, 'hello')
  assert.equal(result.nodeAccess, 'undefined')
  assert.equal(result.origin, 'aisling://stage')
  assert.ok(result.appChildCount > 0)

  const screenshot = path.join(app.getPath('userData'), 'stage-prod-smoke.png')
  const desktopScreenshot = path.join(app.getPath('userData'), 'desktop-prod-smoke.png')
  const entryScreenshot = path.join(app.getPath('userData'), 'desktop-entry-smoke.png')
  const contextId = await contents.executeJavaScript('window.__smokeContext = crypto.randomUUID()')
  for (let i = 0; i < 2; i++) {
    enterDesktopMode()
    const floatingWindow = BaseWindow.getAllWindows().find(window => window !== win)
    assert.equal(floatingWindow?.isAlwaysOnTop(), true)
    assert.equal(await contents.executeJavaScript('window.aislingDesktop.getMode()'), 'desktop')
    assert.equal(await contents.executeJavaScript('document.querySelectorAll(".desktop-surface").length'), 1)
    assert.equal(await contents.executeJavaScript('window.__smokeContext'), contextId)
    assert.equal(await contents.executeJavaScript(`(async () => {
      for (let n = 0; n < 100; n++) {
        if (document.querySelector('.desktop-surface .character.entered .live2d-canvas')) return true
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return false
    })()`), true, 'Live2D must appear and replay the entrance after every switch')
    assert.equal(await contents.executeJavaScript(`(() => {
      const presence = document.querySelector('.desktop-surface .presence')
      const canvas = document.querySelector('.desktop-surface .live2d-canvas')
      return canvas.getBoundingClientRect().height > presence.getBoundingClientRect().height
    })()`), true, 'the complete model canvas must extend behind the desktop bottom edge')
    if (i === 0) {
      await new Promise(resolve => setTimeout(resolve, 300))
      writeFileSync(entryScreenshot, (await contents.capturePage()).toPNG())
      await new Promise(resolve => setTimeout(resolve, 600))
      assert.equal(await contents.executeJavaScript('!document.querySelector(".desktop-surface .bubble, .desktop-surface .desktop-composer")'), true)
      contents.send('aisling:desktop-pointer', 'character')
      await new Promise(resolve => setTimeout(resolve, 350))
      const desktopUi = await contents.executeJavaScript(`(async () => {
        const root = document.querySelector('.desktop-surface')
        const composer = root.querySelector('.desktop-composer')
        const composerRatio = composer?.getBoundingClientRect().width / root.getBoundingClientRect().width
        if (composer) {
          const input = composer.querySelector('input')
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(input, 'desktop smoke')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          composer.requestSubmit()
        }
        for (let n = 0; n < 40 && !root.querySelector('.bubble'); n++)
          await new Promise(resolve => setTimeout(resolve, 50))
        const reply = root.querySelector('.bubble')?.textContent
        return { entered: !!root.querySelector('.character.entered'), composerShown: !!composer, composerRatio, reply }
      })()`)
      assert.equal(desktopUi.entered, true)
      assert.equal(desktopUi.composerShown, true)
      assert.ok(Math.abs(desktopUi.composerRatio - 0.675) < 0.01)
      assert.match(desktopUi.reply, /desktop smoke/)
      contents.send('aisling:desktop-pointer', 'none')
      await new Promise(resolve => setTimeout(resolve, 350))
      assert.equal(await contents.executeJavaScript('!document.querySelector(".desktop-composer")'), true)
      assert.equal(await contents.executeJavaScript(`(async () => {
        document.querySelector('.character-hit').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        await new Promise(resolve => setTimeout(resolve, 0))
        return !!document.querySelector('.return-button')
      })()`), true)
      const layout = await contents.executeJavaScript(`(() => {
        const root = document.querySelector('.desktop-surface').getBoundingClientRect()
        const button = document.querySelector('.return-button').getBoundingClientRect()
        return { top: button.top - root.top, right: root.right - button.right }
      })()`)
      assert.ok(layout.top >= 100 && layout.right >= 20)
      await new Promise(resolve => setTimeout(resolve, 100))
      const desktopImage = await contents.capturePage()
      assert.equal(desktopImage.toBitmap()[3], 0, 'desktop corner must be transparent')
      writeFileSync(desktopScreenshot, desktopImage.toPNG())
      await contents.executeJavaScript('document.querySelector(".return-button").click()')
    }
    else returnToStage()
    assert.equal(await contents.executeJavaScript('window.aislingDesktop.getMode()'), 'stage')
    assert.equal(win.contentView.children[0].webContents, contents)
  }
  // Session title, user message and one assistant reply all contain the prompt.
  assert.equal(await contents.executeJavaScript('(document.body.innerText.match(/desktop smoke/g) || []).length'), 3)
  enterDesktopMode()
  BaseWindow.getAllWindows().find(window => window !== win).close()
  assert.equal(await contents.executeJavaScript('window.aislingDesktop.getMode()'), 'stage')
  writeFileSync(screenshot, (await contents.capturePage()).toPNG())
  console.log(JSON.stringify({ ok: true, ...result }))
  console.log(`Screenshot: ${screenshot}`)
  console.log(`Desktop screenshot: ${desktopScreenshot}`)
  console.log(`Entry screenshot: ${entryScreenshot}`)
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
})().catch((error) => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
