// Production loading smoke: no dev server. Loads the built renderer through the
// `aisling://stage` custom scheme and verifies the renderer mounts, the desktop
// bridge is present, and the file-backed storage bridge round-trips.
const { app, BaseWindow, Menu, nativeImage, screen } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync, mkdtempSync, readFileSync, existsSync } = require('node:fs')
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
app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'aisling-desktop-prod-smoke-')))
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

  const backgroundThrottling = contents.getBackgroundThrottling()
  contents.setBackgroundThrottling(false)
  const characterRendered = await contents.executeJavaScript(`(async () => {
    for (let n = 0; n < 200; n++) {
      const canvas = document.querySelector('.live2d-canvas')
      if (canvas && !document.querySelector('.renderer-state')) {
        await new Promise(requestAnimationFrame)
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        return pixels.some((value, index) => index % 4 === 3 && value > 0)
      }
      if (document.querySelector('.renderer-error')) return false
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return false
  })()`)
  assert.equal(characterRendered, true, 'Live2D must draw visible pixels, not just mount a canvas')
  const screenshot = path.join(app.getPath('userData'), 'stage-prod-smoke.png')
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync(screenshot, (await contents.capturePage()).toPNG())
  contents.setBackgroundThrottling(backgroundThrottling)

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

  if (process.env.AISLING_FORMATION_SMOKE === '1') {
    const report = await contents.executeJavaScript(String.raw`(async () => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const stage = pinia._s.get('stage'), settings = pinia._s.get('settings')
      async function until(test, phase) {
        for (let n = 0; n < 300; n++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
        throw new Error('Formation smoke timed out at ' + phase + ': ' + JSON.stringify(stage.formationStatus))
      }
      await until(() => settings.loaded, 'settings')
      const defaultOff = !stage.formationStatus.enabled && !settings.config.memory.formationEnabled
        && window.aislingDesktop.reflectionStorage.read().value === null
      let finish, ordinaryCalls = 0, backgroundCalls = 0, request, ordinaryRequest
      settings.activeChatProvider = { id: 'formation-smoke', complete: async input => {
        if (input.messages[0].content.startsWith('You form append-only')) {
          backgroundCalls++; request = input
          return new Promise(resolve => { finish = resolve })
        }
        ordinaryCalls++; ordinaryRequest = input; return { text: '这是已经交付的回复。' }
      } }
      await settings.setMemoryFormationEnabled(true)
      await until(() => stage.formationStatus.lastEvent === 'ready', 'formation-init')
      for (const text of ['纸舟实验版已发布。', '纸舟还有识别错误。', '纸舟识别错误已修复。']) {
        stage.send(text); await until(() => !stage.sending, 'chat')
      }
      await until(() => backgroundCalls === 1, 'batch')
      const chatDidNotWait = stage.sending === false
      finish({ text: JSON.stringify({ reflections: [{ content: '用户报告纸舟实验版已发布。', kind: 'project-state', basis: 'direct', tags: ['纸舟'], sources: ['E1'], related: [] }] }) })
      await until(() => stage.formation.inspect().reflections.length === 1, 'commit')
      const state = stage.formation.inspect(), reflection = state.reflections[0], source = reflection.sourceRefs[0]
      const stored = JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions
        .find(session => session.id === source.sessionId).messages[source.messageIndex]
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stored)))
      const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
      await settings.setMemoryFormationEnabled(false)
      stage.newConversation()
      stage.send('纸舟实验版目前已经撤回发布。'); await until(() => !stage.sending, 'reflection-recall')
      const reflectionBlock = ordinaryRequest.messages.find(m => m.content.startsWith('[Historical Aisling reflections]'))
      const recallBlock = ordinaryRequest.messages.find(m => m.content.startsWith('[Cross-session recall evidence]'))
      return { defaultOff, chatDidNotWait, ordinaryCalls, backgroundCalls,
        reflectionRecalled: !!reflectionBlock && reflectionBlock.content.includes(reflection.content),
        bothMemories: !!reflectionBlock && !!recallBlock,
        reflectionIdsIsolated: !!reflectionBlock && !reflectionBlock.content.includes(reflection.id) && !reflectionBlock.content.includes(source.sessionId),
        currentInputPreserved: ordinaryRequest.messages.at(-1).content === '纸舟实验版目前已经撤回发布。',
        sourceResolves: stored.role === 'user' && stored.content === '纸舟实验版已发布。' && actual === source.digest,
        memoryEnabled: settings.config.memory.enabled === true,
        idsIsolated: !JSON.stringify(request).includes(stage.activeSessionId) && !JSON.stringify(request).includes('messageIndex'),
        batchComplete: state.batches[0].status === 'completed' && state.batches[0].sourceRefs.length === 6 }
    })()`)
    for (const key of ['defaultOff', 'chatDidNotWait', 'sourceResolves', 'memoryEnabled', 'idsIsolated', 'batchComplete',
      'reflectionRecalled', 'bothMemories', 'reflectionIdsIsolated', 'currentInputPreserved']) assert.equal(report[key], true, key)
    assert.equal(report.ordinaryCalls, 4); assert.equal(report.backgroundCalls, 1)
    const file = path.join(app.getPath('userData'), 'aisling-reflections.v1.json')
    assert.equal(existsSync(file), true)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).reflections.length, 1)
    assert.equal(JSON.parse(readFileSync(path.join(app.getPath('userData'), 'aisling-store.json'), 'utf8')).reflections, undefined)
    await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload() })
    const recovered = await contents.executeJavaScript(`(async () => {
      for (let n = 0; n < 200; n++) {
        const pinia = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia
        const stage = pinia?._s.get('stage'), settings = pinia?._s.get('settings')
        if (settings?.loaded && stage && !stage.formationStatus.enabled) {
          const state = stage.formation.inspect()
          let request
          settings.activeChatProvider = { id: 'reflection-restart-smoke', complete: async input => { request = input; return { text: 'ok' } } }
          stage.send('纸舟实验版发布情况？')
          for (let i = 0; i < 200 && stage.sending; i++) await new Promise(resolve => setTimeout(resolve, 10))
          return state.reflections.length === 1 && state.batches[0].status === 'completed' && stage.formationStatus.calls === 0
            && request?.messages.some(m => m.content.startsWith('[Historical Aisling reflections]'))
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return false
    })()`)
    assert.equal(recovered, true)
    console.log(JSON.stringify({ formationSmoke: 'passed', modelResponses: 'mocked', separateFile: true, restartDeduplicated: recovered, ...report }))
    clearTimeout(timeout); win.destroy(); app.exit(0); return
  }

  if (process.env.AISLING_MEMORY_SMOKE === '1') {
    contents.setBackgroundThrottling(false)
    // Hidden windows can stall route-leave animations; load the settings route directly.
    await contents.loadURL('aisling://stage/settings/memory')
    const report = await contents.executeJavaScript(String.raw`(async () => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const stage = pinia._s.get('stage'), settings = pinia._s.get('settings'), requests = []
      let reply = '', pending, reject = false
      settings.activeChatProvider = { id: 'memory-smoke', complete: async request => {
        requests.push(request)
        if (pending) return new Promise(resolve => { pending.resolve = resolve })
        if (reject) throw new Error('Synthetic generation failure')
        return { text: reply }
      } }
      async function settled() {
        for (let n = 0; n < 200 && stage.sending; n++) await new Promise(resolve => setTimeout(resolve, 10))
        if (stage.sending) throw new Error('Memory smoke did not settle')
      }
      const saved = () => JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions
      const marker = '[Cross-session recall evidence]'
      const evidence = request => request.messages.find(message => message.content?.startsWith(marker))?.content
      for (let n = 0; n < 100 && !document.querySelector('.settings-module input[role="switch"]'); n++)
        await new Promise(resolve => setTimeout(resolve, 10))
      const toggle = document.querySelector('.settings-module input[role="switch"]')
      if (!toggle) throw new Error('Memory settings switch did not mount: ' + document.body.innerText.slice(0, 500))
      const defaultOn = toggle.checked && stage.memoryRecallEnabled === true
      const formationDefaultOff = document.querySelectorAll('.settings-module input[role="switch"]').length === 2
        && document.querySelectorAll('.settings-module input[role="switch"]')[1].checked === false
      const formationCopy = document.querySelector('.settings-module').textContent.includes('May make additional LLM requests.')
      async function setMemory(enabled) {
        toggle.checked = enabled
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
        for (let n = 0; n < 100; n++) {
          const config = JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1') || '{}')
          if (config.memory?.enabled === enabled && stage.memoryRecallEnabled === enabled) return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('Memory consent did not persist')
      }
      async function setFormation(enabled) {
        for (let n = 0; n < 100 && document.querySelectorAll('.settings-module input[role="switch"]').length !== 2; n++)
          await new Promise(resolve => setTimeout(resolve, 10))
        const formation = document.querySelectorAll('.settings-module input[role="switch"]')[1]
        if (!formation) throw new Error('Formation switch did not expand')
        formation.checked = enabled
        formation.dispatchEvent(new Event('change', { bubbles: true }))
        for (let n = 0; n < 100; n++) {
          const config = JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1') || '{}')
          if (config.memory?.formationEnabled === enabled && stage.formationStatus.enabled === enabled) return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('Formation switch did not persist')
      }
      await setFormation(true)
      await setMemory(false)
      await new Promise(resolve => setTimeout(resolve, 0))
      const collapsedWhenOff = document.querySelectorAll('.settings-module input[role="switch"]').length === 1
        && settings.config.memory.formationEnabled === false && stage.formationStatus.enabled === false
      await setMemory(true)
      const formationNotReenabled = settings.config.memory.formationEnabled === false && stage.formationStatus.enabled === false
      const oldId = stage.activeSessionId
      reply = '萤桥发布：我猜它稳定了。'
      stage.send('萤桥发布：2026-03-01 是实验版。'); await settled()
      reply = '萤桥发布：我之前的判断错了。'
      stage.send('萤桥发布：纠正，2026-04-02 才发布稳定版，2026-04-05 又发现崩溃。'); await settled()
      const autonomous = () => ({ id: 'smoke-turn', kind: 'autonomous', source: 'desktop', at: Date.now(), candidate: {
        id: 'private-candidate', objectId: 'private-object', source: 'foreground', change: 'appeared',
        snapshot: { capturedAt: 1000, targetHwnd: '1', sequence: 1 },
        target: { app: 'Synthetic browser', title: '萤桥发布', text: 'An old photograph.' }
      } })
      await setMemory(true)
      reply = '萤桥发布：窗口旧照片不能证明你刚刚发布。'
      stage.sendStimulus(autonomous()); await settled()
      const autonomousIsolated = !evidence(requests.at(-1))
      pending = {}
      stage.sendStimulus(autonomous()); stage.send('/quiet')
      pending.resolve({ text: '萤桥发布：取消草稿，不是已交付经历。' }); pending = undefined
      await settled()
      reject = true; stage.send('萤桥发布：这条请求会生成失败。'); await settled(); reject = false
      const stored = saved().find(session => session.id === oldId).messages
      stage.newConversation(); await setMemory(false); reply = ''
      const question = '萤桥发布：你以前说过哪些话，当前状态能否确定？'
      stage.send(question); await settled()
      const offIsolated = !JSON.stringify(requests.at(-1)).includes('2026-04-05') && !evidence(requests.at(-1))
      await setMemory(true); stage.send(question); await settled()
      const packed = evidence(requests.at(-1)), records = JSON.parse(packed.split('\n').at(-1))
      const scopes = new Set(records.map(record => record.sourceScope))
      const positions = records.map(record => record.position)
      const report = { defaultOn, formationDefaultOff, formationCopy, collapsedWhenOff, formationNotReenabled,
        autonomousIsolated, offIsolated, injected: !!packed,
        rolesSeparated: ['stored-user-report', 'stored-assistant-utterance', 'stored-autonomous-utterance'].every(scope => scopes.has(scope)),
        quotesIntact: stored.every(message => records.some(record => record.content === message.content)),
        positionOrder: positions.every((position, i) => i === 0 || position > positions[i - 1]),
        timeScope: records.some(record => record.autonomousBasis?.observedAt === '1970-01-01T00:00:01.000Z')
          && records.filter(record => !record.autonomousBasis).every(record => !('deliveredAt' in record)),
        discarded: !packed.includes('取消草稿') && !stored.some(message => message.content.includes('取消草稿')),
        idsIsolated: !packed.includes(oldId) && !packed.includes('private-candidate') && !packed.includes('private-object'),
        bounded: new TextEncoder().encode(JSON.stringify(records)).length <= 6000,
        noPersistedEvidence: !JSON.stringify(saved()).includes(marker) }
      stage.send('还记得有什么吗'); await settled()
      const followupAnchored = stage.memoryRecallDiagnostic?.sessionIds[0] === oldId
        && !!evidence(requests.at(-1))
      stage.deleteSession(oldId); stage.send(question); await settled()
      const size = text => new TextEncoder().encode(text).length
      const contextBounded = requests.every(request => request.messages.reduce((n, message) => n + 8 + size(message.content || ''),
        request.tools?.length ? size(JSON.stringify(request.tools)) : 0) <= 14336)
      const deletionEffective = !evidence(requests.at(-1))
      await setFormation(true)
      return { ...report, followupAnchored, contextBounded, deletionEffective, calls: requests.length }
    })()`)
    for (const [key, value] of Object.entries(report)) if (key !== 'calls') assert.equal(value, true, key)
    assert.equal(report.calls, 9)
    async function reloadMemorySettings() {
      await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload() })
      return contents.executeJavaScript(`(async () => {
        for (let n = 0; n < 200; n++) {
          const globals = document.querySelector('#app')?.__vue_app__?.config.globalProperties
          const settings = globals?.$pinia?._s.get('settings'), stage = globals?.$pinia?._s.get('stage')
          if (settings?.loaded && stage) {
            await globals.$router.push('/settings/memory')
            await new Promise(resolve => setTimeout(resolve, 20))
            const toggle = document.querySelector('.settings-module input[role="switch"]')
            const restored = settings.config.memory.enabled && stage.memoryRecallEnabled && toggle?.checked === true
              && settings.config.memory.formationEnabled && stage.formationStatus.enabled
              && document.querySelectorAll('.settings-module input[role="switch"]')[1]?.checked === true
            if (toggle?.checked) {
              toggle.checked = false
              toggle.dispatchEvent(new Event('change', { bubbles: true }))
            }
            await new Promise(resolve => setTimeout(resolve, 0))
            return { restored, disabled: settings.config.memory.enabled === false && stage.memoryRecallEnabled === false
              && settings.config.memory.formationEnabled === false && stage.formationStatus.enabled === false
              && JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1')).memory.formationEnabled === false
              && JSON.parse(window.aislingDesktop.storage.getItem('aisling.config.v1')).memory.enabled === false
              && document.querySelectorAll('.settings-module input[role="switch"]').length === 1,
              checked: toggle?.checked }
          }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('Memory settings did not recover after reload')
      })()`)
    }
    const enabledReload = await reloadMemorySettings()
    assert.equal(enabledReload.restored, true, 'Memory opt-in must survive renderer restart')
    assert.equal(enabledReload.disabled, true, 'Memory UI must persist opt-out after restart')
    const disabledReload = await reloadMemorySettings()
    assert.equal(disabledReload.restored, false)
    assert.equal(disabledReload.disabled, true)
    assert.equal(disabledReload.checked, false)
    report.restartConsent = true
    console.log(JSON.stringify({ memorySmoke: 'passed', modelResponses: 'mocked', ...report }))
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }

  if (process.env.AISLING_CONTEXT_SMOKE === '1') {
    const report = await contents.executeJavaScript(`(async () => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const stage = pinia._s.get('stage'), settings = pinia._s.get('settings'), requests = []
      settings.activeChatProvider = { id: 'context-smoke', complete: async request => {
        requests.push(request); return { text: '这首歌听起来有些忧伤。' }
      } }
      async function settled() {
        for (let n = 0; n < 200 && stage.sending; n++) await new Promise(resolve => setTimeout(resolve, 10))
        if (stage.sending) throw new Error('Context smoke did not settle')
      }
      const sessionId = stage.activeSessionId, observedAt = Date.now() - 1000
      stage.sendStimulus({ id: 'context-smoke', kind: 'autonomous', source: 'desktop', at: Date.now(), candidate: {
        id: 'candidate-smoke', objectId: 'object-smoke', source: 'foreground', change: 'appeared',
        snapshot: { capturedAt: observedAt, targetHwnd: '123', sequence: 1 },
        target: { app: 'Synthetic player', title: 'Amber Lantern / Mira Vale', text: 'Public synthetic observation. '.repeat(100) }
      } })
      await settled()
      const saved = () => JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions
      const speech = saved().find(session => session.id === sessionId).messages[0]
      stage.send('你刚才说的是什么歌？'); await settled()
      const followUp = requests[1].messages
      stage.newConversation(); stage.send('新的会话'); await settled()
      const isolated = !JSON.stringify(requests[2]).includes('Amber Lantern')
      stage.switchSession(sessionId)
      const restored = stage.runtime.history[0].autonomousContext?.objectId === 'object-smoke'
      stage.deleteSession(sessionId)
      return { delivered: speech.content === '这首歌听起来有些忧伤。',
        basisSaved: speech.autonomousContext?.observedAt === observedAt && speech.autonomousContext?.deliveredAt >= observedAt,
        excerptBounded: speech.autonomousContext?.excerpt.length <= 240,
        basisInjected: followUp.some(message => message.content?.includes('[Past autonomous utterance basis]')),
        protocolClean: followUp.every(message => !('autonomousContext' in message)), isolated, restored,
        deleted: !saved().some(session => session.id === sessionId), calls: requests.length }
    })()`)
    for (const key of ['delivered', 'basisSaved', 'excerptBounded', 'basisInjected', 'protocolClean', 'isolated', 'restored', 'deleted'])
      assert.equal(report[key], true, key)
    assert.equal(report.calls, 3)
    console.log(JSON.stringify({ contextSmoke: 'passed', modelResponses: 'mocked', ...report }))
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
