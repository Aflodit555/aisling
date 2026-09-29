/**
 * Unified platform configuration. Every module's settings live under one
 * `PlatformConfig` and one `ConfigStore`, so no module invents its own config
 * file or key storage. API keys never live in source control; storage is
 * swappable behind the `ConfigStore` interface.
 */

export type ChatProviderType = 'openai-compatible'
export type SpeechProviderType = 'none' | 'browser' | 'alibaba'
export type SpeechTransport = 'websocket' | 'http'
export type VisionProviderType = 'none' | 'openai-compatible'
export type WebSearchProviderType = 'none' | 'duckduckgo'

export interface ConsciousnessConfig {
  providerType: ChatProviderType
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

export interface DesktopAwarenessConfig {
  enabled: boolean
  cooldownSeconds: number
  /** TypeSafe / Jev API key for the desktop semantic judge (kept out of git and logs). */
  jevApiKey: string
}

export interface SpeechConfig {
  enabled: boolean
  /** Selected speech provider; `none` means no provider is configured. */
  providerType: SpeechProviderType
  apiKey: string
  model: string
  voice: string
  /** Alibaba realtime WebSocket or native HTTP transport. */
  transport: SpeechTransport
  /** Workspace/user-specific endpoint for the selected transport. */
  endpoint: string
}

export interface VisionConfig {
  enabled: boolean
  /** Selected vision provider; `none` means no provider is configured. */
  providerType: VisionProviderType
  baseUrl: string
  apiKey: string
  model: string
}

export interface WebSearchConfig {
  enabled: boolean
  /** Selected search provider; `none` means no provider is configured. */
  providerType: WebSearchProviderType
}

export interface PlatformConfig {
  consciousness: ConsciousnessConfig
  desktopAwareness: DesktopAwarenessConfig
  speech: SpeechConfig
  vision: VisionConfig
  webSearch: WebSearchConfig
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ALIBABA_TTS_MODEL = 'qwen-audio-3.0-tts-flash'
export const DEFAULT_ALIBABA_TTS_VOICE = 'longanhuan_v3.6'
export const DEFAULT_VISION_MODEL = 'gpt-4o-mini'
export const DEFAULT_ALIBABA_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
export const DEFAULT_ALIBABA_TTS_WEBSOCKET_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

export function createDefaultConsciousnessConfig(): ConsciousnessConfig {
  return { providerType: 'openai-compatible', baseUrl: DEFAULT_OPENAI_BASE_URL, apiKey: '', model: '', temperature: 1 }
}

export function createDefaultPlatformConfig(): PlatformConfig {
  return {
    consciousness: createDefaultConsciousnessConfig(),
    desktopAwareness: { enabled: false, cooldownSeconds: 30, jevApiKey: '' },
    speech: {
      enabled: false,
      providerType: 'none',
      apiKey: '',
      model: DEFAULT_ALIBABA_TTS_MODEL,
      voice: DEFAULT_ALIBABA_TTS_VOICE,
      transport: 'websocket',
      endpoint: DEFAULT_ALIBABA_TTS_WEBSOCKET_URL,
    },
    vision: {
      enabled: false,
      providerType: 'none',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      apiKey: '',
      model: DEFAULT_VISION_MODEL,
    },
    webSearch: {
      enabled: true,
      providerType: 'duckduckgo',
    },
  }
}

/** Validates the endpoint contract for the selected Alibaba TTS transport. */
export function validateAlibabaTtsEndpoint(value: string, transport: SpeechTransport): string | undefined {
  const trimmed = value.trim()
  const label = transport === 'websocket' ? 'Realtime WebSocket Endpoint' : 'HTTP API Base URL'
  if (!trimmed)
    return `${label} is required.`

  let url: URL
  try {
    url = new URL(trimmed)
  }
  catch {
    return transport === 'websocket'
      ? 'Enter a full wss:// endpoint, e.g. wss://<workspace>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
      : 'Enter a full HTTPS base URL, e.g. https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1'
  }

  if (url.username || url.password || url.search || url.hash)
    return `${label} must not contain credentials, query parameters, or a fragment.`

  const host = url.hostname.toLowerCase()
  if (host !== 'aliyuncs.com' && !host.endsWith('.aliyuncs.com'))
    return `${label} must use an aliyuncs.com host.`

  const path = url.pathname.replace(/\/+$/, '')
  if (transport === 'websocket') {
    if (url.protocol !== 'wss:' || path !== '/api-ws/v1/inference')
      return 'Realtime WebSocket Endpoint must use wss:// and end with /api-ws/v1/inference.'
    return undefined
  }

  if (url.protocol !== 'https:' || path !== '/api/v1')
    return 'HTTP API Base URL must use https:// and end with /api/v1.'
  return undefined
}

/** Storage port for the platform configuration. */
export interface ConfigStore {
  get(): Promise<PlatformConfig>
  set(config: PlatformConfig): Promise<void>
}

/** In-memory store; used by tests and as the fallback when no storage exists. */
export function createMemoryConfigStore(
  initial: PlatformConfig = createDefaultPlatformConfig(),
): ConfigStore {
  let current = structuredClone(initial)
  return {
    async get() {
      return structuredClone(current)
    },
    async set(config) {
      current = structuredClone(config)
    },
  }
}
