import type { ChatCompletionResult } from '@aisling/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'

import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'
import { useSpeechStore } from './speech'

afterEach(() => vi.unstubAllGlobals())

it('updates one visible reply before completion and persists it once', async () => {
  const storage = new Map<string, string>()
  const deliveryOrder: string[] = []
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.includes('早上好')) deliveryOrder.push('persist-output')
        storage.set(key, value)
      },
    },
  })
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  await settings.load()
  const speak = vi.spyOn(useSpeechStore(), 'speak').mockImplementation(async () => { deliveryOrder.push('speech') })
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
  expect(speak).not.toHaveBeenCalled()
  finish({ text: '早上好' })
  await vi.waitFor(() => expect(stage.sending).toBe(false))
  expect(stage.messages).toEqual([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '早上好' },
  ])
  expect(stage.runtime.history.map(({ role, content }) => ({ role, content }))).toEqual(stage.messages)
  expect(deliveryOrder).toEqual(['speech', 'persist-output'])
  expect(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages).toEqual(stage.runtime.history)
})
