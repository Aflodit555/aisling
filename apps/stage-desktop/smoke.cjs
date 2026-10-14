// Run with Electron after `pnpm dev`. Uses the real kernel process and a fake
// semantic-judge response so the smoke is deterministic and spends no API quota.
process.env.AISLING_STAGE_URL = 'http://localhost:5174'
process.env.TYPESAFE_API_KEY = 'smoke'
const CANDIDATE_ONLY = process.argv.includes('--candidate')
const NativeResponse = Response
let judgeRequest
let emotionRequest
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body)
  // The emotion judge shares the endpoint; keep its request apart from the awareness judge's.
  const isEmotion = 'emotion' in request.questions
  if (isEmotion)
    emotionRequest = request
  else
    judgeRequest = request
  return new NativeResponse(JSON.stringify({
  answers: isEmotion
    ? {
        emotion: { type: 'choice', choice: 'joy', confidence: 0.9, probabilities: {} },
        intensity: { type: 'score', score: 2, confidence: 0.9, probabilities: {} },
      }
    : { should_interrupt: { type: 'noul', noul: 0.9 } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const { app } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { writeFileSync } = require('node:fs')
const { startDesktop } = require('./desktop-app.cjs')

app.setPath('userData', path.join(os.tmpdir(), `aisling-desktop-smoke-${process.pid}`))
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1) }, 45000)

;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false })
  const contents = win.contentView.children[0].webContents
  const preferences = contents.getLastWebPreferences()
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)

  const result = await contents.executeJavaScript(`(async () => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
    const { useStageStore } = await import('/src/stores/stage.ts')
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    const stage = useStageStore()
    const settings = useSettingsStore()
    await settings.load()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'smoke', cooldownSeconds: 15 })
    const initiallyOff = !(await window.aislingDesktop.readDesktopContext()).enabled
    const calls = []
    settings.activeChatProvider = { id: 'smoke', complete: async request => {
      calls.push(request)
      return { text: 'That window has opinions. (smoke)' }
    } }
    await stage.setDesktopAwarenessEnabled(true)
    let native
    for (let attempt = 0; attempt < 20; attempt++) {
      native = await window.aislingDesktop.readDesktopContext()
      if (native.available) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    for (let attempt = 0; attempt < 40 && !calls.length; attempt++)
      await new Promise(resolve => setTimeout(resolve, 250))
    for (let i = 0; i < 20; i++) await Promise.resolve()
    if (${CANDIDATE_ONLY}) {
      const delivered = stage.autonomous.decisions.filter(d => d.reason === 'output-delivered').at(-1)
      const handledStatus = stage.autonomous.observations.find(o => o.candidateId === delivered?.candidateId)?.status
      await stage.setDesktopAwarenessEnabled(false)
      return {
        nativeAvailable: native?.available,
        kind: stage.lastTurn?.stimulus.kind,
        candidateId: delivered?.candidateId, handledStatus,
        stopped: !(await window.aislingDesktop.readDesktopContext()).enabled,
      }
    }
    await settings.saveConsciousness({
      providerType: 'openai-compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'smoke', model: 'smoke-model', temperature: 1.1,
    })
    // Temperature slider lives on the Consciousness page.
    await router.push('/settings/consciousness')
    let temperature
    for (let attempt = 0; attempt < 50 && !temperature; attempt++) {
      temperature = document.querySelector('.settings-module input[type=range]')?.value
      if (!temperature) await new Promise(resolve => setTimeout(resolve, 50))
    }
    // Desktop Awareness toggle + cooldown live on their own module page.
    await router.push('/settings/desktop-awareness')
    let control
    for (let attempt = 0; attempt < 50 && !control; attempt++) {
      control = document.querySelector('[aria-label="Desktop Awareness cooldown"]')?.closest('.settings-module')
      if (!control) await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!control) throw new Error('Desktop Awareness settings did not render at ' + location.pathname + ': ' + document.body.innerText.slice(0, 300))
    const uiOn = control?.querySelector('.module-toggle input[type=checkbox]')?.checked
    const cooldownSetting = control?.querySelector('[aria-label="Desktop Awareness cooldown"]')?.value
    const shouldInterrupt = stage.autonomous.decisions.findLast(decision => decision.score !== undefined)?.score
    const firstKind = stage.lastTurn?.stimulus.kind
    const hasContextPrompt = calls[0]?.messages.some(message => message.content?.includes('Response candidate'))
    return {
      bridge: typeof window.aislingDesktop.readDesktopContext,
      nodeAccess: typeof window.require,
      initiallyOff,
      nativeAvailable: native?.available,
      app: native?.context?.focus.app,
      uiOn,
      shouldInterrupt,
      firstKind,
      hasContextPrompt,
      callCount: calls.length,
      temperature,
      cooldownSetting,
      persistedOn: settings.config.desktopAwareness.enabled,
    }
  })()`)

  if (CANDIDATE_ONLY) {
    assert.equal(result.nativeAvailable, true, 'Run on an unlocked interactive Windows desktop')
    assert.equal(result.kind, 'autonomous')
    assert.equal(result.handledStatus, 'handled')
    assert.equal(result.stopped, true)
    assert.ok(judgeRequest.state.candidate?.target)
    assert.equal(typeof result.candidateId, 'string')
    console.log(JSON.stringify({ ok: true, scope: 'candidate', ...result }))
    clearTimeout(timeout)
    win.destroy()
    app.exit(0)
    return
  }

  assert.equal(result.bridge, 'function')
  assert.equal(result.nodeAccess, 'undefined')
  assert.equal(result.initiallyOff, true)
  assert.equal(result.nativeAvailable, true, 'Run on an unlocked interactive Windows desktop')
  assert.equal(Boolean(result.app), true)
  assert.equal(result.uiOn, true)
  assert.equal(result.shouldInterrupt, 0.9)
  assert.deepEqual(Object.keys(judgeRequest.state), ['candidate', 'background'])
  assert.equal(typeof judgeRequest.state.candidate.target.app, 'string')
  assert.ok(['foreground', 'media'].includes(judgeRequest.state.candidate.source))
  assert.deepEqual(Object.keys(judgeRequest.questions), ['should_interrupt'])
  assert.equal(judgeRequest.questions.should_interrupt.type, 'noul')
  assert.equal(result.firstKind, 'autonomous')
  assert.equal(result.hasContextPrompt, true)
  assert.equal(result.callCount, 1)
  assert.equal(result.temperature, '1.1')
  assert.equal(result.cooldownSetting, '15')
  assert.equal(result.persistedOn, true)
  // The autonomous reply is also read by the emotion judge (same endpoint, its own request).
  for (let attempt = 0; attempt < 50 && !emotionRequest; attempt++)
    await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(Object.keys(emotionRequest.questions), ['emotion', 'intensity'])
  assert.equal(emotionRequest.state.conversation.at(-1).speaker, 'aisling')

  await new Promise((resolve) => {
    contents.once('did-finish-load', resolve)
    contents.reload()
  })
  const restored = await contents.executeJavaScript(`(async () => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
    const { useStageStore } = await import('/src/stores/stage.ts')
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    const stage = useStageStore()
    const settings = useSettingsStore()
    for (let attempt = 0; attempt < 100 && !stage.autonomous.enabled; attempt++)
      await new Promise(resolve => setTimeout(resolve, 50))
    const restored = stage.autonomous.enabled && settings.config.desktopAwareness.enabled
    const temperature = settings.config.consciousness.temperature
    const cooldownSeconds = settings.config.desktopAwareness.cooldownSeconds
    await stage.setDesktopAwarenessEnabled(false)
    await router.push('/settings/consciousness')
    await new Promise(resolve => setTimeout(resolve, 100))
    document.querySelector('.desktop-awareness')?.scrollIntoView({ block: 'start' })
    await new Promise(resolve => setTimeout(resolve, 100))
    return {
      restored,
      temperature,
      cooldownSeconds,
      stopped: !(await window.aislingDesktop.readDesktopContext()).enabled,
      persistedOff: !settings.config.desktopAwareness.enabled,
    }
  })()`)
  assert.equal(restored.restored, true)
  assert.equal(restored.temperature, 1.1)
  assert.equal(restored.cooldownSeconds, 15)
  assert.equal(restored.stopped, true)
  assert.equal(restored.persistedOff, true)

  const screenshot = path.join(app.getPath('userData'), 'stage-smoke.png')
  writeFileSync(screenshot, (await contents.capturePage()).toPNG())
  console.log(JSON.stringify({ ok: true, ...result, restored }))
  console.log(`Screenshot: ${screenshot}`)
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
})().catch((error) => {
  console.error(error)
  clearTimeout(timeout)
  app.exit(1)
})
