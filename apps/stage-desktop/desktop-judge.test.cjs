const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createTypeSafeJudge } = require('./desktop-judge.cjs')

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
    await assert.rejects(judge.judge(context), /TYPESAFE_API_KEY/)
  }
  finally {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = originalKey
  }
})
