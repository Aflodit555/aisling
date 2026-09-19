import { describe, expect, it } from 'vitest'

import { createDefaultPlatformConfig, createMemoryConfigStore, validateAlibabaWorkspaceBaseUrl } from './config'

describe('config store', () => {
  it('starts with the default platform config', async () => {
    const store = createMemoryConfigStore()
    expect(await store.get()).toEqual(createDefaultPlatformConfig())
  })

  it('persists a full platform config', async () => {
    const store = createMemoryConfigStore()
    const next = {
      consciousness: { providerType: 'openai-compatible', baseUrl: 'https://x/v1', apiKey: 'ck', model: 'm' },
      speech: { providerType: 'alibaba', apiKey: 'sk', model: 'qwen-audio-3.0-tts-flash', voice: 'Cherry', endpoint: 'wss://x/api-ws/v1/realtime' },
      hearing: { providerType: 'openai-compatible', baseUrl: 'https://x/v1', apiKey: 'hk', model: 'whisper-1' },
      vision: { providerType: 'openai-compatible', baseUrl: 'https://x/v1', apiKey: 'vk', model: 'gpt-4o-mini' },
      webSearch: { providerType: 'tavily', apiKey: 'tk' },
    } as const

    await store.set(next)
    expect(await store.get()).toEqual(next)
  })
})

describe('alibaba workspace url validation', () => {
  it('accepts a workspace HTTP base URL', () => {
    expect(validateAlibabaWorkspaceBaseUrl('https://x.cn-beijing.maas.aliyuncs.com/api/v1')).toBeUndefined()
    expect(validateAlibabaWorkspaceBaseUrl('http://x.cn-beijing.maas.aliyuncs.com/api/v1')).toBeUndefined()
  })

  it('rejects WebSocket endpoints', () => {
    expect(validateAlibabaWorkspaceBaseUrl('wss://x/api-ws/v1/inference')).toContain('not a WebSocket endpoint')
  })

  it('rejects OpenAI-compatible endpoints', () => {
    expect(validateAlibabaWorkspaceBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toContain('not a WebSocket or OpenAI-compatible endpoint')
  })

  it('rejects empty and non-http values', () => {
    expect(validateAlibabaWorkspaceBaseUrl('')).toContain('required')
    expect(validateAlibabaWorkspaceBaseUrl('foo')).toContain('HTTP(S)')
  })
})
