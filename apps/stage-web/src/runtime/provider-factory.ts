import { createBrowserSpeechProvider } from '../providers/browser-speech-provider'
import {
  createAlibabaSpeechProvider,
  createOpenAICompatibleProvider,
  createOpenAICompatibleVisionProvider,
  createDuckDuckGoLiteWebSearchProvider,
  createWebSearchTool,
  validateAlibabaTtsEndpoint,
  type ChatProvider,
  type ConsciousnessConfig,
  type SpeechConfig,
  type SpeechProvider,
  type Tool,
  type VisionConfig,
  type VisionProvider,
  type WebSearchConfig,
  type WebSearchProvider,
} from '@aisling/core'

/**
 * Maps each module's configuration onto a concrete provider (or tool). This is
 * the only place that touches keys, URLs, and model names; the runtime only
 * sees the provider/tool interfaces.
 */
export function buildChatProvider(config: ConsciousnessConfig): ChatProvider | undefined {
  if (config.providerType === 'openai-compatible') {
    if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim())
      return undefined
    return createOpenAICompatibleProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
    })
  }

  return undefined
}

/** Current ordinary-chat route only; background models retain their own request policy. */
export function userTextEnableThinking(config: Pick<ConsciousnessConfig, 'providerType' | 'baseUrl' | 'model'>): false | undefined {
  try {
    const url = new URL(config.baseUrl)
    if (config.providerType === 'openai-compatible' && config.model === 'qwen3.7-flash' && url.protocol === 'https:'
      && /^[\w-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname)
      && url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1' && !url.username && !url.password && !url.search && !url.hash)
      return false
  }
  catch { /* An unrecognized endpoint keeps its own defaults. */ }
  return undefined
}

/** Formation's bounded JSON output uses the verified route's non-thinking mode. */
export function formationEnableThinking(config: Pick<ConsciousnessConfig, 'providerType' | 'baseUrl' | 'model'>): false | undefined {
  try {
    const url = new URL(config.baseUrl)
    if (config.providerType === 'openai-compatible' && config.model === 'qwen3.8-flash' && url.protocol === 'https:'
      && /^[\w-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname) && !url.port
      && url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1' && !url.username && !url.password && !url.search && !url.hash)
      return false
  }
  catch { /* Unverified routes retain their own defaults. */ }
  return undefined
}

/** P2-only route policy; no change to the shared Provider or ordinary chat defaults. */
export function situationEnableThinking(config: Pick<ConsciousnessConfig, 'providerType' | 'baseUrl' | 'model'>): false | undefined {
  try {
    const url = new URL(config.baseUrl)
    if (config.providerType === 'openai-compatible' && config.model === 'qwen/qwen3.8-flash'
      && url.origin === 'https://api.ppio.com' && ['/openai', '/openai/v1'].includes(url.pathname.replace(/\/+$/, ''))
      && !url.search && !url.hash) return false
  }
  catch { /* An unrecognized endpoint keeps its own defaults. */ }
  return undefined
}

export function speechConfigurationIssue(config: SpeechConfig): string {
  if (config.providerType === 'browser') return window.speechSynthesis ? '' : 'System speech is unavailable here.'
  if (config.providerType !== 'alibaba') return 'Choose a provider.'
  if (!config.apiKey.trim()) return 'Please enter an API key.'
  if (!config.voice.trim()) return 'Please enter a voice.'
  if (!config.model.trim()) return 'Please enter a model.'
  return validateAlibabaTtsEndpoint(config.endpoint, config.transport) ? 'Check the endpoint.' : ''
}

export function visionConfigurationIssue(config: VisionConfig): string {
  if (config.providerType !== 'openai-compatible') return 'Choose a provider.'
  if (!config.apiKey.trim()) return 'Please enter an API key.'
  if (!config.model.trim()) return 'Please enter a model.'
  return config.baseUrl.trim() ? '' : 'Check the endpoint.'
}

export function buildSpeechProvider(config: SpeechConfig): SpeechProvider | undefined {
  if (!config.enabled || speechConfigurationIssue(config)) return undefined
  if (config.providerType === 'browser')
    return createBrowserSpeechProvider({ voice: config.voice })

  if (config.providerType === 'alibaba') {
    return createAlibabaSpeechProvider({
      apiKey: config.apiKey,
      model: config.model,
      voice: config.voice,
      endpoint: config.endpoint,
      transport: config.transport,
    })
  }

  return undefined
}

export function buildVisionProvider(config: VisionConfig): VisionProvider | undefined {
  if (!config.enabled || visionConfigurationIssue(config)) return undefined
  return createOpenAICompatibleVisionProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  })
}

export function buildWebSearchProvider(config: WebSearchConfig): WebSearchProvider | undefined {
  if (!config.enabled) return undefined
  if (config.providerType !== 'duckduckgo')
    return undefined
  return createDuckDuckGoLiteWebSearchProvider()
}

export function buildWebSearchTool(config: WebSearchConfig): Tool | undefined {
  const provider = buildWebSearchProvider(config)
  if (!provider)
    return undefined
  return createWebSearchTool(provider)
}
