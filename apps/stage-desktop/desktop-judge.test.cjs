const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createTypeSafeJudge, normalizeConversation } = require('./desktop-judge.cjs')

test('single noul contract, strict probability validation and request deadline', async () => {
  const originalKey = process.env.TYPESAFE_API_KEY
  process.env.TYPESAFE_API_KEY = 'test'
  const context = { focus: { app: 'Code', title: 'test', text: 'screen' }, media: [], mic: [], idleSeconds: 12 }
  let answer = { type: 'noul', noul: 0.9 }
  const judge = createTypeSafeJudge({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    assert.deepEqual(Object.keys(request.questions), ['should_interrupt'])
    assert.equal(request.questions.should_interrupt.type, 'noul')
    assert.deepEqual(request.state, { focus: { app: 'Code', title: 'test' }, screen_text: 'screen', media: [], mic: [], idle_time: 12 })
    assert.ok(options.signal instanceof AbortSignal)
    return new Response(JSON.stringify({ answers: { should_interrupt: answer } }))
  } })
  try {
    for (const value of [0, 0.64, 0.65, 1]) {
      answer = { type: 'noul', noul: value }
      assert.deepEqual(await judge.judge(context), { shouldInterrupt: value })
    }
    for (const value of [null, true, '0.9', [0.1, 0.9], -1, 2, undefined]) {
      answer = { type: 'noul', noul: value }
      await assert.rejects(judge.judge(context), /invalid should_interrupt/)
    }
    const hanging = createTypeSafeJudge({ fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }) })
    // Keep Node alive while the unref'ed native timeout expires.
    const keepAlive = setInterval(() => {}, 1000)
    try { await assert.rejects(hanging.judge(context), { name: 'TimeoutError' }) }
    finally { clearInterval(keepAlive) }
    delete process.env.TYPESAFE_API_KEY
    await assert.rejects(judge.judge(context), /no Jev API Key/)
  }
  finally {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = originalKey
  }
})

test('emotion: one choice + one score question, desktop only when given, strict validation', async () => {
  const conversation = [{ speaker: 'user', text: 'You look great today' }, { speaker: 'aisling', text: 'W-what? Stop it...' }]
  const desktop = { focus: { app: 'Code', title: 'main.ts', text: 'x'.repeat(3000) }, media: [{ app: 'Spotify', title: 'Song', artist: 'A' }], mic: [], idleSeconds: 3 }
  let requests = []
  let answers = {
    emotion: { type: 'choice', choice: 'shy', confidence: 0.8, probabilities: {} },
    intensity: { type: 'score', score: 1.5, confidence: 0.7, probabilities: {} },
  }
  const judge = createTypeSafeJudge({ fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body))
    assert.ok(options.signal instanceof AbortSignal)
    return new Response(JSON.stringify({ answers }))
  } })

  assert.deepEqual(await judge.judgeEmotion({ conversation }, undefined, 'key'), { emotion: 'shy', confidence: 0.8, intensity: 0.5 })
  const [plain] = requests
  assert.deepEqual(Object.keys(plain.questions), ['emotion', 'intensity'])
  assert.equal(plain.questions.emotion.type, 'choice')
  assert.deepEqual(Object.keys(plain.questions.emotion.criteria), ['joy', 'sad', 'angry', 'surprised', 'shy'])
  assert.equal(plain.questions.intensity.type, 'score')
  assert.equal(plain.questions.intensity.criteria.length, 4)
  assert.deepEqual(plain.state, { conversation })

  await judge.judgeEmotion({ conversation, desktop }, undefined, 'key')
  assert.deepEqual(Object.keys(requests[1].state.desktop), ['app', 'title', 'screen_text', 'media'])
  assert.equal(requests[1].state.desktop.screen_text.length, 600)

  for (const bad of [
    { ...answers, emotion: { ...answers.emotion, choice: 'neutral' } },
    { ...answers, emotion: { ...answers.emotion, confidence: 1.5 } },
    { ...answers, intensity: { ...answers.intensity, score: 4 } },
    { ...answers, intensity: { type: 'noul', noul: 0.5 } },
    { emotion: answers.emotion },
  ]) {
    answers = bad
    await assert.rejects(judge.judgeEmotion({ conversation }, undefined, 'key'), /invalid/)
  }
  const originalKey = process.env.TYPESAFE_API_KEY
  delete process.env.TYPESAFE_API_KEY
  try { await assert.rejects(judge.judgeEmotion({ conversation }), /no Jev API Key/) }
  finally { if (originalKey !== undefined) process.env.TYPESAFE_API_KEY = originalKey }
})

test('conversation from the renderer is validated and capped', () => {
  assert.deepEqual(normalizeConversation('nope'), [])
  const turns = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'aisling' : 'user', text: `t${i}` }))
  assert.equal(normalizeConversation(turns).length, 8)
  assert.deepEqual(normalizeConversation([{ speaker: 'system', text: 'x' }, { speaker: 'user', text: '  ' }, { speaker: 'user', text: 1 }]), [])
  assert.equal(normalizeConversation([{ speaker: 'aisling', text: 'y'.repeat(1000) }])[0].text.length, 600)
})
