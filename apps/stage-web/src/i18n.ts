import { ref } from 'vue'

import { resolvePersistentStorage } from './storage/desktop-storage'

export type Language = 'en' | 'zh-CN'
export const LANGUAGE_KEY = 'aisling.language.v1'

const storage = typeof window === 'undefined' ? undefined : resolvePersistentStorage()
export const language = ref<Language>(storage?.getItem(LANGUAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en')

export function setLanguage(next: Language): void {
  language.value = next
  if (typeof document !== 'undefined')
    document.documentElement.lang = next
  storage?.setItem(LANGUAGE_KEY, next)
  window.aislingDesktop?.setLanguage?.(next)
}

export const zh: Record<string, string> = {
  General: '通用', Language: '语言', Modules: '功能模块',
  Consciousness: 'LLM', Speech: 'TTS', Vision: '视觉', 'Web Search': '搜索', 'Desktop Awareness': '桌面感知',
  Settings: '设置', Stage: '舞台', 'Toggle theme': '切换主题',
  'Choose which model service Aisling uses to think and reply.': '选择 Aisling 用于思考和回应的模型服务。',
  'Choose how Aisling speaks out loud.': '选择 Aisling 发声的方式。',
  'Choose Aisling’s voice.': '为 Aisling 选择声音。',
  'Voice output': '语音输出',
  'Advanced settings': '高级设置',
  'Check the endpoint.': '请检查连接地址。',
  'Choose how Aisling sees images.': '选择 Aisling 理解图像的方式。',
  'Understand images and screenshots.': '理解图像与屏幕截图。',
  'Aisling can look up current information with DuckDuckGo Lite.': '让 Aisling 借助 DuckDuckGo Lite 查阅最新信息。',
  'Look up current information when needed.': '需要时查阅最新信息。',
  'Configure how Aisling observes the desktop and decides whether something is worth commenting on.': '设定 Aisling 如何感知桌面，并判断何时适合开口。',
  'Observe desktop activity and react when appropriate.': '感知桌面动态，适时回应。',
  Provider: '服务提供方', 'Base URL': '服务地址', 'API Key': 'API 密钥', Model: '模型', Voice: '音色', Transport: '传输方式',
  'Realtime WebSocket Endpoint': '实时 WebSocket 地址', 'HTTP API Base URL': 'HTTP API 地址',
  'Realtime WebSocket': '实时 WebSocket', Example: '示例：', Temperature: '温度',
  'Leave as-is for OpenAI; change it for a compatible service.': '使用 OpenAI 时保持默认；其他兼容服务请填写对应地址。',
  'Kept in this browser only. Never committed to git.': '仅保存在本地，不会提交至 Git。',
  'Stored locally. Never committed to git.': '仅保存在本地，不会提交至 Git。',
  'Higher values are more varied; 1.0 preserves the previous default behavior.': '数值越高，表达越多变；1.0 为原有默认值。',
  'Used by the desktop semantic judge and to read Aisling\'s emotion from each reply. Saved with your settings, never committed to git or logged.': '用于桌面语义判断及识别 Aisling 每次回应的情绪。随设置保存在本地，不会提交至 Git 或写入日志。',
  'None (text only)': '无（仅文字）', None: '无',
  'Select provider': '选择服务提供方',
  'System default': '系统默认',
  'OpenAI-compatible multimodal': '兼容 OpenAI 的多模态服务',
  'Browser / System Voice': '浏览器／系统语音', 'Uses this browser\'s built-in speech synthesis.': '使用当前浏览器内置的语音合成。',
  'The chat model decides when to search. DuckDuckGo Lite needs no search API key.': '由对话模型决定何时搜索。DuckDuckGo Lite 无需搜索 API 密钥。',
  Save: '保存', 'Saved.': '已保存。',
  'Desktop-only. Sends current context to a lightweight semantic judge before Aisling may speak.': '仅限桌面端。Aisling 开口前，会先由轻量语义判断器审视当前情境。',
  'Desktop Awareness is unavailable in browser-only mode.': '浏览器模式暂不支持桌面感知。',
  Cooldown: '冷却时间', connected: '已连接', unavailable: '不可用', ON: '开启', OFF: '关闭',
  'Desktop Awareness cooldown': '桌面感知冷却时间', 'TypeSafe / Jev API Key': 'TypeSafe / Jev API 密钥',
  'Aisling is waiting. Say hello.': 'Aisling 正等着你，打个招呼吧。', You: '你', Error: '错误',
  'New conversation': '新对话', 'Delete conversation': '删除对话',
  'Character display': '角色显示', 'Character display controls': '角色显示设置', Character: '角色', Size: '大小', Vertical: '垂直位置', Reset: '重置',
  'Say something to Aisling…': '和 Aisling 说点什么…', 'Say something…': '说点什么…', Send: '发送', 'Send message': '发送消息', 'Message Aisling': '给 Aisling 发消息',
  'Remove image': '移除图片', 'Attach an image': '附加图片', attachment: '附件',
  'Loading character…': '正在唤醒角色…', 'Searching…': '正在搜索…', Thinking: '正在思考', back: '返回舞台',
  'is looking…': '正在看…', 'is searching…': '正在查找…', 'is speaking…': '正在说话…', 'is thinking…': '正在思考…', 'is here.': '就在这里。',
  'Live2D unavailable · using fallback': 'Live2D 暂不可用 · 已切换至简易形象',
  'Realtime WebSocket Endpoint must use wss:// and end with /api-ws/v1/inference.': '实时 WebSocket 地址须以 wss:// 开头，并以 /api-ws/v1/inference 结尾。',
  'HTTP API Base URL must use https:// and end with /api/v1.': 'HTTP API 地址须以 https:// 开头，并以 /api/v1 结尾。',
  'Unsupported image type. Use PNG, JPEG, or WebP.': '暂不支持此图片格式，请使用 PNG、JPEG 或 WebP。',
  'The image is empty.': '图片内容为空。', 'The image is too large (max 10 MB).': '图片过大，请选择不超过 10 MB 的文件。',
  'Desktop Awareness is available in the Electron app only.': '桌面感知仅在 Electron 应用中可用。',
  'Enable this capability': '启用此能力',
  'Enable voice output': '启用语音输出',
  'Enable vision': '启用视觉',
  'Enable web search': '启用网页搜索',
  'Enable desktop awareness': '启用桌面感知',
  'No API key required.': '无需 API 密钥。',
  'Use DuckDuckGo Lite': '使用 DuckDuckGo Lite',
  'Choose DuckDuckGo Lite below before enabling.': '请先在下方选择 DuckDuckGo Lite。',
  'Save a working provider configuration before enabling.': '请先保存可用的服务配置，再开启此能力。',
  'System speech is unavailable here.': '当前环境不支持系统语音。',
  'Configure the API key before enabling.': '请先配置 API 密钥，再开启桌面感知。',
  'Configure Consciousness before enabling.': '请先配置 LLM，再开启桌面感知。',
  'Desktop bridge connected.': '桌面连接已就绪。',
  'Something went wrong.': '出了点状况，请稍后重试。',
  'Vision is not configured — set it up in Settings.': '尚未配置视觉能力，请前往设置完成配置。',
}

export function t(value: string): string {
  return language.value === 'zh-CN' ? zh[value] ?? value : value
}

if (typeof document !== 'undefined')
  document.documentElement.lang = language.value
