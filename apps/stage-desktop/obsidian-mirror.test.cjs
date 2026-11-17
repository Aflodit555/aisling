const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { createObsidianMirror, startObsidianMirror } = require('./memory-database/obsidian-mirror.cjs')
const { startWorker } = require('./memory-database/client.cjs')

async function fixture() {
  const parent = path.resolve(__dirname, '../../artifacts/obsidian-mirror')
  await fs.mkdir(parent, { recursive: true })
  const vault = await fs.mkdtemp(path.join(parent, 'test-'))
  return { vault, root: path.join(vault, 'Aisling Memory'), mirror: createObsidianMirror(vault) }
}
const filenames = root => fs.readdir(root)

test('mirror aligns all Notes, real edges, changes, stable paths, deletions and literal content', async () => {
  const { vault, root, mirror } = await fixture()
  await fs.writeFile(path.join(vault, 'keep.md'), 'outside')
  const notes = [{ id: 'a', content: '标题 [[fake]]\n```\n正文', uncertainty: '[[not-a-relation]]', status: 'superseded', createdAt: 1 },
    { id: 'b', content: '另一条', status: 'active' }, { id: 'isolated', content: '孤立' }]
  const relation = { source: 'a', target: 'b', type: 'CONTINUES', key: 'one', status: 'active' }
  const snapshot = { notes, relations: [relation, relation, { ...relation, key: 'dangling', target: 'missing' }] }
  assert.equal((await mirror.sync(snapshot)).written, 3)
  const names = await filenames(root)
  const a = names.find(n => n.startsWith('标题'))
  const b = names.find(n => n.startsWith('另一条'))
  const text = await fs.readFile(path.join(root, a), 'utf8')
  assert(text.includes(`[[Aisling Memory/${b.slice(0, -3)}]]`))
  assert.equal(text.match(/- CONTINUES/g).length, 1)
  assert(!text.includes('missing'))
  assert(text.includes('status: "superseded"'))
  assert(text.includes('````\n标题 [[fake]]'))
  assert(!text.split('---')[1].includes('not-a-relation'))
  const stamp = (await fs.stat(path.join(root, a))).mtimeMs
  assert.equal((await mirror.sync(snapshot)).written, 0)
  assert.equal((await fs.stat(path.join(root, a))).mtimeMs, stamp)
  notes[0].content = '修改后的内容'
  assert.equal((await mirror.sync(snapshot)).written, 1)
  const beforeFailure = await fs.readFile(path.join(root, a), 'utf8')
  notes[0].content = '写入失败时保留旧文件'
  const rename = fs.rename
  fs.rename = async () => { throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' }) }
  try { await assert.rejects(mirror.sync(snapshot), { code: 'EACCES' }) }
  finally { fs.rename = rename }
  assert.equal(await fs.readFile(path.join(root, a), 'utf8'), beforeFailure)
  assert(!(await filenames(root)).some(n => n.endsWith('.tmp')))
  assert.deepEqual(await filenames(root), names)
  await fs.writeFile(path.join(root, a), (await fs.readFile(path.join(root, a), 'utf8')).replace('修改后的内容', '手动改动'))
  assert.equal((await mirror.sync(snapshot)).written, 1)
  relation.status = 'retracted'
  assert.equal((await mirror.sync(snapshot)).written, 1)
  assert(!(await fs.readFile(path.join(root, a), 'utf8')).includes('[[Aisling Memory/'))
  await fs.writeFile(path.join(root, 'manual.md'), 'keep')
  notes.splice(1, 1)
  assert.equal((await mirror.sync(snapshot)).removed, 1)
  assert.equal(await fs.readFile(path.join(root, 'manual.md'), 'utf8'), 'keep')
  assert.equal(await fs.readFile(path.join(vault, 'keep.md'), 'utf8'), 'outside')
  assert(!(await filenames(root)).some(n => n.endsWith('.tmp')))
})

test('polling retries failures and stops; missing vault and blocked target are isolated', { timeout: 5000 }, async () => {
  const { vault, root } = await fixture()
  await assert.rejects(createObsidianMirror(path.join(vault, 'missing')).sync({ notes: [], relations: [] }), { code: 'ENOENT' })
  await fs.writeFile(root, 'blocked')
  let failures = 0, reads = 0
  const stop = startObsidianMirror(async () => { reads++; return { notes: [], relations: [] } }, work => Promise.resolve().then(work), vault, () => failures++, 10)
  while (failures < 2) await delay(10)
  await fs.unlink(root)
  while (!(await fs.stat(root).catch(() => null))?.isDirectory()) await delay(10)
  await stop()
  const count = reads
  await delay(40)
  assert.equal(reads, count)
})

const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
test('real Ladybug worker startup, polling, relation removal, deletion, disable and shutdown', {
  skip: !resources && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES', timeout: 50000,
}, async () => {
  const { vault, root } = await fixture()
  const config = { node: path.join(resources, 'runtime/node.exe'), entry: path.join(resources, 'worker.cjs'), file: path.join(vault, 'note-v2.lbdb') }
  let worker = startWorker(config)
  const waitFor = async check => {
    for (let i = 0; i < 140; i++) { if (await check()) return; await delay(50) }
    assert.fail('Mirror did not converge within seven seconds')
  }
  const source = { sessionId: 'fixture', messageIndex: 0, digest: 'a'.repeat(64) }
  const add = content => ({ action: 'ADD', id: randomUUID(), operationId: randomUUID(), reason: 'test', sources: { evidence: [source] }, contextEvidence: [],
    meaning: { content, subject: 'fixture-user', kind: 'fact', basis: 'direct', eventTime: null } })
  try {
    await worker.ready
    await worker.request('configureMirror', [{ enabled: true, vault }])
    await waitFor(async () => (await fs.stat(root).catch(() => null))?.isDirectory())
    const first = add('第一条'), second = add('孤立节点')
    await worker.request('applyNoteOperation', [first])
    await worker.request('applyNoteOperation', [second])
    await waitFor(async () => (await filenames(root)).length === 2)
    const names = await filenames(root), a = names.find(n => n.startsWith('第一条'))
    const relation = { operationId: randomUUID(), action: 'LINK', from: first.id, to: second.id, fromVersion: 1, toVersion: 1,
      type: 'SUPPLEMENTS', basis: 'direct', order: 'unknown', reason: 'test', sources: { evidence: [source] } }
    await worker.request('applyRelationOperation', [relation])
    await waitFor(async () => (await fs.readFile(path.join(root, a), 'utf8')).includes('[[Aisling Memory/'))
    await worker.request('applyRelationOperation', [{ ...relation, action: 'UNLINK', operationId: randomUUID() }])
    await worker.request('applyNoteOperation', [{ ...first, action: 'UPDATE', operationId: randomUUID(), expectedVersion: 1, meaning: { ...first.meaning, content: '更新内容' } }])
    await waitFor(async () => {
      const text = await fs.readFile(path.join(root, a), 'utf8')
      return text.includes('更新内容') && !text.includes('[[Aisling Memory/')
    })
    await worker.request('eraseSources', [{ operationId: randomUUID(), evidence: [source], sessionIds: [] }])
    await waitFor(async () => (await filenames(root)).length === 0)
    await worker.close()
    worker = startWorker(config)
    await worker.ready
    const disabled = add('关闭后不导出')
    disabled.sources.evidence = [{ ...source, sessionId: 'independent-fixture' }]
    await worker.request('applyNoteOperation', [disabled])
    await delay(5200)
    assert.deepEqual(await filenames(root), [])
    await worker.close()
    worker = startWorker(config)
    await worker.ready
    await worker.request('configureMirror', [{ enabled: true, vault }])
    await waitFor(async () => (await filenames(root)).length === 1)
    const pid = worker.pid
    assert.equal((await worker.request('configureMirror', [{ enabled: false, vault }])).value.running, false)
    const whileStopped = add('动态关闭后新增')
    whileStopped.sources.evidence = [{ ...source, sessionId: 'dynamic-fixture' }]
    await worker.request('applyNoteOperation', [whileStopped])
    await delay(5200)
    assert.equal((await filenames(root)).length, 1)
    const target = await fixture()
    assert.equal((await worker.request('configureMirror', [{ enabled: true, vault: target.vault }])).value.running, true)
    await waitFor(async () => (await filenames(target.root).catch(() => [])).length === 2)
    assert.equal((await filenames(root)).length, 1)
    assert.equal(worker.pid, pid)
    assert.equal((await worker.request('configureMirror', [{ enabled: true, vault: 'https://invalid.example' }])).value.error, 'Invalid Obsidian vault.')
    assert.equal((await worker.request('getNoteV2', [whileStopped.id])).value.content, '动态关闭后新增')
    await worker.close()
    worker = startWorker(config)
    await worker.ready
    assert.equal((await worker.request('configureMirror', [{ enabled: true, vault: path.join(vault, 'missing-vault') }])).value.running, false)
    assert.equal((await worker.request('getNoteV2', [disabled.id])).value.content, '关闭后不导出')
  } finally {
    await worker.close()
  }
})
