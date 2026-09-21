const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_MODEL = 'jev-latest'

function createTypeSafeJudge(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const questions = {
    should_interrupt: {
      type: 'noul',
      instructions: 'Should Aisling interrupt the user and say something now?',
      criteria: {
        true: 'There is something sufficiently relevant, unusual, interesting, or useful to comment on, and interrupting now would not be disruptive.',
        false: 'The screen contains routine or low-value activity, there is no meaningful reason to speak, or the user appears busy and interruption would be disruptive.',
      },
    },
  }

  async function judge(context, signal) {
    const key = process.env.TYPESAFE_API_KEY
    if (!key)
      throw new Error('Desktop semantic judge unavailable: TYPESAFE_API_KEY is not set.')
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
      signal,
    })
    if (!response.ok)
      throw new Error(`Desktop semantic judge failed (${response.status}).`)
    const data = await response.json()
    const value = (name, field) => {
      const raw = data.answers?.[name]?.[field]
      const number = Array.isArray(raw)
        ? raw.reduce((total, probability, level) => total + Number(probability) * level, 0)
        : Number(raw)
      if (!Number.isFinite(number))
        throw new Error('Desktop semantic judge returned invalid data.')
      return number
    }
    return {
      shouldInterrupt: value('should_interrupt', 'noul'),
    }
  }

  return { judge }
}

module.exports = { createTypeSafeJudge }
