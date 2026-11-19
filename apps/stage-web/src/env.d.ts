/// <reference types="vite/client" />

interface Window {
  Live2DCubismCore?: unknown
  aislingDesktop?: {
    obsidianMirror?: {
      configure(): Promise<{running: boolean; error: string}>
      status(): Promise<{running: boolean; error: string}>
      open(): Promise<{error: string}>
    }
    noteFormation?: import('./runtime/note-formation').NoteFormationBridge
    noteRecall?: import('./runtime/note-v2-recall').NoteV2RecallBridge
    noteReview?: {
      list(): Promise<{ ready: boolean; pending: number; forming: boolean; failed: boolean; embeddingConfigured?: boolean;
        formation?: import('./runtime/note-formation').FormationStatus
        unavailable?: import('../../stage-desktop/note-formation-errors.mjs').FormationFailure
        items: Array<{
        key: string; action: string; content: string; kind: string; basis: string; uncertainty?: string;
        reason: string; target?: string; quotes: string[]; approvable: boolean;
      }> }>
      decide(key: string, approved: boolean): Promise<string>
      retry(id: string, attempt: number): Promise<string>
    }
    getMode(): Promise<'stage' | 'desktop'>
    setLanguage?(language: 'en' | 'zh-CN'): void
    openDesktopMenu(): void
    resizeDesktop(width: number, height: number): void
    setDragging(enabled: boolean): void
    onCursor(callback: (x: number, y: number) => void): () => void
    onDesktopPointer(callback: (kind: 'character' | 'input' | 'ui' | 'none') => void): () => void
    onModeChange(callback: (mode: 'stage' | 'desktop') => void): () => void
    setDesktopAwareness(enabled: boolean): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    readDesktopContext(): Promise<import('./runtime/autonomous').DesktopObserverStatus>
    judgeDesktopContext(request: import('./runtime/autonomous').DesktopJudgeRequest): Promise<import('./runtime/autonomous').DesktopJudgeResult>
    desktopDiagnostics?: { enabled: boolean; replyText: boolean }
    recordDesktopDiagnostic?(record: import('./runtime/autonomous').DesktopDiagnosticRecord): void
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
