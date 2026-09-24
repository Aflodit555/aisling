/**
 * Minimal Live2D parameter layer.
 *
 * The renderer applies this controller right after the native motion update
 * (before expressions, physics and the mesh update), so application layers
 * sit on top of the Idle/gesture motion and physics still reacts to them.
 * Sources run as layers in ascending priority: each reads the value left by the
 * native motion and every lower layer (via `readBase`), so additive layers such
 * as idle gaze and emotion compose, while an absolute writer placed higher
 * still wins. Sources return `undefined` to claim nothing this frame (releasing
 * ownership back to the layers below). Every parameter is written once.
 *
 * Cubism carries parameter values into the next frame, so before each motion
 * update the renderer calls `restore` to put back the native values the layers
 * started from; otherwise an additive layer would stack onto its own previous
 * output wherever the motion does not fully overwrite a parameter.
 */

export interface ParameterSampleContext {
  /** Read a parameter as left by the native motion and all lower-priority sources this frame. */
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
  /** Puts back the native values the last `apply` overwrote. */
  restore(core: CoreModelLike): void
}

export function createParameterController(): ParameterController {
  let sources: readonly ParameterSource[] = []
  let overwritten = new Map<string, number>()

  const read = (core: CoreModelLike, id: string): number => {
    try {
      return core.getParameterValueById(id)
    }
    catch {
      return 0
    }
  }

  function setSources(next: readonly ParameterSource[]): void {
    sources = [...next].sort((a, b) => a.priority - b.priority)
  }

  function apply(core: CoreModelLike, dtMs: number): ReadonlyMap<string, number> {
    const claims = new Map<string, number>()
    const readBase = (id: string): number => {
      const claimed = claims.get(id)
      return claimed !== undefined ? claimed : read(core, id)
    }

    for (const source of sources) {
      const claimed = source.sample({ readBase, dtMs })
      if (!claimed)
        continue
      for (const [id, value] of claimed)
        claims.set(id, value)
    }

    overwritten = new Map()
    for (const [id, value] of claims) {
      try {
        overwritten.set(id, read(core, id))
        core.setParameterValueById(id, value)
      }
      catch {
        // The model lacks this parameter; ignore like the previous mouth drive did.
      }
    }

    return claims
  }

  function restore(core: CoreModelLike): void {
    for (const [id, value] of overwritten) {
      try {
        core.setParameterValueById(id, value)
      }
      catch {}
    }
    overwritten = new Map()
  }

  return { setSources, apply, restore }
}
