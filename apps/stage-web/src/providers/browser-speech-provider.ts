import type { SpeechProvider, SpeechRequest, SpeechResult } from '@aisling/core'

/**
 * Browser / System Voice `SpeechProvider`: speaks through
 * `window.speechSynthesis` instead of returning audio bytes. It is a real
 * SpeechProvider, not a bypass — `synthesize` speaks and resolves `{ spoken }`.
 */

const PREFERRED_VOICE_NAMES = [
  'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
  'Microsoft Xiaoxiao Online (Natural)',
  'Microsoft Xiaoxiao',
  'zh-CN Xiaoxiao',
]

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis)
    return []
  return window.speechSynthesis.getVoices()
}

/** Prefers a local Chinese young female voice (e.g. Microsoft Xiaoxiao); falls back gracefully. */
export function pickPreferredVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredNames: readonly string[] = PREFERRED_VOICE_NAMES,
): SpeechSynthesisVoice | undefined {
  for (const name of preferredNames) {
    const exact = voices.find(voice => voice.name === name)
    if (exact)
      return exact
  }
  return voices.find(voice => voice.name.toLowerCase().includes('xiaoxiao'))
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith('zh'))
    ?? voices[0]
}

export interface BrowserSpeechOptions {
  voice?: string
  rate?: number
}

export function createBrowserSpeechProvider(options: BrowserSpeechOptions = {}): SpeechProvider {
  return {
    id: 'browser',
    speaksDirectly: true,

    async synthesize(request: SpeechRequest): Promise<SpeechResult> {
      const synth = window.speechSynthesis
      if (!synth)
        throw new Error('Speech synthesis is not available in this browser')

      const text = request.text.trim()
      if (!text)
        return { spoken: true }
      request.signal?.throwIfAborted()

      const utterance = new SpeechSynthesisUtterance(text)
      if (options.voice) {
        const voice = synth.getVoices().find(candidate => (
          candidate.name === options.voice || candidate.voiceURI === options.voice
        ))
        if (voice)
          utterance.voice = voice
      }
      if (options.rate)
        utterance.rate = options.rate

      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          request.signal?.removeEventListener('abort', cancel)
          utterance.onstart = utterance.onend = utterance.onerror = null
          if (error) reject(error)
          else resolve()
        }
        const cancel = () => {
          // Some engines omit onend/onerror after cancel; settle explicitly.
          finish(new DOMException('Speech cancelled', 'AbortError'))
          synth.cancel()
        }
        utterance.onstart = () => request.onStart?.()
        utterance.onend = () => finish()
        utterance.onerror = event => finish(new Error(`Speech synthesis failed (${event.error})`))
        request.signal?.addEventListener('abort', cancel, { once: true })
        try { synth.speak(utterance) }
        catch (error) { finish(error instanceof Error ? error : new Error('Speech synthesis failed')) }
      })

      return { spoken: true }
    },
  }
}
