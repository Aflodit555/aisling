const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, dialog } = require('electron')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')
const { startDesktop } = require('./desktop-app.cjs')

const [phase, profile, resources] = process.argv.slice(2)
const fixtureRoot = path.resolve(__dirname, '../../artifacts/memory-note-only-p4')
assert(['legacy', 'v2', 'lock', 'fresh', 'blocked', 'unmarked'].includes(phase))
assert.equal(path.dirname(fs.realpathSync(profile)), fs.realpathSync(fixtureRoot))
assert.equal(fs.readFileSync(path.join(profile, '.migration-fixture'), 'utf8'), 'aisling-p4-synthetic\n')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')

const dev = process.env.AISLING_DEV === '1'
const stageUrl = dev ? 'http://localhost:5174' : 'aisling://stage'
const opts = { show: false, diagnostics: false, stageUrl: stageUrl + '/settings/memory', noteOnlyForNewProfiles: true, noteV2: { resources } }
const finish = () => { console.log('p4-smoke:' + phase); app.quit() }
const deadline = setTimeout(() => app.exit(2), 45_000)
;(async () => {
  if (phase === 'lock') {
    await assert.rejects(startDesktop(opts), /exclusive profile access/)
    clearTimeout(deadline)
    finish()
    return
  }
  let answer = 0, confirmations = 0, restarted = false
  dialog.showMessageBox = async () => { confirmations++; return { response: answer } }
  app.relaunch = () => { restarted = true }
  const win = await startDesktop(opts)
  const web = win.contentView.children[0].webContents
  const loaded = name => Object.keys(require.cache).some(file => path.basename(file) === name)
  if (['v2', 'fresh'].includes(phase)) {
    assert.equal(loaded('memory-migration.cjs'), false)
    assert.equal(loaded('memory-organization.cjs'), false)
    assert.equal(loaded('memory-archive.cjs'), phase === 'v2')
  }
  const js = expression => web.executeJavaScript(expression)
  const waitFor = async (expression, description) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await js(expression)) return
      await delay(25)
    }
    const observed = await js("({ path: location.pathname, text: document.body.innerText.slice(0, 300), migration: !!window.aislingDesktop?.memoryMigration })")
    throw new Error(description + ' ' + JSON.stringify(observed))
  }
  const openMemory = () => waitFor("Boolean(document.querySelector('.settings-module h2'))", 'Memory page did not mount')
  let requestedLegacy = false
  web.debugger.attach('1.3')
  try {
    web.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent' && /\/legacy-memory(?:-|\.ts)/.test(params.request.url)) requestedLegacy = true
    })
    await web.debugger.sendCommand('Network.enable')
    await web.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })
    await web.loadURL(stageUrl + '/settings/memory?observe-compatibility')
    await openMemory()
  } finally { web.debugger.detach() }
  assert.equal(requestedLegacy, ['legacy', 'blocked', 'unmarked'].includes(phase))
  if (phase === 'legacy') {
    // In Vite mode the second process uses the built renderer on the same profile.
    const competing = await promisify(execFile)(process.execPath, [__filename, 'lock', profile, resources], {
      windowsHide: true, timeout: 20_000, env: { ...process.env, AISLING_DEV: '' },
    })
    assert.match(competing.stdout, /p4-smoke:lock/)
    await openMemory()
    win.setSize(720, 560)
    web.setZoomFactor(1.2)
    assert.equal(await js('Boolean(window.aislingDesktop.memoryMigration)'), true)
    await waitFor("Boolean(document.querySelector('#migration-title'))", 'Migration panel did not mount')
    assert.match(await js('document.body.innerText'), /Check previous memories/)
    await js("document.querySelector('.migration button').click()")
    await waitFor("Boolean(document.querySelector('.disposition button'))", 'Eligible disposition did not render')
    assert(await js("(() => { const page = document.querySelector('.settings'); page.scrollTop = page.scrollHeight; return page.scrollTop > 0 })()"))
    const preview = await js('window.aislingDesktop.memoryMigration.preflight()')
    const [item] = preview.choices
    const discard = 'window.aislingDesktop.memoryMigration.exclude(' + JSON.stringify(item.key) + ', ' + JSON.stringify(preview.version) + ')'
    assert.equal(await js(discard), 'cancelled')
    answer = 1
    assert.equal(await js(discard), 'excluded')
    assert.equal(await js(discard), 'excluded')
    answer = 0
    await js("document.querySelector('.migration-actions button').click()")
    await waitFor("[...document.querySelectorAll('.migration button')].some(button => button.textContent.includes('Review and upgrade'))", 'Eligible inventory did not render')
    assert.match(await js('document.querySelector(".inventory").innerText'), /Other memories ready\s+1/)
    assert.equal((await js('window.aislingDesktop.memoryMigration.execute()')).phase, 'legacy')
    assert(!fs.existsSync(path.join(profile, 'memory-authority')))
    answer = 1
    assert.equal((await js('window.aislingDesktop.memoryMigration.execute()')).phase, 'committed')
    assert.equal(confirmations, 4)
    assert.equal(restarted, !dev)
    assert.equal(await js("window.aislingDesktop.reflectionStorage.write('{}')"), false)
    await js("window.aislingDesktop.storage.setItem('aisling.language.v1', 'zh-CN')")
  } else if (phase === 'v2') {
    await openMemory()
    assert(await js('Boolean(window.aislingDesktop.noteFormation && window.aislingDesktop.noteRecall)'))
    assert.equal(await js("Boolean(document.querySelector('#migration-title'))"), false)
    assert.equal(await js('Boolean(window.aislingDesktop.memoryMigration || window.aislingDesktop.reflectionStorage)'), false)
    await waitFor("document.querySelector('.settings-module h2')?.textContent.trim() === '记忆'", 'Chinese Memory did not render')
    const first = await js('window.aislingDesktop.noteRecall.snapshot()')
    assert.equal(first.notes[0].note.content, '用户报告纸舟第一版已发布。')
    await js("window.aislingDesktop.storage.setItem('aisling.conversations.v1', JSON.stringify({sessions:[]}))")
    assert.equal(await js('window.aislingDesktop.noteRecall.current(' + JSON.stringify(first.version) + ')'), false)
    assert.deepEqual((await js('window.aislingDesktop.noteRecall.snapshot()')).notes, [])
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'aisling-reflections.v1.json'), 'utf8')).reflections, [])
    for (const [route, heading] of [['consciousness', 'LLM'], ['speech', 'TTS']]) {
      await web.loadURL(stageUrl + '/settings/' + route)
      await waitFor("document.querySelector('.settings-module h2')?.textContent.trim() === " + JSON.stringify(heading), route + ' did not render')
    }
  } else if (phase === 'blocked' || phase === 'unmarked') {
    assert(await js('Boolean(window.aislingDesktop.memoryMigration && window.aislingDesktop.reflectionStorage)'))
    assert.equal(await js('Boolean(window.aislingDesktop.noteFormation || window.aislingDesktop.noteRecall)'), false)
    const state = await js('window.aislingDesktop.memoryMigration.status()')
    if (phase === 'blocked') {
      assert.equal(state.phase, 'migrating')
      assert.equal(await js("window.aislingDesktop.storage.setItem('aisling.conversations.v1', JSON.stringify({sessions:[]}))"), false)
      assert.equal(await js("window.aislingDesktop.reflectionStorage.write('{}')"), false)
    } else assert.equal(state.phase, 'legacy')
    assert(!fs.existsSync(path.join(profile, 'memory-authority')))
    assert(!fs.existsSync(path.join(profile, 'memory-note-v2')))
  } else {
    await openMemory()
    assert.equal(await js('Boolean(window.aislingDesktop.memoryMigration)'), false)
    assert(await js('Boolean(window.aislingDesktop.noteFormation)'))
  }
  clearTimeout(deadline)
  finish()
})().catch(error => {
  console.error(error)
  clearTimeout(deadline)
  app.exit(1)
})
