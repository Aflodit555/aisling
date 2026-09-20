const { contextBridge, ipcRenderer } = require('electron')

// Expose a fixed, narrow surface — never raw IPC or Node primitives. `readActivity`
// is a single argument-free operation; `storage` is a minimal `localStorage`-shaped
// bridge (get/set only) so the renderer can keep its existing persistence while
// Electron owns a single stable data file in userData.
contextBridge.exposeInMainWorld('aislingDesktop', {
  readActivity: () => ipcRenderer.invoke('aisling:desktop-activity'),
  storage: {
    getItem: key => ipcRenderer.sendSync('aisling:storage:get', key),
    setItem: (key, value) => ipcRenderer.sendSync('aisling:storage:set', key, value),
  },
})
