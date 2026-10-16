const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const vm = require('node:vm')

function fixture({ fetchImpl = async () => { throw new Error('Unexpected upstream request') }, WebSocketImpl } = {}) {
  let handler, assetRequests = 0
  const context = { Response, URL, Buffer, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: fetchImpl, __dirname, module: { exports: {} }, require: name => {
      if (name === 'electron') return { protocol: { handle: (_scheme, next) => { handler = next } },
        net: { fetch: async () => { assetRequests++; return new Response('<html>Stage shell</html>') } } }
      if (name === '../stage-web/relay/alibaba-tts.cjs') {
        const relay = { ...context, module: { exports: {} }, require: dependency => dependency === 'ws' ? WebSocketImpl : require(dependency) }
        vm.runInNewContext(readFileSync(path.join(__dirname, '../stage-web/relay/alibaba-tts.cjs'), 'utf8'), relay)
        return relay.module.exports
      }
      return require(name)
    } }
  vm.runInNewContext(readFileSync(path.join(__dirname, 'desktop-protocol.cjs'), 'utf8'), context)
  context.module.exports.registerStageProtocol()
  return { request: request => handler(request), assetRequests: () => assetRequests }
}

const request = body => new Request('aisling://stage/api/relay/alibaba-tts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const config = { text: 'Offline speech check', endpoint: 'https://dashscope.aliyuncs.com/api/v1',
  transport: 'http', model: 'mock', voice: 'mock', apiKey: 'MOCK_ONLY' }

test('production speech route rejects invalid requests instead of returning the Stage HTML', async () => {
  const f = fixture()
  const get = await f.request(new Request('aisling://stage/api/relay/alibaba-tts'))
  assert.equal(get.status, 405)
  const missing = await f.request(request({}))
  assert.equal(missing.status, 400)
  assert.match(missing.headers.get('content-type'), /application\/json/)
  assert.equal(f.assetRequests(), 0)
})

test('production HTTP speech uses the existing authenticated relay and returns audio', async () => {
  const calls = [], audio = Buffer.from('offline WAV bytes')
  const f = fixture({ fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? Response.json({ output: { audio: { url: 'https://audio.aliyuncs.com/test.wav' } } })
      : new Response(audio)
  } })
  const response = await f.request(request(config)), result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.audio.mimeType, 'audio/wav')
  assert.equal(result.audio.base64, audio.toString('base64'))
  assert.equal(calls[0].init.headers.Authorization, 'Bearer MOCK_ONLY')
  assert.equal(calls[0].url, `${config.endpoint}/services/audio/tts/SpeechSynthesizer`)
  assert.equal(f.assetRequests(), 0)
})

test('production speech retains endpoint validation and authentication errors', async () => {
  const f = fixture({ fetchImpl: async () => Response.json({ error: { message: 'Unauthorized' } }, { status: 401 }) })
  const unsafe = await f.request(request({ ...config, endpoint: 'https://localhost/api/v1' }))
  assert.equal(unsafe.status, 400)
  const denied = await f.request(request(config))
  assert.equal(denied.status, 401)
  assert.match((await denied.json()).error, /authentication failed/)
})

test('production realtime speech forwards MP3 bytes and closes the upstream socket', async () => {
  const sockets = []
  class MockSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this); queueMicrotask(() => this.emit('open')) }
    send(raw) {
      const message = JSON.parse(raw)
      if (message.header.action === 'run-task') queueMicrotask(() => this.emit('message', Buffer.from('{"header":{"event":"task-started"}}'), false))
      if (message.header.action === 'finish-task') queueMicrotask(() => {
        this.emit('message', Buffer.from('offline MP3 bytes'), true)
        this.emit('message', Buffer.from('{"header":{"event":"task-finished"}}'), false)
      })
    }
    close() { this.closed = true }
  }
  const f = fixture({ WebSocketImpl: MockSocket })
  const response = await f.request(request({ ...config, transport: 'websocket', stream: true,
    endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.equal(await response.text(), 'offline MP3 bytes')
  assert.equal(sockets[0].options.headers.Authorization, 'Bearer MOCK_ONLY')
  assert.equal(sockets[0].closed, true)
  assert.equal(f.assetRequests(), 0)
})

test('cancelling the production audio body closes an unfinished upstream WebSocket', async () => {
  let socket
  class HeldSocket extends EventEmitter {
    constructor() { super(); socket = this; queueMicrotask(() => this.emit('open')) }
    send() { queueMicrotask(() => this.emit('message', Buffer.from('first audio chunk'), true)) }
    close() { this.closed = true }
  }
  const f = fixture({ WebSocketImpl: HeldSocket })
  const response = await f.request(request({ ...config, transport: 'websocket', stream: true,
    endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference' }))
  await response.body.cancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(socket.closed, true)
})
