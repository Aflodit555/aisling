/**
 * Audio activity boundary: exposes the actual playing audio signal of an
 * HTMLAudioElement as a raw normalized level (0..1), via a Web Audio
 * MediaElementAudioSourceNode → AnalyserNode tap. It owns the Web Audio nodes
 * and their lifecycle; consumers only read `level()`/`active()` and call
 * `dispose()`.
 *
 * `level()` returns `undefined` when no sample is available (no element tap
 * yet, or a suspended AudioContext that has not resumed), so a consumer can
 * distinguish "no data" from "true silence" instead of mistaking the former for
 * the latter. This module does no smoothing and owns no presentation state —
 * that belongs to the mouth signal / mouth controller layers.
 */

export interface AudioActivity {
  /** Current raw audio level 0..1, or undefined when nothing is analysable. */
  level(): number | undefined
  /** Whether the element is actively playing (not paused/ended). */
  active(): boolean
  /** Idempotent: disconnects nodes and releases the tap. */
  dispose(): void
}

let sharedContext: AudioContext | undefined

function getSharedContext(): AudioContext | undefined {
  try {
    if (!sharedContext) {
      const Ctor = (globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined
      if (!Ctor)
        return undefined
      sharedContext = new Ctor()
      void sharedContext.resume()
    }
    return sharedContext
  }
  catch {
    return undefined
  }
}

export function createAudioActivity(element: HTMLAudioElement): AudioActivity {
  let source: MediaElementAudioSourceNode | undefined
  let analyser: AnalyserNode | undefined
  let data: Float32Array<ArrayBuffer> | undefined
  let disposed = false

  /**
   * Attaches the analyser tap lazily. A suspended context is asked to resume
   * and returns false so this frame reports "no data" rather than a false
   * silence; the next frame retries once the context is running.
   */
  function attach(): boolean {
    if (analyser)
      return true
    const context = getSharedContext()
    if (!context)
      return false

    if (context.state !== 'running') {
      void context.resume().catch(() => {})
      return false
    }

    try {
      source = context.createMediaElementSource(element)
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      // Passthrough keeps audio audible; the analyser is a side tap.
      source.connect(context.destination)
      source.connect(analyser)
      data = new Float32Array(analyser.fftSize)
      return true
    }
    catch {
      source = undefined
      analyser = undefined
      return false
    }
  }

  return {
    level() {
      if (disposed)
        return undefined
      if (!attach() || !analyser || !data)
        return undefined
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const value = data[i]!
        sum += value * value
      }
      return Math.sqrt(sum / data.length)
    },
    active() {
      return !element.paused && !element.ended
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      try {
        source?.disconnect()
      }
      catch { /* already disconnected */ }
      try {
        analyser?.disconnect()
      }
      catch { /* already disconnected */ }
      source = undefined
      analyser = undefined
      data = undefined
    },
  }
}
