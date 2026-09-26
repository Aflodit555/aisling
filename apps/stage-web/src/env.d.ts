/// <reference types="vite/client" />

interface Window {
  Live2DCubismCore?: unknown
  aislingDesktop?: {
    getMode(): Promise<'stage' | 'desktop'>
    returnToStage(): Promise<void>
    setDragging(enabled: boolean): void
    onCursor(callback: (x: number, y: number) => void): () => void
    onDesktopPointer(callback: (kind: 'character' | 'input' | 'ui' | 'none') => void): () => void
    onModeChange(callback: (mode: 'stage' | 'desktop') => void): () => void
    setDesktopAwareness(enabled: boolean): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    readDesktopContext(): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    judgeDesktopContext(): Promise<import('./runtime/autonomous').DesktopJudgeResult>
    testDesktopAwareness(apiKey: string): Promise<{ ok: boolean; message: string }>
    /** Jev emotion judge over recent turns (+ desktop while Desktop Awareness is on). */
    judgeEmotion?(conversation: import('./stores/emotion').EmotionTurn[]): Promise<{ emotion: string; confidence: number; intensity: number } | null>
    /** Minimal `localStorage`-shaped bridge backed by Electron userData. */
    storage?: Pick<Storage, 'getItem' | 'setItem'>
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
