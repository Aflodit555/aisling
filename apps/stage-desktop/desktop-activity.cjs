const { execFile } = require('node:child_process')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

/** @typedef {{ activity: { app?: string, title?: string }, available: boolean, error?: string }} ActivityResult */

/** Cached and single-flight: renderer polling cannot launch overlapping processes. */
function createActivityReader() {
  /** @type {ActivityResult} */
  let cached = { activity: {}, available: false }
  let expiresAt = 0
  /** @type {Promise<ActivityResult> | undefined} */
  let pending

  /** @returns {Promise<ActivityResult>} */
  async function sample() {
    if (process.platform !== 'win32')
      return { activity: {}, available: false, error: 'Foreground activity currently supports Windows only.' }
    try {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const { stdout } = await execFileAsync(executable, [
        // A fixed bundled command, with no renderer/user arguments or interpolation.
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', readFileSync(path.join(__dirname, 'foreground.ps1'), 'utf8'),
      ], { windowsHide: true, timeout: 4000, maxBuffer: 16 * 1024, encoding: 'utf8' })
      const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
      const activity = {
        app: typeof data.app === 'string' ? data.app.slice(0, 120) : '',
        title: typeof data.title === 'string' ? data.title.slice(0, 300) : '',
      }
      return { activity, available: Boolean(activity.app || activity.title) }
    }
    catch {
      return { activity: {}, available: false, error: 'Foreground activity unavailable. Check Windows PowerShell permissions.' }
    }
  }

  return async function readActivity() {
    if (pending) return pending
    if (Date.now() < expiresAt) return cached
    pending = sample().then((result) => {
      cached = result
      expiresAt = Date.now() + 5000
      return result
    }).finally(() => { pending = undefined })
    return pending
  }
}

module.exports = { createActivityReader }
