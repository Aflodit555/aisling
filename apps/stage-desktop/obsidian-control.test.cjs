const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { mirrorConfig, openObsidian } = require('./obsidian-control.cjs')
const { createObsidianMirror, noteTitle } = require('./memory-database/obsidian-mirror.cjs')
const hash = id => createHash('sha256').update(id).digest('hex')
async function fixture() {
  const root = path.resolve(__dirname, '../../artifacts/obsidian-control')
  await fs.mkdir(root, { recursive: true })
  return fs.mkdtemp(path.join(root, 'test-'))
}
test('content titles are literal and short; empty and unsafe characters have safe fallbacks', () => {
  assert.equal(noteTitle('用户报告：已经购买手碟。'), '已经购买手碟')
  assert.equal(noteTitle('用户问询：PDF 如何导出？'), 'PDF 如何导出')
  assert.equal(noteTitle('[[<>:"/\\|?*]]'), 'Note')
  assert.equal(Array.from(noteTitle('😀'.repeat(50))).length, 16)
})
test('legacy migration recovers after interruption, updates links and preserves user collisions', async () => {
  const vault = await fixture(), root = path.join(vault, 'Aisling Memory')
  await fs.mkdir(root)
  const notes = [{ id: 'a', subject: 'not-a-title', content: '用户报告：已经购买手碟。', status: 'superseded' }, { id: 'b', content: '孤立节点', status: 'retracted' }]
  const old = notes.map(n => `${n.content.slice(0,4)}--${hash(n.id)}.md`)
  for (let i=0;i<notes.length;i++) await fs.writeFile(path.join(root, old[i]), `---\naisling_mirror: "v1"\nnote_id: ${JSON.stringify(notes[i].id)}\n---\nold [[${old[1]}]]`)
  const user = `${noteTitle(notes[0].content)}-${hash('a').slice(0,10)}.md`
  await fs.writeFile(path.join(root, user), 'user-created')
  const snapshot = { notes, relations: [{ source: 'a', target: 'b', type: 'SUPPLEMENTS', status: 'active', key: 'one' }] }
  const mirror = createObsidianMirror(vault)
  const rename = fs.rename
  let calls = 0
  fs.rename = async (...args) => { if (++calls === 2) throw new Error('interrupted migration'); return rename(...args) }
  try { await assert.rejects(mirror.sync(snapshot), /interrupted/) } finally { fs.rename = rename }
  await mirror.sync(snapshot)
  const names = await fs.readdir(root)
  assert.equal(names.length, 3)
  assert(names.every(n => !old.includes(n)))
  assert.equal(await fs.readFile(path.join(root,user),'utf8'), 'user-created')
  const managed = []
  for(const name of names) if(name!==user) managed.push({name,text:await fs.readFile(path.join(root,name),'utf8')})
  assert(managed.every(n=>/-[a-f0-9]{10,12}\.md$/.test(n.name)))
  const a = managed.find(n=>n.text.includes('note_id: "a"'))
  const b = managed.find(n=>n.text.includes('note_id: "b"'))
  assert(a.text.includes(`[[Aisling Memory/${b.name.slice(0,-3)}]]`))
  assert(a.name.startsWith('已经购买手碟-'))
  assert.equal((await mirror.sync(snapshot)).written,0)
  notes[0].content='更正后的正文'
  await mirror.sync(snapshot)
  assert.deepEqual(await fs.readdir(root),names)
})
test('saved config restores; safe opening uses only a registered vault ID', async () => {
  const vault=await fixture(), registry=path.join(vault,'registry.json'), id='0123456789abcdef'
  const saved={memory:{obsidianMirror:{enabled:false,vault}}}
  assert.deepEqual(mirrorConfig(JSON.parse(JSON.stringify(saved))),{enabled:false,vault})
  assert.equal(mirrorConfig(null).enabled,false)
  await fs.writeFile(registry,JSON.stringify({vaults:{[id]:{path:vault}}}))
  const calls=[]
  assert.equal((await openObsidian(vault,registry,async uri=>calls.push(uri))).error,'')
  assert.deepEqual(calls,[`obsidian://open?vault=${id}`])
  assert((await openObsidian('https://evil.invalid',registry,async()=>assert.fail())).error)
  assert((await openObsidian(vault,registry,async()=>{throw new Error('not installed')})).error)
  await fs.writeFile(registry,'{}')
  assert.equal((await openObsidian(vault,registry,async()=>assert.fail())).error,'Open this vault in Obsidian first.')
})

test('service restores the saved mirror independently of Formation and Recall, isolating invalid paths', {
  skip: !process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES && 'Set AISLING_MEMORY_DB_P0_TEST_RESOURCES', timeout: 15000,
}, async () => {
  const { createNoteFormationService } = require('./note-formation.cjs')
  const profile = await fixture(), vault = await fixture()
  let data = {}
  const options = { profile, resources: process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES,
    readData: () => data, writeData: value => {data=value}, consent: () => false, recallConsent: () => false }
  const saved = {memory:{obsidianMirror:{enabled:true,vault}}}
  let service = createNoteFormationService(options)
  try {
    assert.equal((await service.configureMirror(mirrorConfig(saved))).running,true)
    assert.equal((await service.configureMirror({enabled:true,vault:''})).error,'Invalid Obsidian vault.')
    await service.recover()
    assert.equal((await service.configureMirror(mirrorConfig(saved))).running,true)
    await service.close()
    service = createNoteFormationService(options)
    assert.equal((await service.configureMirror(mirrorConfig(JSON.parse(JSON.stringify(saved))))).running,true)
    assert.equal((await service.configureMirror({enabled:false,vault})).running,false)
    await service.recover()
  } finally {await service.close()}
})
