// Run against `pnpm dev --host 127.0.0.1`: node apps/stage-desktop/node_modules/electron/cli.js apps/stage-desktop/interaction-smoke.cjs
// Uses the real Live2D model, isolated settings, and no external model/API calls.
const { app, screen, BaseWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop, enterDesktopMode, returnToStage } = require('./desktop-app.cjs')

app.disableHardwareAcceleration()
delete process.env.TYPESAFE_API_KEY
app.setPath('userData', path.join(os.tmpdir(), `aisling-interaction-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Interaction smoke timed out'); app.exit(1) }, 90000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false, stageUrl: 'http://127.0.0.1:5174' })
  const contents = win.contentView.children[0].webContents
  const init = async () => contents.executeJavaScript(`(async () => {
    for (let n = 0; n < 150; n++) {
      const renderer = document.querySelector('.live2d-renderer')?.__vueParentComponent?.setupState
      const character = document.querySelector('.surface')?.__vueParentComponent?.setupState
      if (renderer?.model && character?.rig) {
        window.__interactionSmoke = { renderer, character, started: [] }
        renderer.model.internalModel.motionManager.on('motionStart', (group, index) => {
          if (group !== 'Idle') window.__interactionSmoke.started.push(index)
        })
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return {
      text: document.body.innerText.slice(0, 500),
      html: document.body.outerHTML.slice(0, 2000),
      renderer: Object.keys(document.querySelector('.live2d-renderer')?.__vueParentComponent?.setupState ?? {}),
      character: Object.keys(document.querySelector('.surface')?.__vueParentComponent?.setupState ?? {}),
    }
  })()`)
  assert.equal(await init(), true, 'the real model and rig must load')
  let stageResult
  if (!process.argv.includes('--desktop-only')) {
    // Show the renderer so its motion clock advances even on a headless smoke run.
    enterDesktopMode()
    returnToStage()
    assert.equal(await init(), true)
    await wait(200)
    const head = await contents.executeJavaScript(`(() => {
      const { model } = window.__interactionSmoke.renderer
      const area = model.internalModel.hitAreas.HitAreaHead
      const bounds = model.internalModel.getDrawableBounds(area.index)
      const { x, y } = model.toGlobal({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
      const canvas = document.querySelector('.live2d-canvas').getBoundingClientRect()
      return { x: Math.round(canvas.left + x), y: Math.round(canvas.top + y) }
    })()`)
    contents.sendInputEvent({ type: 'mouseMove', x: head.x + 120, y: head.y })
    await wait(500)
    const right = await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.coreModel.getParameterValueById("ParamEyeBallX")')
    contents.sendInputEvent({ type: 'mouseMove', x: head.x - 120, y: head.y })
    await wait(500)
    const left = await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.coreModel.getParameterValueById("ParamEyeBallX")')
    assert.ok(right > left + 0.2, 'gaze must follow pointer direction')

    const gestures = await contents.executeJavaScript(`(async () => {
      const { renderer, character, started } = window.__interactionSmoke
      const manager = renderer.model.internalModel.motionManager
      const { useEmotionStore } = await import('/src/stores/emotion.ts')
      useEmotionStore().offer({ emotion: 'joy', confidence: 1, intensity: 0.5 })
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      let wink
      for (let i = 0; i < 6; i++) {
        document.querySelector('.drive-test').click()
        document.querySelector('.drive-test').click() // a rapid second click cannot interrupt
        await wait(100)
        const index = manager.state.currentIndex
        if (index === 5) {
          await wait(1900)
          const core = renderer.model.internalModel.coreModel
          wink = [core.getParameterValueById('ParamEyeLOpen'), core.getParameterValueById('ParamEyeROpen')]
        }
        for (let n = 0; n < 240 && character.rig.isGesture(); n++) await wait(50)
        if (character.rig.isGesture()) throw new Error('Gesture did not return to idle: ' + JSON.stringify({ index, state: manager.state, modelDestroyed: renderer.model.destroyed, tickerStarted: renderer.app.ticker.started, elapsed: renderer.model.elapsedTime, motion: manager.motionGroups[manager.state.currentGroup]?.[index]?._isLoop }))
        await wait(50)
      }
      return { started, wink, idle: !character.rig.isGesture() }
    })()`)
    assert.equal(gestures.started.length, 6, 'rapid double clicks must still play one gesture')
    assert.equal(new Set(gestures.started).size, 6, 'every gesture must be reachable')
    assert.ok(gestures.wink?.[0] < 0.1 && gestures.wink?.[1] > 0.8, 'the authored wink must survive emotion/idle layers')
    assert.equal(gestures.idle, true)

    // A genuine head click, then a stage drag. Moving must not start another gesture.
    contents.sendInputEvent({ type: 'mouseDown', x: head.x, y: head.y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: head.x, y: head.y, button: 'left', clickCount: 1 })
    await wait(100)
    assert.equal(await contents.executeJavaScript('window.__interactionSmoke.started.length'), 7)
    await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.motionManager.stopAllMotions()')
    const before = await contents.executeJavaScript('window.__interactionSmoke.renderer.model.x')
    contents.sendInputEvent({ type: 'mouseDown', x: head.x, y: head.y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseMove', x: head.x + 30, y: head.y + 10 })
    contents.sendInputEvent({ type: 'mouseUp', x: head.x + 30, y: head.y + 10, button: 'left', clickCount: 1 })
    await wait(100)
    const dragged = await contents.executeJavaScript('({ x: window.__interactionSmoke.renderer.model.x, motions: window.__interactionSmoke.started.length })')
    assert.ok(Math.abs(dragged.x - before - 30) < 1, 'Stage drag must move the model')
    assert.equal(dragged.motions, 7, 'drag release must not perform a tap')
    stageResult = { gaze: { left, right }, gestures, dragged }
  }

  enterDesktopMode()
  assert.equal(await init(), true)
  await wait(900)
  const desktop = BaseWindow.getAllWindows().find(window => window !== win)
  const bounds = desktop.getContentBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  assert.equal(bounds.y + bounds.height, workArea.y + workArea.height, 'the initial visible window must stop above the taskbar')
  const realCursor = screen.getCursorScreenPoint
  let cursor = { x: bounds.x - 1000, y: bounds.y + 150 }
  screen.getCursorScreenPoint = () => cursor
  await wait(350)
  const outsideLeft = await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.coreModel.getParameterValueById("ParamEyeBallX")')
  cursor = { x: bounds.x + 1400, y: bounds.y + 150 }
  await wait(350)
  const outsideRight = await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.coreModel.getParameterValueById("ParamEyeBallX")')
  assert.ok(outsideRight > outsideLeft + 0.2, 'desktop gaze must accept cursor positions outside the window')
  const tap = { x: Math.round(bounds.width / 2), y: 190 }
  cursor = { x: bounds.x + tap.x, y: bounds.y + tap.y }
  await contents.executeJavaScript(`(() => {
    const renderer = window.__interactionSmoke.renderer.app.renderer
    const resize = renderer.resize.bind(renderer)
    window.__interactionSmoke.resizes = 0
    renderer.resize = (...args) => { window.__interactionSmoke.resizes++; return resize(...args) }
  })()`)
  const geometry = () => contents.executeJavaScript(`(() => {
    const { model, app, container } = window.__interactionSmoke.renderer
    return { scale: model.scale.x, x: model.x, y: model.y, screen: { width: app.screen.width, height: app.screen.height },
      viewport: [innerWidth, innerHeight], container: [container.clientWidth, container.clientHeight],
      parent: [container.parentElement.clientWidth, container.parentElement.clientHeight],
      scroll: [scrollX, scrollY], resizes: window.__interactionSmoke.resizes }
  })()`)
  const initialGeometry = await geometry()
  contents.sendInputEvent({ type: 'mouseDown', ...tap, button: 'left', clickCount: 1 })
  await wait(3500)
  assert.deepEqual(await geometry(), initialGeometry, 'a long press must not resize or shift the model')
  contents.sendInputEvent({ type: 'mouseMove', x: tap.x + 40, y: tap.y + 40 })
  await wait(1000)
  assert.deepEqual(await geometry(), initialGeometry, 'holding a drag must not clear or resize the canvas')
  contents.sendInputEvent({ type: 'mouseUp', x: tap.x + 40, y: tap.y + 40, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseDown', ...tap, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', ...tap, button: 'left', clickCount: 1 })
  await wait(100)
  assert.equal(await contents.executeJavaScript('window.__interactionSmoke.started.length'), 1, 'desktop tap must perform')
  await contents.executeJavaScript('window.__interactionSmoke.renderer.model.internalModel.motionManager.stopAllMotions()')
  contents.sendInputEvent({ type: 'mouseDown', ...tap, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseMove', x: tap.x + 30, y: tap.y })
  contents.sendInputEvent({ type: 'mouseUp', x: tap.x + 30, y: tap.y, button: 'left', clickCount: 1 })
  await wait(100)
  assert.equal(await contents.executeJavaScript('window.__interactionSmoke.started.length'), 1, 'desktop drag must not perform another tap')
  contents.sendInputEvent({ type: 'mouseDown', ...tap, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', x: tap.x + 30, y: tap.y, button: 'left', clickCount: 1 })
  await wait(50)
  assert.equal(await contents.executeJavaScript('window.__interactionSmoke.started.length'), 1, 'release displacement must suppress a tap even without a move event')
  await contents.executeJavaScript('window.aislingDesktop.setDragging(true)')
  await wait(30)
  cursor = { x: cursor.x - 60, y: cursor.y }
  await wait(80)
  assert.equal(desktop.getContentBounds().x, bounds.x - 60, 'desktop dragging must move horizontally with the OS cursor')
  for (const delta of [-2, 2]) {
    for (let n = 0; n < 20; n++) {
      cursor = { x: cursor.x + delta, y: cursor.y }
      await wait(35)
      const current = desktop.getContentBounds()
      assert.equal(current.width, bounds.width, 'repeated moves must not grow the window width')
      assert.equal(current.height, bounds.height, 'repeated moves must not grow the window height')
      assert.equal(current.y + current.height, workArea.y + workArea.height, 'dragging must stay above the taskbar')
    }
  }
  for (const x of [-10000, 10000]) {
    cursor = { x, y: cursor.y }
    await wait(80)
    const current = desktop.getContentBounds()
    assert.ok(current.x >= workArea.x && current.x + current.width <= workArea.x + workArea.width, 'dragging must stay inside the work area')
  }
  assert.deepEqual(await geometry(), initialGeometry, 'continuous dragging must preserve scale, position and canvas without any resize')
  console.log('Stable desktop geometry: ' + JSON.stringify({ renderer: await geometry(), bounds: desktop.getContentBounds(), workArea }))
  returnToStage()
  screen.getCursorScreenPoint = realCursor
  assert.equal(desktop.isDestroyed(), true, 'switching modes must end desktop dragging')
  assert.equal(await init(), true)
  await wait(300)
  writeFileSync(path.join(app.getPath('userData'), 'interaction-smoke.png'), (await contents.capturePage()).toPNG())
  console.log('Screenshot: ' + path.join(app.getPath('userData'), 'interaction-smoke.png'))
  console.log(JSON.stringify({ ok: true, stage: stageResult, desktop: true }))
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
})().catch(error => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
