// Production loading smoke: no dev server. Loads the built renderer through the
// `aisling://stage` custom scheme and verifies the renderer mounts, the desktop
// bridge is present, and the file-backed storage bridge round-trips.
const { app, BaseWindow, Menu, nativeImage, screen } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop, enterDesktopMode, returnToStage } = require('./desktop-app.cjs')

// The smoke runs hidden and may execute without a compositor/GPU; keep it
// deterministic on headless/CI Windows hosts too.
app.disableHardwareAcceleration()

delete process.env.AISLING_STAGE_URL
// Replies would otherwise send the smoke conversation to the real Jev emotion judge.
delete process.env.TYPESAFE_API_KEY
app.setPath('userData', path.join(os.tmpdir(), `aisling-desktop-prod-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Desktop prod smoke timed out'); app.exit(1) }, 45000)

;(async () => {
  const visible = process.env.AISLING_FOCUS_SMOKE === '1'
  const win = await startDesktop({ show: visible, diagnostics: false })
  const contents = win.contentView.children[0].webContents
  const desktopMenus = []
  Menu.prototype.popup = function (options) { desktopMenus.push({ menu: this, options }) }
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

  if (process.env.AISLING_MINIMIZE_SMOKE === '1') {
    const view = win.contentView.children[0]
    const before = view.getBounds()
    win.minimize()
    win.emit('resize') // Reproduce a delayed Windows resize while content size is 0×0.
    assert.deepEqual(view.getBounds(), before, 'minimizing must not erase the Stage view bounds')
    win.restore()
    await new Promise(resolve => setTimeout(resolve, 200))
    const [width, height] = win.getContentSize()
    assert.deepEqual(view.getBounds(), { x: 0, y: 0, width, height })
    assert.equal(await contents.executeJavaScript('!!document.querySelector(".stage")'), true)
    console.log(JSON.stringify({ minimizeSmoke: 'passed' }))
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }

  // Route transitions need a visible renderer; the smoke starts with a hidden Stage window.
  enterDesktopMode()
  returnToStage()
  const nativeFetch = globalThis.fetch
  let searchUrl = ''
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://lite.duckduckgo.com/lite/?')) {
      searchUrl = String(url)
      const html = Array.from({ length: 6 }, (_, index) =>
        `<a class="result-link">Title ${index + 1}</a><div class="result-snippet">Snippet   ${index + 1}</div>`).join('')
      return new Response(html, { headers: { 'Content-Type': 'text/html' } })
    }
    return nativeFetch(url, options)
  }
  try {
    const searchUi = await contents.executeJavaScript(`(async () => {
      const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
      await router.push('/settings/web-search')
      for (let n = 0; n < 50 && !document.querySelector('.web-search form'); n++)
        await new Promise(resolve => setTimeout(resolve, 50))
      const form = document.querySelector('.web-search form')
      if (!form) throw new Error('Web Search settings did not render at ' + location.pathname)
      const provider = form.querySelector('select').value
      const hasKeyField = !!form.querySelector('input[type=password]')
      form.querySelector('button[type=button]').click()
      for (let n = 0; n < 50 && !form.querySelector('.results'); n++)
        await new Promise(resolve => setTimeout(resolve, 50))
      const titles = [...form.querySelectorAll('.results strong')].map(node => node.textContent)
      const firstSnippet = form.querySelector('.results .snippet')?.textContent
      const select = form.querySelector('select')
      select.value = 'none'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      form.requestSubmit()
      await new Promise(resolve => setTimeout(resolve, 0))
      const disabled = form.querySelector('button[type=button]').disabled
      const savedSearch = JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1')).webSearch
      await router.push('/')
      return { provider, hasKeyField, titles, firstSnippet, disabled, savedSearch }
    })()`)
    assert.equal(searchUi.provider, 'duckduckgo')
    assert.equal(searchUi.hasKeyField, false)
    assert.deepEqual(searchUi.titles, ['Title 1', 'Title 2', 'Title 3', 'Title 4', 'Title 5'])
    assert.equal(searchUi.firstSnippet, 'Snippet 1')
    assert.equal(searchUi.disabled, true)
    assert.deepEqual(searchUi.savedSearch, { providerType: 'none' })
    assert.equal(new URL(searchUrl).searchParams.get('q'), 'OpenAI')
  }
  finally {
    globalThis.fetch = nativeFetch
  }

  const screenshot = path.join(app.getPath('userData'), 'stage-prod-smoke.png')
  const desktopScreenshot = path.join(app.getPath('userData'), 'desktop-prod-smoke.png')
  const entryScreenshot = path.join(app.getPath('userData'), 'desktop-entry-smoke.png')
  if (process.env.AISLING_LAYOUT_SMOKE === '1') {
    assert.equal(await contents.executeJavaScript(`(async () => {
      for (let n = 0; n < 100; n++) {
        if (document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('presentation')?.stageLayout) return true
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return false
    })()`), true, 'Stage geometry must be ready before desktop inheritance')
  }
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
    if (process.env.AISLING_LAYOUT_SMOKE === '1') {
      const originalCursor = screen.getCursorScreenPoint
      const work = screen.getDisplayMatching(floatingWindow.getContentBounds()).workArea
      let cursor = { x: work.x + work.width / 2, y: work.y + work.height / 2 }
      screen.getCursorScreenPoint = () => cursor
      try {
        for (const direction of [-1, 1]) {
          cursor = { ...cursor, x: work.x + work.width / 2 }
          await contents.executeJavaScript('window.aislingDesktop.setDragging(true)')
          await new Promise(resolve => setTimeout(resolve, 60))
          cursor = { ...cursor, x: cursor.x + direction * work.width * 4 }
          await new Promise(resolve => setTimeout(resolve, 120))
          await contents.executeJavaScript('window.aislingDesktop.setDragging(false)')
          const bounds = floatingWindow.getContentBounds()
          const expected = direction < 0 ? work.x - bounds.width * 0.55 : work.x + work.width - bounds.width * 0.45
          assert.ok(Math.abs(bounds.x - Math.round(expected)) <= 1, 'both edges must allow a partial character')
          cursor = { x: direction < 0 ? work.x + 12 : work.x + work.width - 12, y: work.y + work.height / 2 }
          const ui = await contents.executeJavaScript(`(async () => {
            document.querySelector('.character-hit').click()
            await new Promise(resolve => setTimeout(resolve, 0))
            const composer = document.querySelector('.desktop-composer').getBoundingClientRect()
            document.querySelector('.character-hit').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
            return { composer: { left: composer.left + screenX, right: composer.right + screenX, width: composer.width }, backRemoved: !document.querySelector('.return-button') }
          })()`)
          assert.ok(ui.composer.width <= 320 && ui.composer.width > 150)
          assert.ok(ui.composer.left >= work.x && ui.composer.right <= work.x + work.width, JSON.stringify({work,bounds,ui}))
          assert.equal(ui.backRemoved, true)
          await new Promise(resolve => setTimeout(resolve, 30))
          assert.equal(desktopMenus.length, direction < 0 ? 1 : 2)
          const menu = desktopMenus.at(-1)
          assert.ok(menu)
          assert.deepEqual(menu.options, { window: floatingWindow })
        }
      } finally { screen.getCursorScreenPoint = originalCursor }
      console.log(JSON.stringify({ desktopLayout: 'passed', partialDrag: 'both edges', composer: '320px maximum' }))
      clearTimeout(timeout)
      win.destroy()
      app.exit(0)
      return
    }
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
        const composerWidth = composer?.getBoundingClientRect().width
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
        return { entered: !!root.querySelector('.character.entered'), composerShown: !!composer, composerWidth, reply }
      })()`)
      assert.equal(desktopUi.entered, true)
      assert.equal(desktopUi.composerShown, true)
      assert.equal(desktopUi.composerWidth, 320)
      assert.match(desktopUi.reply, /desktop smoke/)
      contents.send('aisling:desktop-pointer', 'none')
      await new Promise(resolve => setTimeout(resolve, 350))
      assert.equal(await contents.executeJavaScript('!document.querySelector(".desktop-composer")'), true)
      assert.equal(await contents.executeJavaScript(`(() => {
        document.querySelector('.character-hit').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        return !document.querySelector('.return-button')
      })()`), true)
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(desktopMenus.length, 1)
      const menu = desktopMenus[0].menu
      assert.deepEqual(menu.items.map(item => item.type), ['checkbox', 'checkbox', 'normal', 'separator', 'normal'])
      assert.equal(menu.items[1].checked, true)
      await contents.executeJavaScript(`document.querySelector('.desktop-surface').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(desktopMenus.length, 2, 'the character edge also opens the menu')
      await new Promise(resolve => setTimeout(resolve, 100))
      const desktopImage = await contents.capturePage()
      assert.equal(desktopImage.toBitmap()[3], 0, 'desktop corner must be transparent')
      writeFileSync(desktopScreenshot, desktopImage.toPNG())
      menu.items[2].click()
    }
    else returnToStage()
    assert.equal(await contents.executeJavaScript('window.aislingDesktop.getMode()'), 'stage')
    assert.equal(win.contentView.children[0].webContents, contents)
  }
  // Session title, user message and one assistant reply all contain the prompt.
  assert.equal(await contents.executeJavaScript('(document.body.innerText.match(/desktop smoke/g) || []).length'), 3)
  enterDesktopMode()
  returnToStage(true)
  assert.equal(win.isMinimized(), true, 'hiding Aisling must leave Stage minimized in the background')
  assert.equal(await contents.executeJavaScript('window.aislingDesktop.getMode()'), 'stage')
  win.restore()
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
