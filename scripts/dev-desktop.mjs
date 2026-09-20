// Single-command Aisling Desktop launcher.
//
//   pnpm dev:desktop          → start Vite, wait until it is ready, launch Electron
//   pnpm start:desktop        → build stage-web, launch Electron against the built renderer
//
// It owns the child-process lifecycle end to end: it starts the renderer/runtime
// dependency, waits for it (by polling the HTTP endpoint, never a fixed sleep),
// starts Electron, and cleans the renderer process up when Electron exits.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const STAGE_WEB_DIR = join(ROOT, 'apps', 'stage-web')
const STAGE_DESKTOP_DIR = join(ROOT, 'apps', 'stage-desktop')

const DEFAULT_STAGE_URL = 'http://localhost:5174'
const READY_TIMEOUT_MS = 60_000
const PROD = process.argv.includes('--prod')

const stageWebRequire = createRequire(pathToFileURL(join(STAGE_WEB_DIR, 'package.json')))
const stageDesktopRequire = createRequire(pathToFileURL(join(STAGE_DESKTOP_DIR, 'package.json')))

function log(message) {
  console.log(`[desktop-run] ${message}`)
}

/** @type {Array<import('node:child_process').ChildProcess>} */
const children = []
let cleanedUp = false

function fail(message) {
  console.error(`[desktop-run] ${message}`)
  cleanup()
  process.exit(1)
}

function cleanup() {
  if (cleanedUp)
    return
  cleanedUp = true
  for (const child of children)
    killTree(child.pid)
}

/** Kills a process and, on Windows, its whole tree (pnpm/node/electron chains). */
function killTree(pid) {
  if (!pid)
    return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    }
    else {
      try {
        process.kill(-pid, 'SIGTERM')
      }
      catch {
        process.kill(pid, 'SIGTERM')
      }
    }
  }
  catch {
    // Process is already gone; nothing to clean up.
  }
}

/**
 * `vite/bin/vite.js` is not exported by Vite's package "exports" map, so resolve
 * it through the package.json `bin` field instead of require.resolve().
 */
function resolveViteBin() {
  const pkgPath = stageWebRequire.resolve('vite/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vite
  if (!binRel)
    throw new Error('the vite package has no bin entry')
  return join(dirname(pkgPath), binRel)
}

/** `require('electron')` returns the path to the Electron executable. */
function resolveElectronBin() {
  const exe = stageDesktopRequire('electron')
  if (typeof exe !== 'string' || !exe)
    throw new Error('the electron package did not resolve to an executable path')
  return exe
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Polls the Stage dev server instead of guessing with a fixed sleep. */
function probeHttp(url) {
  return new Promise((resolveProbe) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolveProbe(res.statusCode === 200)
    })
    req.on('error', () => resolveProbe(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolveProbe(false)
    })
  })
}

async function waitForVite(vite) {
  log(`waiting for the Stage dev server at ${DEFAULT_STAGE_URL} …`)
  const started = Date.now()
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (vite.exitCode !== null) {
      fail(`the Stage dev server exited early (code ${vite.exitCode}) — see the logs above`)
      return
    }
    if (await probeHttp(DEFAULT_STAGE_URL)) {
      log('Stage dev server is ready')
      return
    }
    await sleep(250)
  }
  fail(`timed out after ${READY_TIMEOUT_MS / 1000}s waiting for ${DEFAULT_STAGE_URL}`)
}

function launchElectron(extraEnv = {}) {
  const electronBin = resolveElectronBin()
  const electron = spawn(electronBin, [STAGE_DESKTOP_DIR], {
    cwd: STAGE_DESKTOP_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  children.push(electron)
  electron.on('error', (error) => {
    fail(`failed to start Electron: ${error.message}`)
  })
  electron.on('exit', (code, signal) => {
    log(`Electron exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    cleanup()
    process.exit(code ?? 0)
  })
  return electron
}

function runDev() {
  const viteBin = resolveViteBin()
  log('starting the Stage dev server (Vite)')
  const vite = spawn(process.execPath, [viteBin], {
    cwd: STAGE_WEB_DIR,
    stdio: 'inherit',
    env: { ...process.env },
    detached: process.platform !== 'win32',
  })
  children.push(vite)
  vite.on('error', (error) => {
    fail(`failed to start Vite: ${error.message}`)
  })

  void waitForVite(vite)
    .then(() => {
      log('launching Electron against the dev server')
      launchElectron({ AISLING_STAGE_URL: DEFAULT_STAGE_URL, AISLING_DEV: '1' })
    })
    .catch((error) => {
      fail(error?.message ?? String(error))
    })
}

function runProd() {
  const viteBin = resolveViteBin()
  log('building the Stage renderer (stage-web)')
  const build = spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: STAGE_WEB_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (build.status !== 0)
    fail(`stage-web build failed (exit ${build.status})`)
  log('launching Electron against the built renderer (aisling://stage)')
  launchElectron({})
}

process.on('SIGINT', () => {
  log('received SIGINT, shutting down')
  cleanup()
  process.exit(0)
})
process.on('SIGTERM', () => {
  log('received SIGTERM, shutting down')
  cleanup()
  process.exit(0)
})

try {
  if (PROD)
    runProd()
  else
    runDev()
}
catch (error) {
  fail(error?.message ?? String(error))
}
