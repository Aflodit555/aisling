import type { ChatCompletionRequest, DesktopActivitySnapshot } from '@aisling/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'

const context: DesktopActivitySnapshot = {
  idleSeconds: 1,
  focus: { app: 'Code', title: 'main.ts', text: 'const answer = 42' },
  media: [], mic: [], headphones: '',
}

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}

describe('Stage desktop awareness integration', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    let enabled = false
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      aislingDesktop: {
        setDesktopAwareness: vi.fn(async (next: boolean) => ({ enabled: enabled = next, available: false })),
        readDesktopContext: vi.fn(async () => ({ enabled, available: enabled, context: enabled ? context : undefined })),
        judgeDesktopContext: vi.fn(async () => ({
          context, scores: { shouldInterrupt: 0.9 },
        })),
      },
    })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([true, false])('reuses chat, conversation, and speech when speech enabled=%s', async (speechEnabled) => {
    const settings = useSettingsStore()
    await settings.load()
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'That answer looks suspiciously tidy.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const synthesize = vi.fn(async () => ({ spoken: true }))
    settings.activeSpeechProvider = speechEnabled ? { id: 'test-speech', synthesize } : undefined
    const stage = useStageStore()

    await stage.setDesktopAwarenessEnabled(true)
    await stage.tickAutonomous()
    await settle()

    expect(stage.messages).toEqual([{ role: 'assistant', content: 'That answer looks suspiciously tidy.' }])
    expect(stage.runtime.history).toEqual(stage.messages)
    expect(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages).toEqual(stage.messages)
    expect(synthesize).toHaveBeenCalledTimes(speechEnabled ? 1 : 0)
    expect(settings.config.desktopAwareness.enabled).toBe(true)
    expect(stage.lastTurn!.stimulus.kind).toBe('autonomous')
    expect(complete.mock.calls[0]![0].messages.at(-1)!.content).toContain('const answer = 42')
  })

  it('stops immediately and invalidates an in-flight judge', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const complete = vi.fn(async () => ({ text: 'Too late.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    await stage.setDesktopAwarenessEnabled(true)

    let resolve!: () => void
    vi.mocked(window.aislingDesktop!.judgeDesktopContext).mockImplementationOnce(() => new Promise(done => {
      resolve = () => done({ context, scores: { shouldInterrupt: 1 } })
    }))
    const pending = stage.tickAutonomous()
    await vi.waitFor(() => expect(window.aislingDesktop!.judgeDesktopContext).toHaveBeenCalled())
    const stopping = stage.setDesktopAwarenessEnabled(false)
    expect(stage.autonomous.enabled).toBe(false)
    resolve()
    await Promise.all([pending, stopping])

    expect(complete).not.toHaveBeenCalled()
    expect(window.aislingDesktop!.setDesktopAwareness).toHaveBeenLastCalledWith(false)
    expect(settings.config.desktopAwareness.enabled).toBe(false)
  })

  it('stays unavailable in browser-only mode without collecting', async () => {
    window.aislingDesktop = undefined
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    await settings.load()
    const stage = useStageStore()
    await stage.setDesktopAwarenessEnabled(true)
    await stage.tickAutonomous()
    expect(stage.desktopBridgeState).toBe('unavailable')
    expect(stage.autonomous.enabled).toBe(false)
    expect(stage.autonomous.error).toContain('Electron')
  })
})
