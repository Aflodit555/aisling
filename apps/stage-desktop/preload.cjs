const { contextBridge, ipcRenderer } = require('electron')
const noteV2 = process.argv.includes('--aisling-note-v2')

// Expose a fixed, narrow surface — never raw IPC or Node primitives. Desktop
// awareness accepts its toggle and a snapshot-bound response candidate; `storage` is a minimal `localStorage`-shaped
// bridge (get/set only) so the renderer can keep its existing persistence while
// Electron owns a single stable data file in userData.
contextBridge.exposeInMainWorld('aislingDesktop', {
  ...(process.argv.includes('--aisling-memory-migration') ? { memoryMigration: {
    status: () => ipcRenderer.invoke('aisling:memory-migration:status'),
    preflight: () => ipcRenderer.invoke('aisling:memory-migration:preflight'),
    execute: () => ipcRenderer.invoke('aisling:memory-migration:execute'),
    exclude: (key, version) => ipcRenderer.invoke('aisling:memory-migration:exclude', key, version),
  } } : {}),
  ...(noteV2 ? {
    noteRecall: {
      snapshot: () => ipcRenderer.invoke('aisling:note-recall:snapshot'),
      current: version => ipcRenderer.invoke('aisling:note-recall:current', version),
    },
    noteReview: {
      list: () => ipcRenderer.invoke('aisling:note-review:list'),
      decide: (key, approved) => ipcRenderer.invoke('aisling:note-review:decide', key, approved),
    },
    noteFormation: {
      delivered: (sessionId, indices) => ipcRenderer.invoke('aisling:note-formation:delivered', sessionId, indices),
      flush: sessionId => ipcRenderer.invoke('aisling:note-formation:flush', sessionId),
      next: () => ipcRenderer.invoke('aisling:note-formation:next'),
      prepare: (id, attempt, history) => ipcRenderer.invoke('aisling:note-formation:prepare', id, attempt, history),
      submit: (id, attempt, raw) => ipcRenderer.invoke('aisling:note-formation:submit', id, attempt, raw),
      fail: (id, attempt, reason) => ipcRenderer.invoke('aisling:note-formation:fail', id, attempt, reason),
    },
  } : { memoryOrganization: {
    recallHeads: () => ipcRenderer.invoke('aisling:memory:recall-heads'),
    onStatus: callback => {const listener=(_event,state)=>callback(state);ipcRenderer.on('aisling:organization:status',listener);return()=>ipcRenderer.removeListener('aisling:organization:status',listener)},
    setEnabled: enabled => ipcRenderer.invoke('aisling:organization:enabled',enabled),
    candidates: () => ipcRenderer.invoke('aisling:organization:candidates'),
    settle: (batchId,index) => ipcRenderer.invoke('aisling:organization:settle',batchId,index),
  } }),
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
  ...(!noteV2 ? { reflectionStorage: {
    read: () => ipcRenderer.sendSync('aisling:reflections:read'),
    write: value => ipcRenderer.sendSync('aisling:reflections:write', value),
  } } : {}),
  storage: {
    getItem: key => {const value=ipcRenderer.sendSync('aisling:storage:get',key);if(value?.storageError)throw new Error('Memory storage unavailable');return value},
    setItem: (key, value) => ipcRenderer.sendSync('aisling:storage:set', key, value),
  },
})
