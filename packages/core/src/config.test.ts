import { describe, expect, it } from 'vitest'

import { createDefaultPlatformConfig, createMemoryConfigStore, validateAlibabaTtsEndpoint } from './config'

describe('config store', () => {
  it('starts with the default platform config', async () => {
    const store = createMemoryConfigStore()
    expect(await store.get()).toEqual(createDefaultPlatformConfig())
    expect((await store.get()).desktopAwareness).toEqual({ enabled: false, cooldownSeconds: 30, jevApiKey: '' })
  })

  it('persists a full platform config', async () => {
    const store = createMemoryConfigStore()
    const next = {
      consciousness: { providerType: 'openai-compatible', baseUrl: 'https://x/v1', apiKey: 'ck', model: 'm', temperature: 1.1 },
      desktopAwareness: { enabled: true, cooldownSeconds: 15, jevApiKey: '' },
      speech: { enabled: true, providerType: 'alibaba', apiKey: 'sk', model: 'qwen-audio-3.0-tts-flash', voice: 'longanhuan_v3.6', transport: 'websocket', endpoint: 'wss://x.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference' },
      vision: { enabled: true, providerType: 'openai-compatible', baseUrl: 'https://x/v1', apiKey: 'vk', model: 'gpt-4o-mini' },
      webSearch: { enabled: true, providerType: 'duckduckgo' },
    } as const

    await store.set(next)
    expect(await store.get()).toEqual(next)
  })
})
describe('alibaba TTS endpoint validation', () => {
  it('accepts the official realtime WebSocket endpoint contract', () => {
    expect(validateAlibabaTtsEndpoint('wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference', 'websocket')).toBeUndefined()
  })

  it('keeps WebSocket and HTTP endpoint contracts distinct', () => {
    expect(validateAlibabaTtsEndpoint('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1', 'websocket')).toContain('wss://')
    expect(validateAlibabaTtsEndpoint('wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference', 'http')).toContain('https://')
  })

  it('rejects non-Alibaba hosts and URL credentials', () => {
    expect(validateAlibabaTtsEndpoint('wss://example.com/api-ws/v1/inference', 'websocket')).toContain('aliyuncs.com')
    expect(validateAlibabaTtsEndpoint('wss://user:secret@workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference', 'websocket')).toContain('must not contain')
  })
})
