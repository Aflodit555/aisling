// Synthetic Electron acceptance: legacy formats are offline recovery inputs, never runtime choices.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { app } = require('electron'), { execFile } = require('node:child_process'), { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')
const { startDesktop } = require('./desktop-app.cjs')
const [phase, profile, resources] = process.argv.slice(2)
const root = path.resolve(__dirname, '../../artifacts/memory-note-only-p4')
assert(['legacy', 'v2', 'lock', 'fresh', 'blocked', 'unmarked'].includes(phase))
assert.equal(path.dirname(fs.realpathSync(profile)), fs.realpathSync(root))
assert.equal(fs.readFileSync(path.join(profile, '.migration-fixture'), 'utf8'), 'aisling-p4-synthetic\n')
app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
const dev = process.env.AISLING_DEV === '1', stageUrl = dev ? 'http://localhost:5174' : 'aisling://stage'
const opts = { show: false, diagnostics: false, stageUrl: stageUrl + '/settings/memory', noteOnlyForNewProfiles: true, noteV2: { resources } }
const deadline = setTimeout(() => app.exit(2), 45_000)
const finish = () => { clearTimeout(deadline); console.log('p4-smoke:' + phase); app.quit() }
;(async () => {
  if (phase === 'lock') {
    await assert.rejects(startDesktop(opts), /exclusive profile access/); finish(); return
  }
  if (['legacy', 'blocked', 'unmarked'].includes(phase)) {
    await assert.rejects(startDesktop(opts), /legacy-memory-profile-cannot-use-v2|migration-not-committed|unmarked-memory-state/)
    assert(!Object.keys(require.cache).some(file => /memory-organization\.cjs$/.test(file)))
    assert(!fs.existsSync(path.join(profile, 'memory-authority')))
    finish(); return
  }
  const win = await startDesktop(opts), web = win.contentView.children[0].webContents
  const js = expression => web.executeJavaScript(expression)
  const waitFor = async (expression, description) => {
    for (let i = 0; i < 160; i++) { if (await js(expression)) return; await delay(25) }
    throw Error(description + ': ' + await js('document.body.innerText.slice(0,300)'))
  }
  let requestedLegacy = false
  web.debugger.attach('1.3')
  try {
    web.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent' && /\/(?:legacy-memory|reflection-formation|reflection-recall)(?:-|\.ts)/.test(params.request.url)) requestedLegacy = true
    })
    await web.debugger.sendCommand('Network.enable'); await web.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })
    await web.loadURL(stageUrl + '/settings/memory?retirement-check')
    await waitFor("Boolean(document.querySelector('.settings-module h2'))", 'Memory did not mount')
  } finally { web.debugger.detach() }
  assert.equal(requestedLegacy, false)
  assert.equal(await js('Boolean(window.aislingDesktop.memoryMigration || window.aislingDesktop.memoryOrganization || window.aislingDesktop.reflectionStorage)'), false)
  assert.equal(await js('Boolean(window.aislingDesktop.noteFormation && window.aislingDesktop.noteRecall)'), true)
  assert.equal(await js("Boolean(document.querySelector('#migration-title'))"), false)
  await waitFor("document.querySelector('.settings-module h2')?.textContent.trim() === " + JSON.stringify(phase === 'v2' ? '记忆' : 'Memory'), 'Localized Memory did not render')
  if (phase === 'v2') {
    const competing = await promisify(execFile)(process.execPath, [__filename, 'lock', profile, resources], {
      windowsHide: true, timeout: 20_000, env: { ...process.env, AISLING_DEV: '' },
    })
    assert.match(competing.stdout, /p4-smoke:lock/)
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
  }
  finish()
})().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1) })
