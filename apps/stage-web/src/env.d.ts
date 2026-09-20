/// <reference types="vite/client" />

interface Window {
  aislingDesktop?: {
    readActivity(): Promise<import('./runtime/autonomous').DesktopObservation>
    /** Minimal `localStorage`-shaped bridge backed by Electron userData. */
    storage?: Pick<Storage, 'getItem' | 'setItem'>
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
