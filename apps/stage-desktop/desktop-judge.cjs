const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_MODEL = 'jev-latest'

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

  return { judge }
}

module.exports = { createTypeSafeJudge }
