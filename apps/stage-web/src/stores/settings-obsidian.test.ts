import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'

afterEach(() => vi.unstubAllGlobals())
it('persists mirror path and toggle, restores them, and leaves Formation and Recall off', async () => {
  const data = new Map<string,string>()
  const configure = vi.fn(async () => ({running:true,error:''}))
  let fail = false
  vi.stubGlobal('window', { localStorage: {
    getItem: (key:string) => data.get(key) ?? null,
    setItem: (key:string,value:string) => { if(fail) throw new Error('storage failed'); data.set(key,value) },
  }, aislingDesktop: { obsidianMirror: {configure} } })
  setActivePinia(createPinia())
  const settings = useSettingsStore(); await settings.load()
  await settings.saveObsidianMirror({enabled:true,vault:' D:\\Vault with spaces '})
  expect(configure).toHaveBeenCalledOnce()
  expect(settings.config.memory.formationEnabled).toBe(false)
  expect(settings.config.memory.noteRecallEnabled).not.toBe(true)
  setActivePinia(createPinia())
  const restored = useSettingsStore(); await restored.load()
  expect(restored.config.memory.obsidianMirror).toEqual({enabled:true,vault:'D:\\Vault with spaces'})
  await restored.saveObsidianMirror({enabled:false,vault:'D:\\Another'})
  expect(configure).toHaveBeenCalledTimes(2)
  fail = true
  await expect(restored.saveObsidianMirror({enabled:true,vault:'D:\\Unsaved'})).rejects.toThrow()
  expect(restored.config.memory.obsidianMirror).toEqual({enabled:false,vault:'D:\\Another'})
  expect(configure).toHaveBeenCalledTimes(2)
})
