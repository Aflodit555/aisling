// With the local Vite server running: node apps/stage-desktop/node_modules/electron/cli.js apps/stage-desktop/bubble-smoke.cjs
const { app } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop, enterDesktopMode } = require('./desktop-app.cjs')

app.disableHardwareAcceleration()
delete process.env.TYPESAFE_API_KEY
app.setPath('userData', path.join(os.tmpdir(), `aisling-bubble-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Bubble smoke timed out'); app.exit(1) }, 45000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false, stageUrl: 'http://127.0.0.1:5174' })
  const contents = win.contentView.children[0].webContents
  await contents.executeJavaScript(`(async () => {
    const { useStageStore } = await import('/src/stores/stage.ts')
    useStageStore().messages = [{ role: 'assistant', content: 'Earlier conversation' }]
  })()`)
  enterDesktopMode()
  assert.equal(await contents.executeJavaScript(`(async () => {
    for (let n = 0; n < 100; n++) {
      if (document.querySelector('.speech-bubble')) {
        const { useStageStore } = await import('/src/stores/stage.ts')
        const { useSpeechStore } = await import('/src/stores/speech.ts')
        window.__bubbleSmoke = { stage: useStageStore(), speech: useSpeechStore() }
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  })()`), true)
  const change = source => contents.executeJavaScript(`(async () => {
    const { stage, speech } = window.__bubbleSmoke
    ${source}
    const { nextTick } = await import('/node_modules/.vite/deps/vue.js')
    await nextTick()
  })()`)
  const read = () => contents.executeJavaScript(`(() => {
    const bubble = document.querySelector('.speech-bubble')
    const rect = bubble.getBoundingClientRect()
    const dots = getComputedStyle(bubble, '::before')
    return { hidden: bubble.hidden, text: bubble.textContent.trim(), width: rect.width, height: rect.height,
      dots: dots.animationName, doing: !!bubble.querySelector('.doing'),
      transition: getComputedStyle(bubble).transitionProperty,
      lineWidth: bubble.querySelector('.line')?.getBoundingClientRect().width }
  })()`)
  const capture = async name => writeFileSync(path.join(app.getPath('userData'), `${name}.png`), (await contents.capturePage()).toPNG())

  assert.equal((await read()).hidden, true, 'entering desktop mode must not replay an earlier reply')
  await change("stage.messages = [{ role: 'user', content: 'Hello' }]; stage.sending = true")
  await wait(400)
  const thinking = await read()
  assert.equal(thinking.hidden, false)
  assert.equal(thinking.text, '')
  assert.match(thinking.dots, /waiting/)
  await capture('thinking')
  await change('stage.searching = true')
  await wait(400)
  assert.equal((await read()).doing, true)
  await change('stage.searching = false')
  await wait(400)
  const text = '你好，这是从思考气泡平滑展开的回复。内容会按最终宽度排版，随后淡入，长句也可以自然换行。'
  await change(`stage.messages.push({ role: 'assistant', content: ${JSON.stringify(text)} })`)
  await wait(60)
  const expanding = await read()
  await wait(400)
  const expanded = await read()
  assert.ok(expanding.width > thinking.width && expanding.width < expanded.width, 'the bubble width must interpolate from the dots to the line')
  assert.equal(expanding.lineWidth, expanded.lineWidth, 'the line must keep its final layout while the bubble grows')
  assert.ok(expanded.height > thinking.height, 'the bubble must also grow in height')
  assert.ok(expanded.width <= 360 * 0.85 + 1, 'the bubble must stay within its desktop width')
  assert.equal(expanded.text, text)
  await capture('expanded')

  await change("stage.messages[1] = { role: 'assistant', content: 'Hi' }")
  await wait(2450)
  assert.equal((await read()).hidden, false, 'a partial reply must remain while streaming')
  await change("speech.phase = 'buffering'; stage.sending = false")
  await wait(2450)
  assert.equal((await read()).hidden, false, 'voice generation must hold the bubble')
  await change("speech.phase = 'playing'")
  await change("speech.phase = 'idle'")
  await wait(1700)
  assert.equal((await read()).hidden, true, 'the bubble must leave 1.5 seconds after speech ends')
  await change("stage.messages[1] = { role: 'assistant', content: 'OK' }")
  await wait(2500)
  assert.equal((await read()).hidden, true, 'a silent line must leave after its reading time')
  await change("stage.messages[1] = { role: 'assistant', content: 'New' }")
  await wait(200)
  await change("stage.messages.push({ role: 'user', content: 'Next' }); stage.sending = true")
  await wait(2650)
  assert.equal((await read()).hidden, false, 'a new thought must cancel the previous line timer')
  assert.equal((await read()).text, '')
  console.log(JSON.stringify({ ok: true, thinking, expanding, expanded, screenshots: app.getPath('userData') }))
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1) })
