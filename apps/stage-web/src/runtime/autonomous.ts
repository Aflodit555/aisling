import { createAutonomousStimulus, type AutonomousStimulus, type DesktopActivitySnapshot } from '@aisling/core'

export interface DesktopObservation {
  activity: DesktopActivitySnapshot
  idleSeconds: number
  available: boolean
  error?: string
}

export interface AutonomousState {
  enabled: boolean
  silenceSeconds: number
  thresholdSeconds: number
  cooldownUntil: number
  lastAutonomousAt: number | null
  latestActivity: DesktopActivitySnapshot
  pending: boolean
  error: string
}

export const AUTONOMOUS_COOLDOWN_MS = 180_000

export function createAutonomousState(): AutonomousState {
  return {
    enabled: false,
    silenceSeconds: 0,
    thresholdSeconds: 90,
    cooldownUntil: 0,
    lastAutonomousAt: null,
    latestActivity: {},
    pending: false,
    error: '',
  }
}

/** One deterministic gate. Polling never reserves the conversation or creates a message. */
export function createAutonomousController(options: {
  state: AutonomousState
  readDesktop: () => Promise<DesktopObservation>
  isBusy: () => boolean
  isReady: () => boolean
  trigger: (stimulus: AutonomousStimulus) => void
  now?: () => number
}) {
  const { state } = options
  const now = options.now ?? Date.now
  let lastHumanAt = now()
  let revision = 0

  function noteHumanInteraction(): void {
    lastHumanAt = now()
    state.silenceSeconds = 0
    revision++ // Invalidates an in-flight desktop read without blocking user input.
  }

  function setEnabled(enabled: boolean): void {
    state.enabled = enabled
    noteHumanInteraction()
    state.latestActivity = {}
    state.error = ''
  }

  function setThreshold(seconds: number): void {
    if (!Number.isFinite(seconds))
      return
    state.thresholdSeconds = Math.max(10, Math.min(600, Math.round(seconds)))
    noteHumanInteraction()
  }

  function completed(): void {
    // A slow request must also leave a full quiet period after it settles.
    state.cooldownUntil = now() + AUTONOMOUS_COOLDOWN_MS
  }

  async function tick(): Promise<void> {
    state.silenceSeconds = Math.max(0, Math.floor((now() - lastHumanAt) / 1000))
    if (!state.enabled || state.pending)
      return
    const ticket = revision
    state.pending = true
    try {
      const observation = await options.readDesktop()
      if (!state.enabled || ticket !== revision)
        return
      state.latestActivity = observation.activity
      state.error = observation.error ?? ''
      if (!observation.available || !Number.isFinite(observation.idleSeconds) || observation.idleSeconds < 0)
        return
      lastHumanAt = Math.max(lastHumanAt, now() - observation.idleSeconds * 1000)
      state.silenceSeconds = Math.max(0, Math.floor((now() - lastHumanAt) / 1000))
      if (!options.isReady() || options.isBusy()
        || state.silenceSeconds < state.thresholdSeconds || now() < state.cooldownUntil)
        return

      state.lastAutonomousAt = now()
      state.cooldownUntil = now() + AUTONOMOUS_COOLDOWN_MS
      // No await between the final gate and ingest: user turns own the same busy flag.
      options.trigger(createAutonomousStimulus({
        activity: { ...state.latestActivity },
        silenceSeconds: state.silenceSeconds,
        at: now(),
      }))
    }
    catch (error) {
      if (state.enabled && ticket === revision)
        state.error = error instanceof Error ? error.message : String(error)
    }
    finally {
      state.pending = false
    }
  }

  return { tick, noteHumanInteraction, setEnabled, setThreshold, completed }
}
