const { contextBridge, ipcRenderer } = require('electron')

// Expose a fixed, narrow surface — never raw IPC or Node primitives. Desktop
// awareness is three argument-free/boolean operations; `storage` is a minimal `localStorage`-shaped
// bridge (get/set only) so the renderer can keep its existing persistence while
// Electron owns a single stable data file in userData.
contextBridge.exposeInMainWorld('aislingDesktop', {
  setDesktopAwareness: enabled => ipcRenderer.invoke('aisling:desktop-awareness:set', enabled),
  readDesktopContext: () => ipcRenderer.invoke('aisling:desktop-awareness:read'),
  judgeDesktopContext: () => ipcRenderer.invoke('aisling:desktop-awareness:judge'),
  storage: {
    getItem: key => ipcRenderer.sendSync('aisling:storage:get', key),
    setItem: (key, value) => ipcRenderer.sendSync('aisling:storage:set', key, value),
  },
})
