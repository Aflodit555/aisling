const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const notes = [
  { id: 'a', content: "绘画：记录 '杯子' 草稿", createdAt: 1793100000000 },
  { id: 'b', content: '绘画：用线条练习起稿', createdAt: 1793100001000 },
  { id: 'c', content: '绘画：比较光源', createdAt: 1793100002000 },
  { id: 'd', content: '绘画：完成阴影练习', createdAt: 1793100003000 },
  { id: 'e', content: '音乐：试听手碟录音', createdAt: 1793100004000 },
  { id: 'f', content: '音乐：记录节拍', createdAt: 1793100005000 },
]
const origins = [{ reflectionId: 'reflection-a' }, { reflectionId: 'reflection-b' }]
const evidence = (messageIndex, message) => ({ sessionId: 'fiction-paint', messageIndex,
  digest: createHash('sha256').update(JSON.stringify(message), 'utf8').digest('hex') })
const refs = [
  evidence(0, { role: 'user', content: '今天画了杯子。', createdAt: 1793099000000 }),
  evidence(4, { role: 'user', content: '最后画完了阴影。', createdAt: 1793099001000 }),
]
const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]
const committed = { id: 'commit', content: '回滚后可以继续提交', createdAt: 1793100011000 }
const rolledBack = { id: 'rollback', content: '仅用于失败测试', createdAt: 1793100010000 }
const insert = note => ({ type: 'createNote', note })
const originWrite = (noteId, origin) => ({ type: 'addOrigin', noteId, origin })
const evidenceWrite = (noteId, evidence) => ({ type: 'addEvidence', noteId, evidence })
const link = (from, to) => ({ type: 'linkNotes', from, to })
const jsonOrder = rows => rows.map(row => JSON.stringify(row)).sort()

async function writeFixture(store) {
  await store.transaction([
    ...notes.map(insert),
    ...origins.map(origin => originWrite('a', origin)), originWrite('b', origins[0]),
    ...refs.map(ref => evidenceWrite('a', ref)), evidenceWrite('d', refs[0]),
    ...edges.map(([from, to]) => link(from, to)),
  ])
  await store.addOrigin('a', origins[0])
  await store.addEvidence('a', refs[0])
  await store.linkNotes('a', 'b')
  const duplicate = { ...notes[0], content: '不应覆盖旧内容' }
  await assert.rejects(store.createNote(duplicate), /duplicated primary key/)
  await assert.rejects(store.linkNotes('a', 'missing'), /endpoint does not exist/)
  await assert.rejects(store.linkNotes('missing', 'a'), /endpoint does not exist/)
  await assert.rejects(store.addOrigin('missing', origins[0]), /Note does not exist/)
  await assert.rejects(store.addEvidence('missing', refs[0]), /Note does not exist/)
  await assert.rejects(store.transaction([
    insert(rolledBack), originWrite('rollback', origins[0]), evidenceWrite('rollback', refs[0]),
    link('a', 'rollback'), insert(duplicate),
  ]), /duplicated primary key/)
  await assert.rejects(store.transaction([
    insert(rolledBack), link('rollback', 'missing'),
  ]), /endpoint does not exist/)
  await store.transaction([insert(committed)])
}

async function verifyFixture(store) {
  for (const note of [...notes, committed]) assert.deepEqual(await store.getNote(note.id), note)
  for (const id of ['missing', 'rollback']) {
    assert.equal(await store.getNote(id), null)
    assert.deepEqual(await store.getOrigins(id), [])
    assert.deepEqual(await store.getEvidence(id), [])
  }
  assert.deepEqual(jsonOrder(await store.getOrigins('a')), jsonOrder(origins))
  assert.deepEqual(await store.getOrigins('b'), [origins[0]])
  assert.deepEqual(jsonOrder(await store.getEvidence('a')), jsonOrder(refs))
  assert.deepEqual(await store.getEvidence('d'), [refs[0]])
  assert.deepEqual((await store.getRelatedNotes('a', 1)).sort(), ['b', 'c'])
  assert.deepEqual(await store.getRelatedNotes('a', 2), ['d'])
  assert.deepEqual(await store.getRelatedNotes('b', 1), ['d'])
  assert.deepEqual(await store.getRelatedNotes('c', 1), ['d'])
  assert.deepEqual(await store.getRelatedNotes('b', 2), [])
  for (const id of ['d', 'e', 'f', 'missing', 'rollback'])
    for (const depth of [1, 2]) assert.deepEqual(await store.getRelatedNotes(id, depth), [])
}
module.exports = { writeFixture, verifyFixture }
