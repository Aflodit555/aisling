// Production loading smoke: no dev server. Loads the built renderer through the
// `aisling://stage` custom scheme and verifies the renderer mounts, the desktop
// bridge is present, and the file-backed storage bridge round-trips.
const { app, BaseWindow, Menu, nativeImage, screen } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const candidateJudgeRequests = []
if (process.env.AISLING_DESKTOP_CANDIDATE_SMOKE === '1') {
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    const emotion = 'emotion' in request.questions
    if (!emotion) candidateJudgeRequests.push(request)
    return new Response(JSON.stringify({ answers: emotion
      ? { emotion: { type: 'choice', choice: 'joy', confidence: 0.9 }, intensity: { type: 'score', score: 1 } }
      : { should_interrupt: { type: 'noul', noul: 0.9 } } }))
  }
}
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

  if (process.env.AISLING_SPEECH_SMOKE === '1') {
    // Local tone only: exercise the production relay, audio decoder and real mouth source without paid calls.
    const samples = 22050, audio = Buffer.alloc(44 + samples * 2)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(22050, 24); audio.writeUInt32LE(44100, 28)
    audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40)
    for (let n = 0; n < samples; n++) audio.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / 22050) * 8000), 44 + n * 2)
    const nativeFetch = globalThis.fetch
    let upstreamCalls = 0
    globalThis.fetch = async url => {
      upstreamCalls++
      if (String(url) === 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
        return Response.json({ output: { audio: { url: 'https://audio.aliyuncs.com/offline-smoke.wav' } } })
      if (String(url) === 'https://audio.aliyuncs.com/offline-smoke.wav') return new Response(audio)
      throw new Error('Unexpected network request in offline speech smoke')
    }
    contents.setAudioMuted(true)
    try {
      const report = await contents.executeJavaScript(`(async () => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const settings = pinia._s.get('settings'), speech = pinia._s.get('speech')
        function mouthSource(vnode) {
          if (!vnode || typeof vnode !== 'object') return
          const source = vnode.component?.props?.sources?.find(source => source.id === 'speech-mouth')
          if (source) return source
          const nested = mouthSource(vnode.component?.subTree)
          if (nested) return nested
          for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
            const found = mouthSource(child)
            if (found) return found
          }
        }
        let mouth
        for (let n = 0; n < 200 && !mouth; n++) {
          mouth = mouthSource(document.querySelector('#app')._vnode)
          if (!mouth) await new Promise(resolve => setTimeout(resolve, 25))
        }
        if (!mouth) throw new Error('Live2D mouth source did not become ready')
        await settings.saveSpeech({ ...settings.config.speech, providerType: 'alibaba', apiKey: 'MOCK_ONLY', model: 'mock', voice: 'mock',
          transport: 'http', endpoint: 'https://dashscope.aliyuncs.com/api/v1' })
        await settings.setModuleEnabled('speech', true)
        let done = false, playing = false, peak = 0, mouthOpen = 0
        const spoken = speech.speak('Offline speech smoke').finally(() => { done = true })
        for (let n = 0; n < 400 && !done; n++) {
          playing ||= speech.speaking
          peak = Math.max(peak, speech.readLevel() ?? 0)
          const frame = mouth.sample({ readBase: () => 0, dtMs: 16 })
          if (frame) for (const value of frame.values()) mouthOpen = Math.max(mouthOpen, value)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        if (!done) { speech.stop(); throw new Error('Speech did not finish') }
        await spoken
        await settings.setModuleEnabled('speech', false)
        return { playing, peak, mouthOpen, phase: speech.phase }
      })()`, true)
      assert.equal(upstreamCalls, 2)
      assert.equal(report.playing, true)
      assert.ok(report.peak > 0.01, 'real decoded audio must reach the analyser')
      assert.ok(report.mouthOpen > 0.01, 'the existing speech mouth source must produce an open mouth')
      assert.equal(report.phase, 'idle')
      console.log(JSON.stringify({ productionSpeechSmoke: 'passed', upstream: 'mocked', ...report }))
    }
    finally { globalThis.fetch = nativeFetch }
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }

  if (process.env.AISLING_DESKTOP_CANDIDATE_SMOKE === '1') {
    const report = await contents.executeJavaScript(`(async () => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const stage = pinia._s.get('stage'), settings = pinia._s.get('settings')
      await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'smoke', replyHistoryEnabled: true })
      settings.activeChatProvider = { id: 'smoke', complete: async () => ({ text: 'One candidate comment. (smoke)' }) }
      await stage.setDesktopAwarenessEnabled(true)
      for (let n = 0; n < 120; n++) {
        if (stage.autonomous.decisions.some(d => d.reason === 'output-delivered') && stage.autonomous.decisions.some(d => d.reason === 'duplicate')) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const delivered = stage.autonomous.decisions.filter(d => d.reason === 'output-delivered')
      const duplicate = stage.autonomous.decisions.find(d => d.reason === 'duplicate' && d.candidateId === delivered[0]?.candidateId)
      const result = { deliveryCount: delivered.length, candidateId: delivered[0]?.candidateId, duplicateId: duplicate?.candidateId,
        gate: duplicate?.reason, historyRecorded: !!stage.autonomous.observations.find(o => o.candidateId === delivered[0]?.candidateId)?.recentReply }
      await stage.setDesktopAwarenessEnabled(false)
      return result
    })()`)
    assert.equal(report.deliveryCount, 1)
    assert.equal(report.duplicateId, report.candidateId)
    assert.equal(report.gate, 'duplicate')
    assert.equal(report.historyRecorded, true)
    assert.ok(candidateJudgeRequests.some(request => request.state.candidate?.target))
    console.log(JSON.stringify({ candidateSmoke: 'passed', realNativeCapture: true, modelResponses: 'mocked', ...report }))
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }

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
  if (process.env.AISLING_HISTORY_SETTING_SMOKE === '1') {
    const historySetting = await contents.executeJavaScript(`(async () => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
    await router.push('/settings/desktop-awareness')
    for (let n = 0; n < 50 && !document.querySelector('form .advanced-settings input[type=checkbox]'); n++)
      await new Promise(resolve => setTimeout(resolve, 50))
    const checkbox = document.querySelector('form .advanced-settings input[type=checkbox]')
    if (!checkbox) throw new Error('Target reply history setting did not render')
    const initiallyOff = !checkbox.checked
    const results = []
    for (const enabled of [true, false]) {
      checkbox.click()
      checkbox.closest('form').requestSubmit()
      for (let n = 0; n < 50; n++) {
        const saved = JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1'))
        if (saved?.desktopAwareness.replyHistoryEnabled === enabled) {
          results.push({ enabled, awarenessEnabled: saved.desktopAwareness.enabled })
          break
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    await router.push('/')
    return { initiallyOff, results }
  })()`)
    assert.equal(historySetting.initiallyOff, true)
    assert.deepEqual(historySetting.results, [
      { enabled: true, awarenessEnabled: false }, { enabled: false, awarenessEnabled: false },
    ])
    console.log(JSON.stringify({ targetHistorySettingSmoke: 'passed', defaultOff: true, optInAndOptOut: true }))
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }
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
      const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
      await router.push('/settings/web-search')
      for (let n = 0; n < 50 && !document.querySelector('.settings-module .module-toggle input'); n++)
        await new Promise(resolve => setTimeout(resolve, 50))
      const module = document.querySelector('.settings-module')
      const toggle = module?.querySelector('.module-toggle input')
      if (!toggle) throw new Error('Web Search settings did not render at ' + location.pathname)
      const provider = settings.config.webSearch.providerType
      const hasKeyField = !!module.querySelector('input[type=password]')
      const initiallyOn = toggle.checked
      toggle.click()
      for (let n = 0; n < 50 && settings.activeWebSearchTool; n++)
        await new Promise(resolve => setTimeout(resolve, 20))
      const disabledBeforeSearch = !settings.activeWebSearchTool
      toggle.click()
      for (let n = 0; n < 50 && !settings.activeWebSearchTool; n++)
        await new Promise(resolve => setTimeout(resolve, 20))
      if (!settings.activeWebSearchTool) throw new Error('Web Search toggle did not enable the tool')
      const results = await settings.activeWebSearchTool.run({ query: 'OpenAI' })
      toggle.click()
      for (let n = 0; n < 50 && settings.activeWebSearchTool; n++)
        await new Promise(resolve => setTimeout(resolve, 20))
      const toolDisabled = !settings.activeWebSearchTool
      const savedSearch = JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1')).webSearch
      await router.push('/')
      return { provider, hasKeyField, initiallyOn, disabledBeforeSearch, results, toolDisabled, savedSearch }
    })()`)
    assert.equal(searchUi.provider, 'duckduckgo')
    assert.equal(searchUi.hasKeyField, false)
    assert.equal(searchUi.initiallyOn, true)
    assert.equal(searchUi.disabledBeforeSearch, true)
    assert.equal(searchUi.results, Array.from({ length: 5 }, (_, index) => `Title ${index + 1}\nSnippet ${index + 1}`).join('\n\n'))
    assert.equal(searchUi.toolDisabled, true)
    assert.deepEqual(searchUi.savedSearch, { providerType: 'duckduckgo', enabled: false })
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
      assert.equal(await contents.executeJavaScript('!document.querySelector(".desktop-surface .speech-bubble:not([hidden]), .desktop-surface .desktop-composer")'), true)
      contents.send('aisling:desktop-pointer', 'character')
      await new Promise(resolve => setTimeout(resolve, 350))
      const desktopUi = await contents.executeJavaScript(`(async () => {
        const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('settings')
        settings.activeChatProvider = { id: 'smoke', complete: async request => ({ text: 'Echo: ' + request.messages.at(-1).content }) }
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
        for (let n = 0; n < 40 && !root.querySelector('.speech-bubble .line'); n++)
          await new Promise(resolve => setTimeout(resolve, 50))
        const reply = root.querySelector('.speech-bubble .line')?.textContent
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
