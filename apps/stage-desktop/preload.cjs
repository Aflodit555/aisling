const { contextBridge, ipcRenderer } = require('electron')

// Expose a fixed, narrow surface — never raw IPC or Node primitives. Desktop
// awareness accepts its toggle and a snapshot-bound response candidate; `storage` is a minimal `localStorage`-shaped
// bridge (get/set only) so the renderer can keep its existing persistence while
// Electron owns a single stable data file in userData.
contextBridge.exposeInMainWorld('aislingDesktop', {
  getMode: () => ipcRenderer.invoke('aisling:mode:get'),
  setLanguage: language => ipcRenderer.send('aisling:language:set', language),
  openDesktopMenu: () => ipcRenderer.send('aisling:desktop-menu'),
  resizeDesktop: (width, height) => ipcRenderer.send('aisling:desktop-size', width, height),
  setDragging: enabled => ipcRenderer.send('aisling:desktop-drag', enabled),
  onCursor: callback => {
    const listener = (_event, x, y) => callback(x, y)
    ipcRenderer.on('aisling:cursor', listener)
    return () => ipcRenderer.removeListener('aisling:cursor', listener)
  },
  onDesktopPointer: callback => {
    const listener = (_event, kind) => callback(kind)
    ipcRenderer.on('aisling:desktop-pointer', listener)
    return () => ipcRenderer.removeListener('aisling:desktop-pointer', listener)
  },
  onModeChange: callback => {
    const listener = (_event, mode) => callback(mode)
    ipcRenderer.on('aisling:mode', listener)
    return () => ipcRenderer.removeListener('aisling:mode', listener)
  },
  setDesktopAwareness: enabled => ipcRenderer.invoke('aisling:desktop-awareness:set', enabled),
  readDesktopContext: () => ipcRenderer.invoke('aisling:desktop-awareness:read'),
  judgeDesktopContext: request => ipcRenderer.invoke('aisling:desktop-awareness:judge', request),
  desktopDiagnostics: {
    enabled: process.argv.includes('--aisling-desktop-diagnostics'),
    replyText: process.argv.includes('--aisling-desktop-diagnostics-reply-text'),
  },
  recordDesktopDiagnostic: record => {
    if (process.argv.includes('--aisling-desktop-diagnostics'))
      ipcRenderer.send('aisling:desktop-awareness:diagnostic', record)
  },
  judgeEmotion: conversation => ipcRenderer.invoke('aisling:emotion:judge', conversation),
  reflectionStorage: {
    read: () => ipcRenderer.sendSync('aisling:reflections:read'),
    write: value => ipcRenderer.sendSync('aisling:reflections:write', value),
  },
  storage: {
    getItem: key => ipcRenderer.sendSync('aisling:storage:get', key),
    setItem: (key, value) => ipcRenderer.sendSync('aisling:storage:set', key, value),
  },
})
