import { afterEach, expect, it, vi } from 'vitest'
import 'vue'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('switches UI text immediately and restores the saved language', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const html = { lang: 'en' }
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('document', { documentElement: html })

  const first = await import('./i18n')
  expect(first.t('Settings')).toBe('Settings')
  first.setLanguage('zh-CN')
  expect(first.t('Settings')).toBe('设置')
  expect(html.lang).toBe('zh-CN')
  expect(values.get(first.LANGUAGE_KEY)).toBe('zh-CN')

  vi.resetModules()
  const restored = await import('./i18n')
  expect(restored.language.value).toBe('zh-CN')
  expect(restored.t('Web Search')).toBe('搜索')
})

it('uses the desktop storage bridge for Electron', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const setDesktopLanguage = vi.fn()
  vi.stubGlobal('window', { localStorage: storage, aislingDesktop: { storage, setLanguage: setDesktopLanguage } })
  const { setLanguage, LANGUAGE_KEY } = await import('./i18n')
  setLanguage('zh-CN')
  expect(values.get(LANGUAGE_KEY)).toBe('zh-CN')
  expect(setDesktopLanguage).toHaveBeenCalledWith('zh-CN')
})
