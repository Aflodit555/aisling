import { createBrowserSpeechProvider } from '../providers/browser-speech-provider'
import {
  createAlibabaAsrProvider,
  createAlibabaSpeechProvider,
  createMockChatProvider,
  createOpenAICompatibleProvider,
  createOpenAICompatibleTranscriptionProvider,
  createOpenAICompatibleVisionProvider,
  createDuckDuckGoLiteWebSearchProvider,
  createWebSearchTool,
  type ChatProvider,
  type ConsciousnessConfig,
  type HearingConfig,
  type HearingProvider,
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
  if (config.providerType === 'mock')
    return createMockChatProvider({ id: 'mock', delayMs: 450 })

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

export function buildHearingProvider(config: HearingConfig): HearingProvider | undefined {
  if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim())
    return undefined

  if (config.providerType === 'alibaba') {
    return createAlibabaAsrProvider({
      endpoint: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      transport: 'relay',
    })
  }

  if (config.providerType === 'openai-compatible') {
    return createOpenAICompatibleTranscriptionProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      // Browsers often cannot reach the endpoint (CORS); use the thin relay.
      transport: 'relay',
    })
  }

  return undefined
}

export function buildVisionProvider(config: VisionConfig): VisionProvider | undefined {
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
