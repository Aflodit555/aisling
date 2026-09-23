import type { PlatformConfig } from './config'

/**
 * The unified capability/module registry. It answers five questions for the
 * Settings UI: which capabilities exist, whether each is enabled, whether it
 * is configured, which provider it uses, and its current status. It is a
 * read-only projection over `PlatformConfig`, not a plugin SDK.
 */

export type CapabilityKind = 'consciousness' | 'speech' | 'hearing' | 'vision' | 'web-search' | 'desktop-awareness'

export type CapabilityStatus = 'ready' | 'not-configured' | 'not-available'

export type CapabilityCategory = '认知/生成' | '输出/表达' | '感知输入' | '视觉感知' | '工具/外部能力' | '桌面感知'

export interface CapabilityModule {
  readonly kind: CapabilityKind
  readonly name: string
  readonly description: string
  readonly category: CapabilityCategory
  /** Id of the current provider, or null when none is assigned. */
  readonly providerId: string | null
  readonly status: CapabilityStatus
}

function providerId(value: string): string | null {
  return value === 'none' ? null : value
}

function hasText(value: string): boolean {
  return value.trim() !== ''
}

function isConsciousnessReady(config: PlatformConfig): boolean {
  const c = config.consciousness
  return c.providerType === 'mock'
    || (hasText(c.baseUrl) && hasText(c.apiKey) && hasText(c.model))
}

function isSpeechReady(config: PlatformConfig): boolean {
  const s = config.speech
  if (s.providerType === 'browser')
    return true
  return s.providerType === 'alibaba' && hasText(s.apiKey) && hasText(s.model) && hasText(s.voice)
}

function isHearingReady(config: PlatformConfig): boolean {
  const h = config.hearing
  if (h.providerType === 'none')
    return false
  return hasText(h.baseUrl) && hasText(h.apiKey) && hasText(h.model)
}

function isVisionReady(config: PlatformConfig): boolean {
  const v = config.vision
  return v.providerType === 'openai-compatible' && hasText(v.baseUrl) && hasText(v.apiKey) && hasText(v.model)
}

function isWebSearchReady(config: PlatformConfig): boolean {
  return config.webSearch.providerType === 'tavily' && hasText(config.webSearch.apiKey)
}

function isDesktopAwarenessReady(config: PlatformConfig): boolean {
  return hasText(config.desktopAwareness.jevApiKey)
}

/** Builds the module registry view for the given platform configuration. */
export function describeCapabilityModules(config: PlatformConfig): CapabilityModule[] {
  return [
    {
      kind: 'consciousness',
      name: 'Consciousness',
      description: 'How Aisling thinks and replies.',
      category: '认知/生成',
      providerId: config.consciousness.providerType,
      status: isConsciousnessReady(config) ? 'ready' : 'not-configured',
    },
    {
      kind: 'speech',
      name: 'Speech',
      description: 'How Aisling speaks out loud.',
      category: '输出/表达',
      providerId: providerId(config.speech.providerType),
      status: isSpeechReady(config) ? 'ready' : 'not-configured',
    },
    {
      kind: 'hearing',
      name: 'Hearing',
      description: 'How Aisling listens to you.',
      category: '感知输入',
      providerId: providerId(config.hearing.providerType),
      status: isHearingReady(config) ? 'ready' : 'not-configured',
    },
    {
      kind: 'vision',
      name: 'Vision',
      description: 'How Aisling sees images.',
      category: '视觉感知',
      providerId: providerId(config.vision.providerType),
      status: isVisionReady(config) ? 'ready' : 'not-configured',
    },
    {
      kind: 'web-search',
      name: 'Web Search',
      description: 'How Aisling looks things up.',
      category: '工具/外部能力',
      providerId: providerId(config.webSearch.providerType),
      status: isWebSearchReady(config) ? 'ready' : 'not-configured',
    },
    {
      kind: 'desktop-awareness',
      name: 'Desktop Awareness',
      description: 'How Aisling observes your current desktop context.',
      category: '桌面感知',
      providerId: 'jev',
      status: isDesktopAwarenessReady(config) ? 'ready' : 'not-configured',
    },
  ]
}
