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

  return { judge, test }
}

module.exports = { createTypeSafeJudge }
