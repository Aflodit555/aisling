const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const judgeModule = require('./desktop-judge.cjs')

// Exercise the real main/preload code with memory-only filesystem, Electron
// and HTTP substitutes: no native capture, GUI, files or paid model requests.
function fixture(enabled = false, replyText = false) {
  const lines = [], handles = new Map(), listeners = new Map(), requests = []
  let directories = 0, streams = 0, streamError
  const context = { capturedAt: 1000, targetHwnd: '123', sequence: 1,
    focus: { app: 'chrome', title: 'Private article', text: 'Private screen text' },
    media: [], mic: [], idleSeconds: 0 }
  const mainFrame = { url: 'http://localhost:5174' }
  const contents = { mainFrame }
  const image = { resize: () => image }
  const electron = {
    app: { whenReady: async () => {}, on: () => {} },
    Tray: class { setToolTip() {} on() {} },
    nativeImage: { createFromPath: () => image }, nativeTheme: { shouldUseDarkColors: false }, screen: { on: () => {} },
    BaseWindow: class {},
    WebContentsView: class {
      webContents = contents
      setBackgroundColor() { throw new Error('fixture stops before creating a real window') }
    },
    ipcMain: { handle: (name, handler) => handles.set(name, handler), on: (name, handler) => listeners.set(name, handler) },
  }
  const module = { exports: {} }
  const env = { AISLING_DESKTOP_DIAGNOSTICS: enabled ? '1' : '0', AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT: replyText ? '1' : '0' }
  vm.runInNewContext(readFileSync(path.join(__dirname, 'desktop-app.cjs'), 'utf8'), {
    module, __dirname, process: { env }, URL, AbortController,
    console: { log() {}, warn() {} },
    require: name => {
      if (name === 'electron') return electron
      if (name === 'node:fs') return {
        mkdirSync: () => { directories++ },
        createWriteStream: () => { streams++; return { on: (_name, callback) => { streamError = callback }, write: line => lines.push(JSON.parse(line)) } },
      }
      if (name === './desktop-activity.cjs') return { createDesktopObserver: () => ({ status: () => ({ enabled: true, context }) }) }
      if (name === './desktop-protocol.cjs') return { registerStageScheme() {}, registerStageProtocol() {} }
      if (name === './desktop-store.cjs') return { registerStorageIpc() {}, readStoredConfig: () => ({ desktopAwareness: { jevApiKey: 'private-key' } }) }
      if (name === './desktop-judge.cjs') return { ...judgeModule, createTypeSafeJudge: () => judgeModule.createTypeSafeJudge({ fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return new Response(JSON.stringify({ answers: { should_interrupt: { type: 'noul', noul: 0.9 } } }))
      } }) }
      return require(name)
    },
  })
  return { api: module.exports, lines, handles, listeners, requests, context,
    event: { sender: contents, senderFrame: mainFrame }, counters: () => ({ directories, streams }), failStream: () => streamError() }
}

test('diagnostics default off: no ID arguments, directory, stream or file output even with text flag', () => {
  const f = fixture(false, true)
  f.api.writeDesktopDiagnostic({ type: 'delivery', delivered: true, replyText: 'Private reply' })
  assert.deepEqual(Array.from(f.api.desktopDiagnosticArguments()), [])
  assert.deepEqual(f.counters(), { directories: 0, streams: 0 })
  assert.deepEqual(f.lines, [])
})

test('local JSONL strips unapproved fields and reply text unless separately opted in', () => {
  const f = fixture(true)
  f.api.writeDesktopDiagnostic({ type: 'delivery', delivered: true, replyLength: 13, replyText: 'Private reply', prompt: 'Secret prompt', apiKey: 'Secret key' })
  assert.equal(f.lines[0].type, 'diagnostics-started')
  assert.equal(f.lines[0].replyTextEnabled, false)
  assert.deepEqual(f.counters(), { directories: 1, streams: 1 })
  assert.equal(f.lines[1].replyLength, 13)
  assert.equal(f.lines[1].replyText, undefined)
  assert.equal(f.lines[1].prompt, undefined)
  assert.equal(f.lines[1].apiKey, undefined)
  assert.equal(typeof f.lines[1].at, 'number')
  assert.equal(f.lines[1].sessionId, f.lines[0].sessionId)
  const opted = fixture(true, true)
  opted.api.writeDesktopDiagnostic({ type: 'chat-completed', replyText: 'Not delivered' })
  opted.api.writeDesktopDiagnostic({ type: 'delivery', delivered: true, replyText: 'x'.repeat(2001) })
  assert.equal(opted.lines[1].replyText, undefined)
  assert.equal(opted.lines[2].replyText.length, 2000)
  assert.equal(opted.lines[2].replyTextTruncated, true)
})

test('stream failure disables only diagnostic output', () => {
  const f = fixture(true)
  f.api.writeDesktopDiagnostic({ type: 'sample' })
  f.failStream()
  assert.doesNotThrow(() => f.api.writeDesktopDiagnostic({ type: 'gate', reason: 'allowed' }))
  assert.equal(f.lines.length, 2)
})

test('main distinguishes an actual Jev call, validates snapshot first, and keeps model input unchanged', async () => {
  const f = fixture(true)
  await assert.rejects(f.api.startDesktop({ stageUrl: 'http://localhost:5174' }), /fixture stops/)
  const handler = f.handles.get('aisling:desktop-awareness:judge')
  const request = { candidate: { id: 'candidate', objectId: 'object', source: 'foreground', change: 'appeared', target: f.context.focus, snapshot: { capturedAt: 1000, targetHwnd: '123', sequence: 1 } } }
  const diagnostic = { sampleId: '11111111-1111-4111-8111-111111111111', judgmentId: '22222222-2222-4222-8222-222222222222' }
  await handler(f.event, request)
  await handler(f.event, { ...request, diagnostic })
  assert.equal(f.requests.length, 2)
  assert.deepEqual(f.requests[0], f.requests[1])
  assert.equal(JSON.stringify(f.requests).includes('sampleId'), false)
  const calls = f.lines.filter(record => record.type === 'jev-call')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].mode, 'actual-call')
  assert.equal(calls[1].sampleId, diagnostic.sampleId)
  assert.equal(calls[1].judgmentId, diagnostic.judgmentId)
  await assert.rejects(handler(f.event, { ...request, diagnostic, candidate: { ...request.candidate, snapshot: { ...request.candidate.snapshot, sequence: 2 } } }), /snapshot changed/)
  assert.equal(f.requests.length, 2)
  assert.equal(f.lines.filter(record => record.type === 'jev-call').length, 2)
  assert.equal(JSON.stringify(f.lines).includes('private-key'), false)
})

test('sandboxed preload exposes flags and sends diagnostics only when enabled', () => {
  for (const enabled of [false, true]) {
    let bridge
    const sent = []
    vm.runInNewContext(readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
      process: { argv: enabled ? ['--aisling-desktop-diagnostics', '--aisling-desktop-diagnostics-reply-text'] : [] },
      require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } }, ipcRenderer: { send: (...args) => sent.push(args) } }),
    })
    assert.equal(bridge.desktopDiagnostics.enabled, enabled)
    assert.equal(bridge.desktopDiagnostics.replyText, enabled)
    bridge.recordDesktopDiagnostic({ type: 'sample' })
    assert.equal(sent.length, enabled ? 1 : 0)
  }
})
