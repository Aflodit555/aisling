/**
 * Minimal Live2D parameter layer.
 *
 * `model.update()` writes the native Idle/motion/blink values first; this
 * controller then applies application-layer overrides above that base value, so
 * application code never scatters raw `setParameterValueById` calls across
 * components. Each source declares its identity, priority and parameter targets;
 * for overlapping targets the higher priority wins. Sources may read the native
 * base value (via `readBase`) to cross-fade a handoff, and return `undefined` to
 * claim nothing this frame (releasing ownership back to native motion).
 */

export interface ParameterSampleContext {
  /** Read a parameter's native value left by model.update() this frame. */
  readBase(id: string): number
  /** Frame delta in milliseconds. */
  dtMs: number
}

export interface ParameterSource {
  /** Stable identity, e.g. 'manual-pose' or 'speech-mouth'. */
  id: string
  /** Higher priority wins for overlapping parameters. */
  priority: number
  /** Parameters this source is allowed to write. */
  targets: ReadonlySet<string>
  /** Produce this frame's claims, or undefined to claim nothing. */
  sample(ctx: ParameterSampleContext): ReadonlyMap<string, number> | undefined
}

/** The surface of a Cubism core model this layer needs. */
export interface CoreModelLike {
  getParameterValueById(id: string): number
  setParameterValueById(id: string, value: number): void
}

export interface ParameterController {
  setSources(sources: readonly ParameterSource[]): void
  /** Applies sources and returns the final written claims (parameter id → value). */
  apply(core: CoreModelLike, dtMs: number): ReadonlyMap<string, number>
}

export function createParameterController(): ParameterController {
  let sources: readonly ParameterSource[] = []

  function setSources(next: readonly ParameterSource[]): void {
    sources = [...next].sort((a, b) => a.priority - b.priority)
  }

  function apply(core: CoreModelLike, dtMs: number): ReadonlyMap<string, number> {
    const claims = new Map<string, number>()
    const readBase = (id: string): number => {
      try {
        return core.getParameterValueById(id)
      }
      catch {
        return 0
      }
    }

    for (const source of sources) {
      const claimed = source.sample({ readBase, dtMs })
      if (!claimed)
        continue
      for (const [id, value] of claimed)
        claims.set(id, value)
    }

    for (const [id, value] of claims) {
      try {
        core.setParameterValueById(id, value)
      }
      catch {
        // The model lacks this parameter; ignore like the previous mouth drive did.
      }
    }

    return claims
  }

  return { setSources, apply }
}
