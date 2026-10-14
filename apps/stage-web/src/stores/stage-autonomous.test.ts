import { createHash } from 'node:crypto'
import { createAutonomousStimulus, type ChatCompletionRequest, type ChatCompletionResult, type DesktopActivitySnapshot } from '@aisling/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageConversationStore } from '../conversation/conversation-store'
import { useSettingsStore } from './settings'
import { useStageStore } from './stage'
import { useSpeechStore } from './speech'
import { useEmotionStore } from './emotion'
import type { DesktopDiagnosticRecord, DesktopObserverStatus } from '../runtime/autonomous'

const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex')

const context: DesktopActivitySnapshot = {
  capturedAt: 1, targetHwnd: '123', sequence: 1,
  idleSeconds: 1,
  textFingerprint: fingerprint('const answer = 42'),
  focus: { app: 'Code', title: 'main.ts', text: 'const answer = 42' },
  media: [], mic: [], headphones: '',
}
const playingContext: DesktopActivitySnapshot = { ...context, media: [{ app: 'Player', title: 'Private Track', artist: 'Private Artist' }] }

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}

describe('Stage desktop awareness integration', () => {
  let time = 1000
  beforeEach(() => {
    time = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => time)
    const storage = new Map<string, string>()
    let enabled = false
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      aislingDesktop: {
        setDesktopAwareness: vi.fn(async (next: boolean) => ({ enabled: enabled = next, available: false })),
        readDesktopContext: vi.fn(async () => ({ enabled, available: enabled, context: enabled ? context : undefined })),
        judgeDesktopContext: vi.fn(async () => ({
          context, scores: { shouldInterrupt: 0.9 },
        })),
      },
    })
    setActivePinia(createPinia())
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  async function prepareStage() {
    const settings = useSettingsStore()
    await settings.load()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'test-key' })
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'A reply.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    const speak = vi.spyOn(useSpeechStore(), 'speak').mockResolvedValue(undefined)
    const judgeEmotion = vi.spyOn(useEmotionStore(), 'judge').mockResolvedValue(undefined)
    await stage.setDesktopAwarenessEnabled(true)
    return { settings, stage, complete, speak, judgeEmotion }
  }

  function mockDesktop(snapshot: DesktopActivitySnapshot): void {
    snapshot = { ...snapshot, textFingerprint: fingerprint(snapshot.focus.text) }
    vi.mocked(window.aislingDesktop!.readDesktopContext).mockResolvedValue({ enabled: true, available: true, context: snapshot })
    vi.mocked(window.aislingDesktop!.judgeDesktopContext).mockResolvedValue({ context: snapshot, scores: { shouldInterrupt: 0.9 } })
  }

  it.each([false, true])('binds successful delivery to the candidate with diagnostics enabled=%s', async enabled => {
    const logs: DesktopDiagnosticRecord[] = []
    window.aislingDesktop!.desktopDiagnostics = { enabled, replyText: false }
    window.aislingDesktop!.recordDesktopDiagnostic = record => logs.push(record)
    const { settings, stage, complete, speak, judgeEmotion } = await prepareStage()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, replyHistoryEnabled: true })
    await stage.tickAutonomous()
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    const candidate = stage.lastTurn!.stimulus.kind === 'autonomous' ? stage.lastTurn!.stimulus.candidate : undefined
    expect(stage.autonomous.observations[0]).toMatchObject({ candidateId: candidate!.id, objectId: candidate!.objectId, status: 'handled', recentReply: { summary: 'A reply.' } })
    expect(complete).toHaveBeenCalledOnce(); expect(speak).toHaveBeenCalledOnce(); expect(judgeEmotion).toHaveBeenCalledOnce()
    expect(window.aislingDesktop!.readDesktopContext).toHaveBeenCalledOnce()
    expect(window.aislingDesktop!.judgeDesktopContext).toHaveBeenCalledOnce()
    if (!enabled) { expect(logs).toEqual([]); return }
    const start = logs.find(log => log.type === 'chat-started')!, delivery = logs.find(log => log.type === 'delivery')!
    expect(delivery).toMatchObject({ candidateId: candidate!.id, objectId: candidate!.objectId, judgmentId: start.judgmentId,
      targetFingerprint: start.targetFingerprint,
      sampleId: start.sampleId, turnId: start.turnId, replyHistoryWritten: true, replyTarget: 'unknown', intendedTarget: 'foreground' })
    expect(JSON.stringify(logs)).not.toContain('A reply.')
  })

  it.each(['empty', 'failed', 'cancelled'] as const)('does not mark %s output successful', async outcome => {
    const { settings, stage, complete } = await prepareStage()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, replyHistoryEnabled: true })
    let finish!: (result: ChatCompletionResult) => void
    if (outcome === 'empty') complete.mockResolvedValueOnce({ text: ' ' })
    else if (outcome === 'failed') complete.mockRejectedValueOnce(new Error('Failure'))
    else complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await stage.tickAutonomous()
    if (outcome === 'cancelled') { stage.send('/quiet'); finish({ text: 'Revoked result' }) }
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stage.autonomous.observations[0]).toMatchObject({ status: 'new', deliveredAt: null })
    expect(stage.autonomous.observations[0]?.recentReply).toBeUndefined()
  })

  it('delivers an accepted article to its original candidate through a later window change', async () => {
    const { settings, stage, complete } = await prepareStage()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, replyHistoryEnabled: true })
    let finish!: (result: ChatCompletionResult) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await stage.tickAutonomous()
    const original = stage.autonomous.observations[0]!
    mockDesktop({ ...context, targetHwnd: '456', focus: { app: 'qq', title: 'QQ', text: 'Conversation' } })
    await stage.tickAutonomous()
    finish({ text: 'Article comment.' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(original.status).toBe('handled'); expect(original.recentReply?.summary).toBe('Article comment.')
    expect(stage.autonomous.observations[1]?.status).toBe('new')
    expect(stage.messages.at(-1)?.content).toBe('Article comment.')
  })

  it('retires content versions seen during generation before a window return, while preserving a new webpage', async () => {
    const { stage, complete, speak } = await prepareStage()
    let finish!: (result: ChatCompletionResult) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await stage.tickAutonomous()
    const original = stage.autonomous.observations[0]!
    const variation = { ...context, focus: { ...context.focus, text: 'const answer = 42\nPage variation' } }
    for (const at of [3000, 5000]) {
      time = at; mockDesktop({ ...variation, capturedAt: time }); await stage.tickAutonomous()
    }
    const pending = stage.autonomous.observations[1]!
    expect(pending.status).toBe('new')
    finish({ text: 'Original article comment.' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(original.status).toBe('handled'); expect(pending).toMatchObject({ status: 'superseded', deliveredAt: null })
    time = 7000
    mockDesktop({ ...context, capturedAt: time, targetHwnd: '456', focus: { app: 'qq', title: 'QQ', text: 'Conversation' } })
    await stage.tickAutonomous()
    time = 61000; mockDesktop({ ...variation, capturedAt: time }); await stage.tickAutonomous()
    expect(stage.autonomous.decisions.at(-1)?.reason).toBe('foreground-superseded')
    expect(complete).toHaveBeenCalledOnce(); expect(speak).toHaveBeenCalledOnce()
    for (const at of [63000, 65000]) {
      time = at; mockDesktop({ ...context, capturedAt: time, focus: { app: 'Code', title: 'New page', text: 'Different webpage' } })
      await stage.tickAutonomous()
    }
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(complete).toHaveBeenCalledTimes(2); expect(speak).toHaveBeenCalledTimes(2)
    expect(stage.lastTurn?.stimulus).toMatchObject({ kind: 'autonomous', candidate: { objectId: original.objectId, target: { title: 'New page' } } })
  })

  it.each(['poll', 'delivery-check'] as const)('revokes stale A media at %s, keeping it out of display, history and speech', async detection => {
    const { settings, stage, complete, speak, judgeEmotion } = await prepareStage()
    let finish!: (result: ChatCompletionResult) => void
    let partial!: (text: string) => void
    settings.activeChatProvider = { id: 'stream', complete, stream: (_request, onText) => {
      partial = onText; onText('A song partial')
      return new Promise(resolve => { finish = resolve })
    } }
    const a = { ...context, capturedAt: 1000, focus: { app: 'player', title: 'A', text: 'Old lyric A' }, media: [{ app: 'player', title: 'A', artist: 'Artist' }] }
    mockDesktop(a); await stage.tickAutonomous()
    time = 3000; mockDesktop({ ...a, capturedAt: time }); await stage.tickAutonomous()
    expect(stage.sending).toBe(true)
    const candidate = stage.autonomous.observations[0]!
    expect(candidate.source).toBe('media')
    time = 5000; mockDesktop({ ...a, capturedAt: time, media: [{ app: 'player', title: 'B', artist: 'Artist' }] })
    if (detection === 'poll') { await stage.tickAutonomous(); partial('Late A partial') }
    finish({ text: 'A song final' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(candidate).toMatchObject({ status: 'new', deliveredAt: null })
    expect(candidate.recentReply).toBeUndefined()
    expect(JSON.stringify(stage.messages)).not.toContain('A song')
    expect(JSON.stringify(stage.runtime.history)).not.toContain('A song')
    expect(speak).not.toHaveBeenCalled(); expect(judgeEmotion).not.toHaveBeenCalled()
    expect(stage.autonomous.decisions.some(decision => decision.reason === 'media-changed')).toBe(true)
  })

  it('generates B using only the B candidate despite old lyrics and prior A chat', async () => {
    const { stage, complete } = await prepareStage()
    stage.send('We discussed song A before.')
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    complete.mockClear()
    const b = { ...context, capturedAt: 1000, focus: { app: 'player', title: 'A', text: 'Old lyric A' }, media: [{ app: 'player', title: 'B', artist: 'Artist' }] }
    mockDesktop(b); await stage.tickAutonomous()
    time = 3000; mockDesktop({ ...b, capturedAt: time }); await stage.tickAutonomous()
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    const prompt = JSON.stringify(complete.mock.calls[0]![0])
    expect(prompt).toContain('B'); expect(prompt).not.toContain('Old lyric A'); expect(prompt).not.toContain('We discussed song A')
    expect(stage.autonomous.observations[0]).toMatchObject({ source: 'media', status: 'handled' })
    expect(window.aislingDesktop!.readDesktopContext).toHaveBeenCalledTimes(4)
  })
  it('shares an in-flight poll with final media validation instead of falsely cancelling the same song', async () => {
    const { stage, complete, speak } = await prepareStage()
    let finish!: (result: ChatCompletionResult) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const a = { ...context, capturedAt: 1000, focus: { app: 'player', title: 'A', text: 'Lyrics' }, media: [{ app: 'player', title: 'A', artist: 'Artist' }] }
    mockDesktop(a); await stage.tickAutonomous()
    time = 3000; mockDesktop({ ...a, capturedAt: time }); await stage.tickAutonomous()
    expect(window.aislingDesktop!.readDesktopContext).toHaveBeenCalledTimes(3)
    let capture!: (result: DesktopObserverStatus) => void
    vi.mocked(window.aislingDesktop!.readDesktopContext).mockImplementationOnce(() => new Promise(resolve => { capture = resolve }))
    time = 5000
    const polling = stage.tickAutonomous()
    await vi.waitFor(() => expect(window.aislingDesktop!.readDesktopContext).toHaveBeenCalledTimes(4))
    finish({ text: 'The same song reply.' })
    await settle()
    expect(window.aislingDesktop!.readDesktopContext).toHaveBeenCalledTimes(4)
    capture({ enabled: true, available: true, context: { ...a, capturedAt: time, textFingerprint: fingerprint(a.focus.text) } })
    await polling
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stage.messages.at(-1)?.content).toBe('The same song reply.')
    expect(stage.autonomous.observations[0]?.status).toBe('handled')
    expect(speak).toHaveBeenCalledOnce()
  })

  it('quiet blocks new autonomous turns while ordinary questions still use chat, speech and emotion', async () => {
    const { stage, complete, speak, judgeEmotion } = await prepareStage()
    stage.send('暂时别主动打扰我')
    expect(stage.autonomous.preference).toBe('quiet')
    expect(complete).not.toHaveBeenCalled()
    await stage.tickAutonomous()
    stage.sendStimulus(createAutonomousStimulus({ candidate: { id: 'direct', objectId: 'direct', source: 'foreground', change: 'appeared',
      target: context.focus, snapshot: { capturedAt: 1, targetHwnd: '123', sequence: 1 } } }))
    expect(window.aislingDesktop!.readDesktopContext).not.toHaveBeenCalled()
    expect(window.aislingDesktop!.judgeDesktopContext).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
    expect(judgeEmotion).not.toHaveBeenCalled()

    stage.send('解释一下事件循环')
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]![0].messages.at(-1)).toEqual({ role: 'user', content: '解释一下事件循环' })
    expect(speak).toHaveBeenCalledWith('A reply.')
    expect(judgeEmotion).toHaveBeenCalledOnce()
    expect(stage.autonomous.preference).toBe('quiet')
    stage.newConversation()
    expect(stage.autonomous.preference).toBe('quiet')
    await stage.tickAutonomous()
    expect(complete).toHaveBeenCalledOnce()
  })

  it.each([['恢复正常交流', 'normal'], ['可以主动交流了', 'invited']] as const)('explicitly restores via %s and reuses the existing autonomous chain', async (command, preference) => {
    const { stage, complete, speak } = await prepareStage()
    stage.send('/quiet')
    await stage.tickAutonomous()
    stage.send(command)
    expect(stage.autonomous.preference).toBe(preference)
    expect(stage.autonomous.enabled).toBe(true)
    expect(complete).not.toHaveBeenCalled()
    await stage.tickAutonomous()
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(window.aislingDesktop!.judgeDesktopContext).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
    expect(speak).toHaveBeenCalledOnce()
    expect(stage.autonomous.decisions.at(-1)).toMatchObject({ source: 'desktop', preference, outcome: 'allowed', reason: 'output-delivered' })
  })

  it('normal questions and quoted commands do not alter invited intent', async () => {
    const { stage, complete } = await prepareStage()
    stage.send('/invited')
    stage.send('请解释“暂时别主动打扰我”是什么意思')
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(complete).toHaveBeenCalledOnce()
    expect(stage.autonomous.preference).toBe('invited')
    expect(stage.runtime.history).toEqual(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages)
  })

  it('keeps quiet across the awareness switch but resets preference when the renderer store is recreated', async () => {
    const { stage } = await prepareStage()
    stage.send('/quiet')
    await stage.setDesktopAwarenessEnabled(false)
    await stage.setDesktopAwarenessEnabled(true)
    await stage.tickAutonomous()
    expect(stage.autonomous.preference).toBe('quiet')
    expect(window.aislingDesktop!.readDesktopContext).not.toHaveBeenCalled()
    setActivePinia(createPinia())
    const recreated = useStageStore()
    expect(recreated.autonomous.preference).toBe('normal')
    expect(recreated.runtime.history.some(message => message.content === '/quiet')).toBe(true)
  })

  it('quiet invalidates an in-flight Jev judgment without an extra chat call', async () => {
    const { stage, complete } = await prepareStage()
    mockDesktop(playingContext)
    let finish!: (value: { context: DesktopActivitySnapshot; scores: { shouldInterrupt: number } }) => void
    vi.mocked(window.aislingDesktop!.judgeDesktopContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = stage.tickAutonomous()
    await vi.waitFor(() => expect(window.aislingDesktop!.judgeDesktopContext).toHaveBeenCalledOnce())
    stage.send('/quiet')
    finish({ context: playingContext, scores: { shouldInterrupt: 1 } })
    await pending
    expect(complete).not.toHaveBeenCalled()
    expect(stage.autonomous.pending).toBe(false)
    expect(stage.autonomous.decisions.at(-1)).toMatchObject({ preference: 'quiet', outcome: 'blocked', reason: 'invalidated' })
    expect(stage.autonomous.observations[0]).toMatchObject({ status: 'new', deliveredAt: null })
  })

  it.each(['completed', 'failed'] as const)('discards an already triggered autonomous stream ending %s, even after permission is restored', async (outcome) => {
    const { settings, stage, complete, speak, judgeEmotion } = await prepareStage()
    mockDesktop(playingContext)
    let finish!: (result: ChatCompletionResult) => void
    let fail!: (error: Error) => void
    let emitText!: (text: string) => void
    const stream = vi.fn((_request: ChatCompletionRequest, onText: (text: string) => void) => {
      emitText = onText
      onText('Stale partial')
      return new Promise<ChatCompletionResult>((resolve, reject) => { finish = resolve; fail = reject })
    })
    settings.activeChatProvider = { id: 'stream', complete, stream }
    await stage.tickAutonomous()
    expect(stage.sending).toBe(true)
    expect(stage.messages.at(-1)?.content).toBe('Stale partial')
    stage.send('/quiet')
    expect(stage.messages.some(message => message.content === 'Stale partial')).toBe(false)
    stage.send('/invited')
    emitText('Late partial')
    if (outcome === 'completed') finish({ text: 'Stale final' })
    else fail(new Error('Stale provider error'))
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stream).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
    expect(judgeEmotion).not.toHaveBeenCalled()
    expect(stage.lastTurn).toBeUndefined()
    expect(stage.autonomous.observations[0]).toMatchObject({ status: 'new', deliveredAt: null })
    expect(JSON.stringify(stage.messages)).not.toMatch(/Stale|Late partial/)
    const persisted = createLocalStorageConversationStore().get(stage.activeSessionId)!.messages
    expect(stage.runtime.history).toEqual(persisted)
    expect(JSON.stringify(persisted)).not.toMatch(/Stale|Late partial/)
    expect(stage.autonomous.decisions.some(decision => decision.reason === 'quiet-in-flight' && decision.preference === 'quiet')).toBe(true)
    expect(stage.autonomous.decisions.at(-1)).toMatchObject({ preference: 'invited', outcome: 'blocked', reason: 'cancelled-output' })
    expect(stage.autonomous.decisions.at(-1)?.stimulusId).toBe(stage.autonomous.decisions.find(decision => decision.reason === 'gate-passed')?.stimulusId)

  })

  it('a quiet command during an ordinary user reply does not cancel that reply or duplicate history', async () => {
    const { settings, stage, complete, speak, judgeEmotion } = await prepareStage()
    let finish!: (result: ChatCompletionResult) => void
    const stream = vi.fn((_request: ChatCompletionRequest, onText: (text: string) => void) => {
      onText('Answer partial')
      return new Promise<ChatCompletionResult>(resolve => { finish = resolve })
    })
    settings.activeChatProvider = { id: 'stream', complete, stream }
    stage.send('普通问题')
    stage.send('/quiet')
    finish({ text: 'Normal answer' })
    await vi.waitFor(() => expect(stage.sending).toBe(false))
    expect(stage.messages.some(message => message.content === 'Normal answer')).toBe(true)
    expect(speak).toHaveBeenCalledWith('Normal answer')
    expect(judgeEmotion).toHaveBeenCalledOnce()
    expect(stage.autonomous.preference).toBe('quiet')
    expect(stage.runtime.history.filter(message => message.content === '普通问题')).toHaveLength(1)
    expect(stage.runtime.history.filter(message => message.content === '/quiet')).toHaveLength(1)
    expect(stage.runtime.history).toEqual(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages)
    await stage.tickAutonomous()
    expect(window.aislingDesktop!.readDesktopContext).not.toHaveBeenCalled()
  })

  it.each([true, false])('reuses chat, conversation, and speech when speech enabled=%s', async (speechEnabled) => {
    const settings = useSettingsStore()
    await settings.load()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'test-key' })
    const complete = vi.fn(async (_request: ChatCompletionRequest) => ({ text: 'That answer looks suspiciously tidy.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const synthesize = vi.fn(async () => ({ spoken: true }))
    settings.activeSpeechProvider = speechEnabled ? { id: 'test-speech', synthesize } : undefined
    const stage = useStageStore()

    await stage.setDesktopAwarenessEnabled(true)
    await stage.tickAutonomous()
    await settle()

    expect(stage.messages).toEqual([{ role: 'assistant', content: 'That answer looks suspiciously tidy.' }])
    expect(stage.runtime.history).toEqual(stage.messages)
    expect(createLocalStorageConversationStore().get(stage.activeSessionId)!.messages).toEqual(stage.messages)
    expect(synthesize).toHaveBeenCalledTimes(speechEnabled ? 1 : 0)
    expect(settings.config.desktopAwareness.enabled).toBe(true)
    expect(stage.lastTurn!.stimulus.kind).toBe('autonomous')
    expect(complete.mock.calls[0]![0].messages.at(-2)!.content).toContain('const answer = 42')
  })

  it('stops immediately and invalidates an in-flight judge', async () => {
    const settings = useSettingsStore()
    await settings.load()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'test-key' })
    const complete = vi.fn(async () => ({ text: 'Too late.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    await stage.setDesktopAwarenessEnabled(true)

    let resolve!: () => void
    vi.mocked(window.aislingDesktop!.judgeDesktopContext).mockImplementationOnce(() => new Promise(done => {
      resolve = () => done({ context, scores: { shouldInterrupt: 1 } })
    }))
    const pending = stage.tickAutonomous()
    await vi.waitFor(() => expect(window.aislingDesktop!.judgeDesktopContext).toHaveBeenCalled())
    const stopping = stage.setDesktopAwarenessEnabled(false)
    expect(stage.autonomous.enabled).toBe(false)
    resolve()
    await Promise.all([pending, stopping])

    expect(complete).not.toHaveBeenCalled()
    expect(window.aislingDesktop!.setDesktopAwareness).toHaveBeenLastCalledWith(false)
    expect(settings.config.desktopAwareness.enabled).toBe(false)
  })

  it('stays unavailable in browser-only mode without collecting', async () => {
    window.aislingDesktop = undefined
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    await settings.load()
    const stage = useStageStore()
    await stage.setDesktopAwarenessEnabled(true)
    await stage.tickAutonomous()
    expect(stage.desktopBridgeState).toBe('unavailable')
    expect(stage.autonomous.enabled).toBe(false)
    expect(stage.autonomous.error).toContain('Electron')
    expect(settings.config.desktopAwareness.enabled).toBe(false)
  })

  it('does not judge or reply when a desktop request returns unavailable', async () => {
    const settings = useSettingsStore()
    await settings.load()
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: 'test-key' })
    const complete = vi.fn(async () => ({ text: 'Stale.' }))
    settings.activeChatProvider = { id: 'test', complete }
    const stage = useStageStore()
    await stage.setDesktopAwarenessEnabled(true)
    vi.mocked(window.aislingDesktop!.readDesktopContext).mockResolvedValue({
      enabled: true, available: false, error: 'Desktop observer request timed out.',
    })

    await stage.tickAutonomous()

    expect(window.aislingDesktop!.judgeDesktopContext).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(stage.autonomous.error).toContain('timed out')
    expect(stage.autonomous.pending).toBe(false)
  })
})
