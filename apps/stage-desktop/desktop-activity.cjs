const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

const KERNEL_POLL_SECONDS = '2'
const REQUEST_TIMEOUT_MS = 5000

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
  // The kernel ignores this pid's windows: clicking Aisling must never replace
  // the latest real foreground target.
  const ownPid = String(options.ownPid ?? process.pid)
  let child
  let lines
  let latest
  let error = ''
  let stopping = false
  /** @type {{ resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout } | undefined} */
  let waiter

  function settle(line) {
    try {
      latest = normalizeKernelState(JSON.parse(line))
      error = ''
    }
    catch {
      error = 'Desktop observer returned invalid data.'
    }
    if (waiter) {
      const w = waiter
      waiter = undefined
      clearTimeout(w.timer)
      w.resolve(latest)
    }
  }

  function start() {
    if (child)
      return status()
    stopping = false
    error = ''
    latest = undefined
    try {
      child = spawnImpl(executable, [KERNEL_POLL_SECONDS, ownPid], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'], // stdin piped so the parent can ask for an on-demand snapshot
      })
      lines = readline.createInterface({ input: child.stdout })
      lines.on('line', settle)
      child.once('error', () => { error = 'Desktop observer unavailable.' })
      child.once('exit', (code) => {
        lines?.close()
        lines = undefined
        child = undefined
        if (waiter) {
          const w = waiter
          waiter = undefined
          clearTimeout(w.timer)
          w.reject(new Error('Desktop observer stopped unexpectedly.'))
        }
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
    if (waiter) {
      const w = waiter
      waiter = undefined
      clearTimeout(w.timer)
      w.reject(new Error('Desktop observer stopped.'))
    }
    return status()
  }

  /**
   * Asks the long-running kernel for an immediate snapshot (one stdin line) and
   * resolves with the next normalized context. The kernel keeps the latest real
   * foreground window cached via its foreground hook, so this reads the current
   * target instead of waiting for the fallback timer.
   */
  function request() {
    return new Promise((resolve, reject) => {
      if (!child || !child.stdin || child.stdin.destroyed) {
        reject(new Error('Desktop observer is not running.'))
        return
      }
      if (waiter) {
        reject(new Error('A desktop snapshot request is already in flight.'))
        return
      }
      waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          waiter = undefined
          reject(new Error('Desktop observer request timed out.'))
        }, REQUEST_TIMEOUT_MS),
      }
      child.stdin.write('\n')
    })
  }

  function status() {
    return { enabled: Boolean(child), available: Boolean(latest), context: latest, error }
  }

  return { start, stop, status, request }
}

module.exports = { createDesktopObserver, normalizeKernelState }
