import { createAutonomousStimulus, type AutonomousStimulus, type DesktopActivitySnapshot } from '@aisling/core'

export interface DesktopJudgeScores {
  [name: string]: number | undefined
  shouldInterrupt: number
}

export interface DesktopObserverStatus {
  enabled: boolean
  available: boolean
  context?: DesktopActivitySnapshot
  error?: string
}

export interface DesktopJudgeResult {
  context: DesktopActivitySnapshot
  scores: DesktopJudgeScores
}

export interface AutonomousState {
  enabled: boolean
  cooldownStartedAt: number | null
  lastAutonomousAt: number | null
  lastTrigger: string
  latestContext?: DesktopActivitySnapshot
  scores?: DesktopJudgeScores
  judgeLatencyMs: number | null
  pending: boolean
  error: string
}

export const DESKTOP_POLL_MS = 2_000
export const SHOULD_INTERRUPT_THRESHOLD = 0.65

export function createAutonomousState(): AutonomousState {
  return {
    enabled: false,
    cooldownStartedAt: null,
    lastAutonomousAt: null,
    lastTrigger: '',
    judgeLatencyMs: null,
    pending: false,
    error: '',
  }
}

function contextSignature(context: DesktopActivitySnapshot): string {
  const { focus } = context
  return [focus.app, focus.title, focus.text.slice(0, 600), JSON.stringify(context.media)].join('\0')
}

/** Thin gate: changed content → one judge call → thresholds → existing runtime. */
export function createAutonomousController(options: {
  state: AutonomousState
  readDesktop: () => Promise<DesktopObserverStatus>
  judgeDesktop: () => Promise<DesktopJudgeResult>
  isBusy: () => boolean
  isReady: () => boolean
  getCooldownMs: () => number
  trigger: (stimulus: AutonomousStimulus) => void
  now?: () => number
}) {
  const { state } = options
  const now = options.now ?? Date.now
  let revision = 0
  let lastJudgedSignature = ''
  let lastTriggeredSignature = ''

  function noteHumanInteraction(): void {
    revision++
  }

  function setEnabled(enabled: boolean): void {
    state.enabled = enabled
    revision++
    if (!enabled) {
      state.latestContext = undefined
      state.scores = undefined
      state.judgeLatencyMs = null
      state.error = ''
      lastJudgedSignature = ''
    }
  }

  function completed(): void {
    state.cooldownStartedAt = now()
  }

  async function tick(): Promise<void> {
    if (!state.enabled || state.pending)
      return
    const ticket = revision
    state.pending = true
    try {
      const snapshot = await options.readDesktop()
      if (!state.enabled || ticket !== revision)
        return
      state.error = snapshot.error ?? ''
      if (!snapshot.enabled || !snapshot.available || !snapshot.context)
        return

      state.latestContext = snapshot.context
      let signature = contextSignature(snapshot.context)
      if (signature !== lastJudgedSignature) {
        const startedAt = now()
        const judged = await options.judgeDesktop()
        if (!state.enabled || ticket !== revision)
          return
        state.judgeLatencyMs = now() - startedAt
        state.latestContext = judged.context
        state.scores = judged.scores
        signature = contextSignature(judged.context)
        lastJudgedSignature = signature
        state.error = ''
      }

      const scores = state.scores
      if (!scores || signature === lastTriggeredSignature || !options.isReady() || options.isBusy()
        || scores.shouldInterrupt < SHOULD_INTERRUPT_THRESHOLD
        || (state.cooldownStartedAt !== null && now() < state.cooldownStartedAt + options.getCooldownMs()))
        return

      state.lastAutonomousAt = now()
      state.lastTrigger = `should_interrupt ${scores.shouldInterrupt.toFixed(2)}`
      state.cooldownStartedAt = now()
      lastTriggeredSignature = signature
      options.trigger(createAutonomousStimulus({ activity: judgedContext(state), at: now() }))
    }
    catch (error) {
      if (state.enabled && ticket === revision)
        state.error = error instanceof Error ? error.message : String(error)
    }
    finally {
      state.pending = false
    }
  }

  return { tick, noteHumanInteraction, setEnabled, completed }
}

function judgedContext(state: AutonomousState): DesktopActivitySnapshot {
  if (!state.latestContext)
    throw new Error('Desktop context is unavailable.')
  return state.latestContext
}
