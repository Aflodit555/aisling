/// <reference types="vite/client" />

interface Window {
  Live2DCubismCore?: unknown
  aislingDesktop?: {
    setDesktopAwareness(enabled: boolean): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    readDesktopContext(): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    judgeDesktopContext(): Promise<import('./runtime/autonomous').DesktopJudgeResult>
    testDesktopAwareness(apiKey: string): Promise<{ ok: boolean; message: string }>
    /** Minimal `localStorage`-shaped bridge backed by Electron userData. */
    storage?: Pick<Storage, 'getItem' | 'setItem'>
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
