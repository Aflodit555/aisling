/**
 * Unified platform configuration. Every module's settings live under one
 * `PlatformConfig` and one `ConfigStore`, so no module invents its own config
 * file or key storage. API keys never live in source control; storage is
 * swappable behind the `ConfigStore` interface.
 */

export type ChatProviderType = 'mock' | 'openai-compatible'
export type SpeechProviderType = 'none' | 'browser' | 'alibaba'
export type SpeechTransport = 'websocket' | 'http'
export type HearingProviderType = 'none' | 'openai-compatible' | 'alibaba'
export type VisionProviderType = 'none' | 'openai-compatible'
export type WebSearchProviderType = 'none' | 'tavily'

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
}

export interface SpeechConfig {
  /** `none` disables speech output; the character stays text-only. */
  providerType: SpeechProviderType
  apiKey: string
  model: string
  voice: string
  /** Alibaba realtime WebSocket or native HTTP transport. */
  transport: SpeechTransport
  /** Workspace/user-specific endpoint for the selected transport. */
  endpoint: string
}

export interface HearingConfig {
  /** `none` disables voice input. */
  providerType: HearingProviderType
  baseUrl: string
  apiKey: string
  model: string
}

export interface VisionConfig {
  /** `none` disables image input. */
  providerType: VisionProviderType
  baseUrl: string
  apiKey: string
  model: string
}

export interface WebSearchConfig {
  /** `none` disables the web-search tool. */
  providerType: WebSearchProviderType
  apiKey: string
}

export interface PlatformConfig {
  consciousness: ConsciousnessConfig
  desktopAwareness: DesktopAwarenessConfig
  speech: SpeechConfig
  hearing: HearingConfig
  vision: VisionConfig
  webSearch: WebSearchConfig
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ALIBABA_TTS_MODEL = 'qwen-audio-3.0-tts-flash'
export const DEFAULT_ALIBABA_TTS_VOICE = 'longanhuan_v3.6'
export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1'
export const DEFAULT_VISION_MODEL = 'gpt-4o-mini'
export const DEFAULT_ALIBABA_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
export const DEFAULT_ALIBABA_TTS_WEBSOCKET_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
export const DEFAULT_ALIBABA_ASR_MODEL = 'qwen-audio-3.0-asr-flash'

export function createDefaultConsciousnessConfig(): ConsciousnessConfig {
  return { providerType: 'mock', baseUrl: DEFAULT_OPENAI_BASE_URL, apiKey: '', model: '', temperature: 1 }
}

export function createDefaultPlatformConfig(): PlatformConfig {
  return {
    consciousness: createDefaultConsciousnessConfig(),
    desktopAwareness: { enabled: false, cooldownSeconds: 30 },
    speech: {
      providerType: 'none',
      apiKey: '',
      model: DEFAULT_ALIBABA_TTS_MODEL,
      voice: DEFAULT_ALIBABA_TTS_VOICE,
      transport: 'websocket',
      endpoint: DEFAULT_ALIBABA_TTS_WEBSOCKET_URL,
    },
    hearing: {
      providerType: 'none',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      apiKey: '',
      model: DEFAULT_TRANSCRIPTION_MODEL,
    },
    vision: {
      providerType: 'none',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      apiKey: '',
      model: DEFAULT_VISION_MODEL,
    },
    webSearch: {
      providerType: 'none',
      apiKey: '',
    },
  }
}

/**
 * Validates the Alibaba workspace HTTP API base URL. Native TTS/ASR only accept
 * `https://<workspace>.<region>.maas.aliyuncs.com/api/v1`-style bases; a
 * WebSocket or OpenAI-compatible endpoint here is a misconfiguration.
 */
export function validateAlibabaWorkspaceBaseUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed)
    return 'Workspace API Base URL is required.'

  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://'))
    return 'Alibaba Native TTS/ASR requires the workspace HTTP API base URL, not a WebSocket endpoint.'

  if (trimmed.includes('/api-ws/') || trimmed.includes('/compatible-mode/'))
    return 'Alibaba Native TTS/ASR requires the workspace HTTP API base URL, not a WebSocket or OpenAI-compatible endpoint.'

  if (!/^https?:\/\//i.test(trimmed))
    return 'Enter a full HTTP(S) workspace API base URL, e.g. https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1'

  return undefined
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
