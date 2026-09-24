import type { ChatMessage } from '@aisling/core'
import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'

import {
  createEmotionState,
  isEmotion,
  type Emotion,
  type EmotionOffer,
  type EmotionSample,
} from '../presentation/emotion-state'

/** A conversation turn as sent to the Jev emotion judge. */
export interface EmotionTurn {
  speaker: 'user' | 'aisling'
  text: string
}

const JUDGE_TURNS = 6

function toTurns(messages: readonly ChatMessage[]): EmotionTurn[] {
  const turns: EmotionTurn[] = []
  for (const message of messages) {
    if ((message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
      turns.push({ speaker: message.role === 'user' ? 'user' : 'aisling', text: message.content })
  }
  return turns.slice(-JUDGE_TURNS)
}

/**
 * Aisling's emotion: Jev judges each finished reply (Electron only — the key
 * and the desktop context stay in the main process); the state machine keeps
 * the shown emotion stable and lets it decay back to neutral. The Live2D layer
 * reads `state` every frame.
 */
export const useEmotionStore = defineStore('emotion', () => {
  const state = markRaw(createEmotionState(performance.now()))
  const last = ref<{ sample: EmotionSample; outcome: EmotionOffer; at: number }>()
  /** Set when an emotion is entered; the Live2D layer may answer with a gesture. */
  const entered = shallowRef<{ emotion: Emotion; strength: number }>()
  const pending = ref(false)
  const error = ref('')
  let revision = 0

  function offer(sample: EmotionSample): EmotionOffer {
    const outcome = state.offer(sample, performance.now())
    last.value = { sample, outcome, at: Date.now() }
    if (outcome === 'entered')
      entered.value = { emotion: sample.emotion, strength: sample.intensity * sample.confidence }
    return outcome
  }

  async function judge(messages: readonly ChatMessage[]): Promise<void> {
    const bridge = window.aislingDesktop
    const turns = toTurns(messages)
    if (typeof bridge?.judgeEmotion !== 'function' || !turns.length)
      return
    const ticket = ++revision
    pending.value = true
    try {
      const result = await bridge.judgeEmotion(turns)
      if (ticket !== revision)
        return
      if (!isEmotion(result.emotion))
        throw new Error(`Unknown emotion "${String(result.emotion)}".`)
      error.value = ''
      offer({ emotion: result.emotion, confidence: result.confidence, intensity: result.intensity })
    }
    catch (cause) {
      if (ticket === revision)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      if (ticket === revision)
        pending.value = false
    }
  }

  return { state, last, entered, pending, error, offer, judge }
})
