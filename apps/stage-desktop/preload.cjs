const { contextBridge, ipcRenderer } = require('electron')

// Expose a fixed, narrow surface — never raw IPC or Node primitives. Desktop
// awareness is three argument-free/boolean operations; `storage` is a minimal `localStorage`-shaped
// bridge (get/set only) so the renderer can keep its existing persistence while
// Electron owns a single stable data file in userData.
contextBridge.exposeInMainWorld('aislingDesktop', {
  getMode: () => ipcRenderer.invoke('aisling:mode:get'),
  returnToStage: () => ipcRenderer.invoke('aisling:mode:return'),
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
  judgeDesktopContext: () => ipcRenderer.invoke('aisling:desktop-awareness:judge'),
  testDesktopAwareness: apiKey => ipcRenderer.invoke('aisling:desktop-awareness:test', apiKey),
  judgeEmotion: conversation => ipcRenderer.invoke('aisling:emotion:judge', conversation),
  storage: {
    getItem: key => ipcRenderer.sendSync('aisling:storage:get', key),
    setItem: (key, value) => ipcRenderer.sendSync('aisling:storage:set', key, value),
  },
})
