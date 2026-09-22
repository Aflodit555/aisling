/**
 * A `Stimulus` is any external or internal event that can trigger character
 * processing. It is a domain concept, not a message-queue type: sources (web,
 * bilibili, system, timer, environment, vision, …) are adapters that produce
 * a `Stimulus`, and the runtime only ever sees this contract. Replacing an
 * input source therefore never changes Character Core.
 */
export interface StimulusBase<K extends string> {
  /** Unique identifier for this stimulus. */
  readonly id: string
  /** Origin of the stimulus: 'web', 'bilibili', 'system', … (open string). */
  readonly source: string
  /** Discriminator for the payload carried by this stimulus. */
  readonly kind: K
  /** Epoch milliseconds when the stimulus was created. */
  readonly at: number
  /** Optional adapter-supplied tags (e.g. `inputMode: 'speech'`); never required by the runtime. */
  readonly meta?: Readonly<Record<string, unknown>>
}

/** A user typed or spoke a message that should reach the character. */
export interface UserTextStimulus extends StimulusBase<'user-text'> {
  /** The raw text the user produced. */
  readonly text: string
}

/** A machine-level event (timer, environment, future experiment, …). */
export interface SystemStimulus extends StimulusBase<'system'> {
  /** Stable event name the runtime can route on. */
  readonly event: string
  /** Optional event-specific payload. */
  readonly detail?: unknown
}

/**
 * A visual observation the character received: the Vision provider has already
 * turned an image into text, so this carries the observation plus an optional
 * user caption. It is a distinct kind because "what Aisling saw" is neither a
 * plain user message nor a tool result — the runtime frames it accordingly.
 */
export interface VisualStimulus extends StimulusBase<'visual'> {
  /** Textual description produced by the Vision provider. */
  readonly observation: string
  /** Optional user text sent alongside the image. */
  readonly caption?: string
}

/** Every stimulus the runtime can receive today. */
export interface DesktopFocusSnapshot {
  readonly app: string
  readonly title: string
  readonly text: string
}

export interface DesktopMediaSnapshot {
  readonly app: string
  readonly title: string
  readonly artist: string
}

export interface DesktopActivitySnapshot {
  readonly idleSeconds: number
  readonly focus: DesktopFocusSnapshot
  readonly media: readonly DesktopMediaSnapshot[]
  readonly mic: readonly string[]
  readonly headphones: string
}

/** Runtime observation, never a message authored by the user. */
export interface AutonomousStimulus extends StimulusBase<'autonomous'> {
  readonly activity: DesktopActivitySnapshot
}

export type Stimulus = UserTextStimulus | SystemStimulus | VisualStimulus | AutonomousStimulus

export interface CreateStimulusOptions {
  /** Creation timestamp; defaults to `Date.now()`. */
  at?: number
  /** Explicit id; defaults to a generated UUID. */
  id?: string
  /** Adapter-supplied tags. */
  meta?: Readonly<Record<string, unknown>>
}

function defaultId(): string {
  return crypto.randomUUID()
}

export function createAutonomousStimulus(
  input: { activity: DesktopActivitySnapshot } & CreateStimulusOptions,
): AutonomousStimulus {
  return {
    id: input.id ?? defaultId(),
    source: 'desktop-idle',
    kind: 'autonomous',
    at: input.at ?? Date.now(),
    activity: input.activity,
  }
}

/** Creates a user-text stimulus. */
export function createUserTextStimulus(
  input: { source: string; text: string } & CreateStimulusOptions,
): UserTextStimulus {
  return {
    id: input.id ?? defaultId(),
    source: input.source,
    kind: 'user-text',
    at: input.at ?? Date.now(),
    text: input.text,
    ...(input.meta ? { meta: input.meta } : {}),
  }
}

/** Creates a system stimulus. */
export function createSystemStimulus(
  input: { source: string; event: string; detail?: unknown } & CreateStimulusOptions,
): SystemStimulus {
  return {
    id: input.id ?? defaultId(),
    source: input.source,
    kind: 'system',
    at: input.at ?? Date.now(),
    event: input.event,
    detail: input.detail,
    ...(input.meta ? { meta: input.meta } : {}),
  }
}

/** Creates a visual stimulus from an already-computed observation. */
export function createVisualStimulus(
  input: { source: string; observation: string; caption?: string } & CreateStimulusOptions,
): VisualStimulus {
  return {
    id: input.id ?? defaultId(),
    source: input.source,
    kind: 'visual',
    at: input.at ?? Date.now(),
    observation: input.observation,
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  }
}
