export type { Capability, ChatCapability, ConsciousnessCapability } from './capability'
export type { Character, CharacterInput } from './character'
export { createCharacter, findChatCapability } from './character'
export type {
  ConfigStore,
  ConsciousnessConfig,
  DesktopAwarenessConfig,
  HearingConfig,
  PlatformConfig,
  SpeechConfig,
  SpeechTransport,
  VisionConfig,
  WebSearchConfig,
} from './config'
export {
  createDefaultConsciousnessConfig,
  createDefaultPlatformConfig,
  createMemoryConfigStore,
  validateAlibabaWorkspaceBaseUrl,
  validateAlibabaTtsEndpoint,
  DEFAULT_ALIBABA_ASR_MODEL,
  DEFAULT_ALIBABA_TTS_BASE_URL,
  DEFAULT_ALIBABA_TTS_WEBSOCKET_URL,
  DEFAULT_ALIBABA_TTS_MODEL,
  DEFAULT_ALIBABA_TTS_VOICE,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_VISION_MODEL,
} from './config'
export type { HearingCapability, HearingProvider, RecognitionAudio, RecognitionRequest, Transcript } from './hearing'
export type { CharacterOutput, TextOutput } from './output'
export { createTextOutput } from './output'
export type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatProvider,
  ToolCall,
  ToolDefinition,
} from './provider'
export type { SearchResult, WebSearchProvider } from './search'
export type {
  SpeechAudio,
  SpeechCapability,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  SpeechStreamCapability,
  SpeechStreamDescriptor,
  SpeechStreamKind,
  SpeechStreamSink,
} from './speech'
export type { Tool, ToolCapability } from './tool'
export { toToolDefinition } from './tool'
export type { ImageInput, VisionCapability, VisionProvider, VisionRequest, VisualObservation } from './vision'

export { createMockChatProvider } from './providers/mock-chat-provider'
export type { MockChatProviderOptions } from './providers/mock-chat-provider'
export type { OpenAICompatibleProviderOptions } from './providers/openai-compatible-provider'
export {
  createOpenAICompatibleProvider,
  openAIChatCompletion,
  ProviderRequestError,
  testOpenAICompatibleConnection,
} from './providers/openai-compatible-provider'
export type { ConnectionTestResult } from './providers/openai-compatible-provider'
export type { OpenAICompatibleTranscriptionOptions } from './providers/openai-compatible-transcription-provider'
export {
  createOpenAICompatibleTranscriptionProvider,
  normalizeTranscriptionText,
} from './providers/openai-compatible-transcription-provider'
export type { OpenAICompatibleVisionOptions } from './providers/openai-compatible-vision-provider'
export { createOpenAICompatibleVisionProvider } from './providers/openai-compatible-vision-provider'
export type { AlibabaSpeechProviderOptions } from './providers/alibaba-speech-provider'
export { buildContinueTaskMessage, buildFinishTaskMessage, buildRunTaskMessage, createAlibabaSpeechProvider, pcmToWav } from './providers/alibaba-speech-provider'
export { createDuckDuckGoLiteWebSearchProvider } from './providers/duckduckgo-lite-web-search-provider'
export type { AlibabaAsrOptions } from './providers/alibaba-asr-provider'
export { createAlibabaAsrProvider, extractAsrText } from './providers/alibaba-asr-provider'
export { createWebSearchTool } from './tools/web-search-tool'

export type { CapabilityCategory, CapabilityKind, CapabilityModule, CapabilityStatus } from './registry'
export { describeCapabilityModules } from './registry'
export type {
  CharacterRuntime,
  CharacterRuntimeOptions,
  RuntimeEvent,
  TurnRecord,
} from './runtime'
export { createCharacterRuntime } from './runtime'
export type {
  AutonomousStimulus,
  DesktopActivitySnapshot,
  DesktopFocusSnapshot,
  DesktopMediaSnapshot,
  CreateStimulusOptions,
  Stimulus,
  StimulusBase,
  SystemStimulus,
  UserTextStimulus,
  VisualStimulus,
} from './stimulus'
export { createAutonomousStimulus, createSystemStimulus, createUserTextStimulus, createVisualStimulus } from './stimulus'
