import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCompletionRequest } from '@aisling/core'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import type { DesktopObservation } from '../runtime/autonomous'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}

describe('Stage autonomous integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      aislingDesktop: { readActivity: vi.fn(async () => ({ activity: { app: 'Code', title: 'main.ts' }, idleSeconds: Date.now() / 1000, available: true })) },
    })
    setActivePinia(createPinia())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it.each([true, false])('writes assistant-only UI and persistence, using existing speech when enabled=%s', async (speechEnabled) => {
    const settings = useSettingsStore()
    await settings.load()
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'Working on main.ts? Take your time.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const synthesize = vi.fn(async () => ({ spoken: true }))
    settings.activeSpeechProvider = speechEnabled ? { id: 'test-speech', synthesize } : undefined
    const stage = useStageStore()
    stage.setAutonomousEnabled(true)
    vi.setSystemTime(90_000)
    await stage.tickAutonomous()
    await settle()
    expect(stage.messages).toEqual([{ role: 'assistant', content: 'Working on main.ts? Take your time.' }])
    expect(stage.runtime.history).toEqual(stage.messages)
    expect(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages).toEqual(stage.messages)
    expect(synthesize).toHaveBeenCalledTimes(speechEnabled ? 1 : 0)
    expect(stage.lastTurn!.stimulus.kind).toBe('autonomous')
    expect(stage.sending).toBe(false)
    vi.setSystemTime(95_000)
    await stage.tickAutonomous()
    expect(complete).toHaveBeenCalledOnce()
    expect(stage.autonomous.silenceSeconds).toBe(95)

    stage.send('Hello')
    await settle()
    expect(stage.autonomous.silenceSeconds).toBe(0)
    expect(stage.messages.at(-2)).toEqual({ role: 'user', content: 'Hello' })
    expect(complete).toHaveBeenCalledTimes(2)
    stage.setAutonomousEnabled(false)
    vi.setSystemTime(900_000)
    await stage.tickAutonomous()
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a user turn finish during a pending desktop read, then cancels the autonomous turn', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const complete = vi.fn(async () => ({ text: 'Hi!' }))
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    stage.setAutonomousEnabled(true)
    vi.setSystemTime(90_000)
    let resolve!: (result: DesktopObservation) => void
    vi.mocked(window.aislingDesktop!.readActivity).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = stage.tickAutonomous()
    expect(stage.sending).toBe(false)
    stage.send('User first')
    await settle()
    resolve({ activity: { app: 'Code' }, idleSeconds: 90, available: true })
    await pending
    expect(complete).toHaveBeenCalledOnce()
    expect(stage.lastTurn!.stimulus.kind).toBe('user-text')
    expect(stage.messages.map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('keeps an autonomous response in its originating session during generation', async () => {
    const settings = useSettingsStore()
    await settings.load()
    let resolve!: (result: { text: string }) => void
    settings.activeChatProvider = { id: 'test', complete: () => new Promise(r => { resolve = r }) }
    const stage = useStageStore()
    const originId = stage.activeSessionId
    stage.newConversation()
    const otherId = stage.activeSessionId
    stage.switchSession(originId)
    stage.setAutonomousEnabled(true)
    vi.setSystemTime(90_000)
    await stage.tickAutonomous()
    stage.switchSession(otherId)
    stage.newConversation()
    stage.deleteSession(originId)
    expect(stage.activeSessionId).toBe(originId)
    resolve({ text: 'A quiet moment.' })
    await settle()
    expect(createLocalStorageConversationStore().get(originId)!.messages).toEqual([{ role: 'assistant', content: 'A quiet moment.' }])
    expect(createLocalStorageConversationStore().get(otherId)!.messages).toEqual([])
    stage.switchSession(otherId)
    expect(stage.messages).toEqual([])
  })

  it('applies cooldown on provider failure and suppresses empty outputs', async () => {
    const settings = useSettingsStore()
    await settings.load()
    const complete = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ text: '' })
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    stage.setAutonomousEnabled(true)
    vi.setSystemTime(90_000)
    await stage.tickAutonomous()
    await settle()
    vi.setSystemTime(100_000)
    await stage.tickAutonomous()
    expect(complete).toHaveBeenCalledOnce()
    expect(stage.messages).toEqual([{ role: 'error', content: 'offline' }])
    vi.setSystemTime(270_000)
    await stage.tickAutonomous()
    await settle()
    expect(complete).toHaveBeenCalledTimes(2)
    expect(stage.messages).toHaveLength(1)
    expect(stage.runtime.history).toEqual([])
  })

  it('recovers when the desktop bridge appears after store initialization', async () => {
    window.aislingDesktop = undefined
    setActivePinia(createPinia())
    const stage = useStageStore()
    expect(stage.desktopBridgeState).toBe('unavailable')
    expect(stage.desktopAvailable).toBe(false)
    stage.setAutonomousEnabled(true)
    expect(stage.autonomous.enabled).toBe(false)

    window.aislingDesktop = {
      readActivity: vi.fn(async () => ({ activity: { app: 'Code', title: 'late bridge' }, idleSeconds: 0, available: true })),
    }
    expect(stage.refreshDesktopBridgeStatus()).toBe(true)
    expect(stage.desktopBridgeState).toBe('connected')
    expect(stage.desktopAvailable).toBe(true)
    stage.setAutonomousEnabled(true)
    expect(stage.autonomous.enabled).toBe(true)
    stage.setAutonomousEnabled(false)
    expect(stage.autonomous.enabled).toBe(false)
  })

  it('disables autonomous speaking if the bridge disappears', () => {
    const stage = useStageStore()
    stage.setAutonomousEnabled(true)
    expect(stage.autonomous.enabled).toBe(true)
    window.aislingDesktop = undefined
    stage.refreshDesktopBridgeStatus()
    expect(stage.desktopBridgeState).toBe('unavailable')
    expect(stage.autonomous.enabled).toBe(false)
  })
})
