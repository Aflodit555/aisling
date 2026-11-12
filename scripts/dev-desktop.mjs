// Single-command Aisling Desktop launcher.
//
//   pnpm dev:desktop          → start Vite, wait until it is ready, launch Electron
//   pnpm start:desktop        → build stage-web, launch Electron against the built renderer
//
// It owns the child-process lifecycle end to end: it starts the renderer/runtime
// dependency, waits for the Vite child to report its listening address,
// starts Electron, and cleans the renderer process up when Electron exits.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const STAGE_WEB_DIR = join(ROOT, 'apps', 'stage-web')
const STAGE_DESKTOP_DIR = join(ROOT, 'apps', 'stage-desktop')

const DEFAULT_STAGE_URL = 'http://localhost:5174'
const READY_TIMEOUT_MS = 60_000
const DEV_RESTART_EXIT = 75
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

function waitForVite(vite) {
  log(`waiting for the Stage dev server at ${DEFAULT_STAGE_URL} …`)
  return new Promise((ready, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Vite did not listen at ${DEFAULT_STAGE_URL}`)), READY_TIMEOUT_MS)
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-4096)
      const local = /(?:^|\s)Local:\s+(\S+)/.exec(stripVTControlCharacters(output))
      if (local?.[1] !== DEFAULT_STAGE_URL + '/') return
      clearTimeout(timeout)
      vite.stdout.off('data', onData)
      ready()
    }
    vite.stdout.on('data', onData)
  })
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
    children.splice(children.indexOf(electron), 1)
    if (!cleanedUp && extraEnv.AISLING_DEV === '1' && code === DEV_RESTART_EXIT) {
      launchElectron(extraEnv)
      return
    }
    cleanup()
    process.exit(code ?? 0)
  })
  return electron
}

function runDev() {
  const viteBin = resolveViteBin()
  log('starting the Stage dev server (Vite)')
  const vite = spawn(process.execPath, [viteBin, '--host', 'localhost', '--port', '5174', '--strictPort'], {
    cwd: STAGE_WEB_DIR,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env },
    detached: process.platform !== 'win32',
  })
  children.push(vite)
  vite.stdout.pipe(process.stdout, { end: false })
  vite.on('error', (error) => {
    fail(`failed to start Vite: ${error.message}`)
  })
  vite.on('exit', code => {
    if (!cleanedUp) fail(`the Stage dev server exited (code ${code})`)
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
  launchElectron({ AISLING_STAGE_URL: '', AISLING_DEV: '' })
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
