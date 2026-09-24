const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_MODEL = 'jev-latest'

// One category per expression the character model can show distinctly; neutral
// is not a category but intensity 0 (see apps/stage-web/src/presentation/emotion-state.ts).
const EMOTIONS = ['joy', 'sad', 'angry', 'surprised', 'shy']
const INTENSITY_MAX = 3
const emotionQuestions = {
  emotion: {
    type: 'choice',
    instructions: 'Which emotion would Aisling visibly show right now? Judge mainly from her latest message in the conversation; earlier messages and the desktop are background.',
    criteria: {
      joy: 'Happy, amused, pleased, affectionate, playful or excited.',
      sad: 'Sad, disappointed, apologetic, lonely or worried.',
      angry: 'Annoyed, irritated, indignant, sulking or pouting.',
      surprised: 'Surprised, startled, shocked, alarmed or scared.',
      shy: 'Embarrassed, flustered, bashful or shy, e.g. after a compliment or teasing.',
    },
  },
  intensity: {
    type: 'score',
    instructions: 'How strongly does Aisling show that emotion right now?',
    criteria: [
      'Not at all: calm, neutral or matter-of-fact.',
      'Slightly: a faint tint a viewer might barely notice.',
      'Clearly: an obvious emotion a viewer would easily notice.',
      'Strongly: a vivid, intense emotion.',
    ],
  },
}

/** Recent turns from the renderer, validated and capped: [{ speaker: 'user' | 'aisling', text }]. */
function normalizeConversation(value) {
  if (!Array.isArray(value))
    return []
  return value
    .filter(turn => turn && (turn.speaker === 'user' || turn.speaker === 'aisling') && typeof turn.text === 'string' && turn.text.trim())
    .slice(-8)
    .map(turn => ({ speaker: turn.speaker, text: turn.text.slice(0, 600) }))
}

function createTypeSafeJudge(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const questions = {
    should_interrupt: {
      type: 'noul',
      instructions: 'Would this be a natural moment for Aisling to make a brief unsolicited comment?',
      criteria: {
        true: 'The current context contains a concrete detail that gives Aisling a natural conversational opening. A brief reaction, observation, opinion, curiosity, or playful remark would feel appropriate. The moment does not need to be important or unusual.',
        false: 'There is no concrete conversational hook, the context is repetitive or too thin to react to, or the user is clearly occupied in a way that would make speaking now intrusive.',
      },
    },
  }

  function resolveKey(apiKey) {
    if (typeof apiKey === 'string' && apiKey.trim())
      return apiKey.trim()
    return process.env.TYPESAFE_API_KEY
  }

  async function judge(context, signal, apiKey) {
    const key = resolveKey(apiKey)
    if (!key)
      throw new Error('Desktop semantic judge unavailable: no Jev API Key configured.')
    const state = {
      focus: { app: context.focus.app, title: context.focus.title },
      screen_text: context.focus.text,
      media: context.media,
      mic: context.mic,
      idle_time: context.idleSeconds,
    }
    const response = await fetchImpl(TYPESAFE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: TYPESAFE_MODEL, state, questions }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
    })
    if (!response.ok)
      throw new Error(`Desktop semantic judge failed (${response.status}).`)
    const data = await response.json()
    const answer = data?.answers?.should_interrupt
    const probability = answer?.noul
    if (answer?.type !== 'noul' || typeof probability !== 'number'
      || !Number.isFinite(probability) || probability < 0 || probability > 1)
      throw new Error('Desktop semantic judge returned invalid should_interrupt: expected noul probability in [0, 1].')
    return {
      shouldInterrupt: probability,
    }
  }

  /** Minimal reachability check for the Jev API key; never triggers Autonomous Speak. */
  async function test(apiKey) {
    const key = resolveKey(apiKey)
    if (!key)
      return { ok: false, message: 'No Jev API Key configured.' }
    try {
      const response = await fetchImpl(TYPESAFE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: TYPESAFE_MODEL,
          state: { focus: { app: '', title: '' }, screen_text: '', media: [], mic: [], idle_time: 0 },
          questions,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok)
        return { ok: false, message: `Desktop semantic judge failed (${response.status}).` }
      const data = await response.json()
      const answer = data?.answers?.should_interrupt
      if (answer?.type !== 'noul' || typeof answer?.noul !== 'number')
        return { ok: false, message: 'Desktop semantic judge returned invalid data.' }
      return { ok: true, message: 'Connected.' }
    }
    catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Emotion Aisling shows, from the recent conversation and (when Desktop
   * Awareness is on) the desktop. Returns intensity normalized to 0..1.
   */
  async function judgeEmotion(input, signal, apiKey) {
    const key = resolveKey(apiKey)
    if (!key)
      throw new Error('Emotion judge unavailable: no Jev API Key configured.')
    const state = { conversation: input.conversation }
    if (input.desktop) {
      state.desktop = {
        app: input.desktop.focus.app,
        title: input.desktop.focus.title,
        screen_text: input.desktop.focus.text.slice(0, 600),
        media: input.desktop.media,
      }
    }
    const response = await fetchImpl(TYPESAFE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: TYPESAFE_MODEL, state, questions: emotionQuestions }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
    })
    if (!response.ok)
      throw new Error(`Emotion judge failed (${response.status}).`)
    const data = await response.json()
    const emotion = data?.answers?.emotion
    const intensity = data?.answers?.intensity
    const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    if (emotion?.type !== 'choice' || !EMOTIONS.includes(emotion.choice) || !unit(emotion.confidence))
      throw new Error('Emotion judge returned an invalid emotion.')
    if (intensity?.type !== 'score' || !unit(intensity.score / INTENSITY_MAX))
      throw new Error('Emotion judge returned an invalid intensity.')
    return { emotion: emotion.choice, confidence: emotion.confidence, intensity: intensity.score / INTENSITY_MAX }
  }

  return { judge, judgeEmotion, test }
}

module.exports = { createTypeSafeJudge, normalizeConversation }
