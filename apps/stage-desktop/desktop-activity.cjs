const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

const KERNEL_POLL_SECONDS = '2'

/** Keep the native wire format out of the renderer and cap every text field. */
function normalizeKernelState(value) {
  const state = value && typeof value === 'object' ? value : {}
  const focus = state.focus && typeof state.focus === 'object' ? state.focus : {}
  const text = (input, cap) => typeof input === 'string' ? input.slice(0, cap) : ''
  const list = (input, cap = 12) => Array.isArray(input) ? input.slice(0, cap) : []
  return {
    idleSeconds: Number.isFinite(state.idle_s) && state.idle_s >= 0 ? state.idle_s : 0,
    focus: {
      app: text(focus.app, 120),
      title: text(focus.title, 300),
      text: text(focus.text, 2000),
    },
    media: list(state.media).map(item => ({
      app: text(item?.app, 120),
      title: text(item?.title, 300),
      artist: text(item?.artist, 200),
    })),
    mic: list(state.mic).map(item => text(item, 120)).filter(Boolean),
    headphones: text(state.headphones, 200),
  }
}

function createDesktopObserver(options = {}) {
  const executable = options.executable ?? path.join(__dirname, '..', '..', 'external', 'kernel_c', 'build', 'Release', 'kernel.exe')
  const spawnImpl = options.spawnImpl ?? spawn
  let child
  let lines
  let latest
  let error = ''
  let stopping = false

  function start() {
    if (child)
      return status()
    stopping = false
    error = ''
    latest = undefined
    try {
      child = spawnImpl(executable, [KERNEL_POLL_SECONDS], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      lines = readline.createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          latest = normalizeKernelState(JSON.parse(line))
          error = ''
        }
        catch {
          error = 'Desktop observer returned invalid data.'
        }
      })
      child.once('error', () => { error = 'Desktop observer unavailable.' })
      child.once('exit', (code) => {
        lines?.close()
        lines = undefined
        child = undefined
        if (!stopping)
          error = `Desktop observer stopped unexpectedly${code === null ? '.' : ` (exit ${code}).`}`
      })
    }
    catch {
      child = undefined
      error = 'Desktop observer unavailable.'
    }
    return status()
  }

  function stop() {
    stopping = true
    lines?.close()
    lines = undefined
    if (child) {
      child.kill()
      child = undefined
    }
    latest = undefined
    error = ''
    return status()
  }

  function status() {
    return { enabled: Boolean(child), available: Boolean(latest), context: latest, error }
  }

  return { start, stop, status }
}

module.exports = { createDesktopObserver, normalizeKernelState }
