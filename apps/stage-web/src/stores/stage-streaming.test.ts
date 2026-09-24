import type { ChatCompletionResult } from '@aisling/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'

import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'

afterEach(() => vi.unstubAllGlobals())

it('updates one visible reply before completion and persists it once', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  await settings.load()
  let finish!: (result: { text: string }) => void
  settings.activeChatProvider = {
    id: 'stream-test',
    complete: vi.fn(async () => ({ text: 'unused' })),
    stream: vi.fn((_request, onText) => {
      onText('早')
      onText('早上')
      return new Promise<ChatCompletionResult>(resolve => { finish = resolve })
    }),
  }

  const stage = useStageStore()
  stage.send('你好')
  expect(stage.messages).toEqual([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '早上' },
  ])
  expect(stage.runtime.history).toEqual([])
  finish({ text: '早上好' })
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(stage.messages).toEqual([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '早上好' },
  ])
  expect(stage.runtime.history).toEqual(stage.messages)
  expect(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages).toEqual(stage.messages)
})
