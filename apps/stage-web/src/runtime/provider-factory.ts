import { createBrowserSpeechProvider } from '../providers/browser-speech-provider'
import {
  createAlibabaSpeechProvider,
  createOpenAICompatibleProvider,
  createOpenAICompatibleVisionProvider,
  createDuckDuckGoLiteWebSearchProvider,
  createWebSearchTool,
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

export function buildSpeechProvider(config: SpeechConfig): SpeechProvider | undefined {
  if (!config.enabled) return undefined
  if (config.providerType === 'browser')
    return createBrowserSpeechProvider({ voice: config.voice })

  if (config.providerType === 'alibaba') {
    if (!config.apiKey.trim() || !config.model.trim() || !config.voice.trim())
      return undefined
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
  if (!config.enabled) return undefined
  if (config.providerType !== 'openai-compatible')
    return undefined
  if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim())
    return undefined
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
