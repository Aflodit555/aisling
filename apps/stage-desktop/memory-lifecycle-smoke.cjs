// Synthetic current-v2 IPC/erasure acceptance, including a Main crash after durable intent.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { app, ipcMain } = require('electron'), { startDesktop } = require('./desktop-app.cjs')
const [profile, resources, phase = 'erase'] = process.argv.slice(2)
const root = path.resolve(__dirname, '../../artifacts/memory-v0.4.0-p4b/tests')
assert(fs.realpathSync(profile).startsWith(root + path.sep))
assert.equal(fs.readFileSync(path.join(profile, '.privacy-test'), 'utf8'), 'aisling-p4b-synthetic\n')
assert(['erase', 'intent', 'resume'].includes(phase))
app.setPath('userData', profile); app.setPath('sessionData', profile); app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-networking')
delete process.env.TYPESAFE_API_KEY; delete process.env.AISLING_STAGE_URL
const timer = setTimeout(() => app.exit(2), 50000)
;(async () => {
  const win = await startDesktop({ show: false, diagnostics: false, noteV2: { resources } })
  const web = win.contentView.children[0].webContents; web.setBackgroundThrottling(false)
  const js = code => web.executeJavaScript(code)
  assert.equal(ipcMain.listenerCount('aisling:reflections:read'), 0)
  assert.equal(ipcMain.listenerCount('aisling:reflections:write'), 0)
  assert.equal(await js('Boolean(window.aislingDesktop.reflectionStorage || window.aislingDesktop.memoryOrganization || window.aislingDesktop.memoryMigration)'), false)
  for (let i = 0; i < 200; i++) { if (await js("Boolean(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('settings')?.loaded)")) break; await new Promise(r => setTimeout(r, 10)) }
  if (phase === 'intent') {
    const rename = fs.renameSync
    fs.renameSync = function (from, to) { rename(from, to); if (to === path.join(profile, 'memory-erasure.v1.json')) process.exit(74) }
    await js("window.aislingDesktop.storage.setItem('aisling.conversations.v1', JSON.stringify({sessions:[]}))")
    throw Error('Durable intent injection did not interrupt Main')
  }
  if (phase === 'erase') {
    const ordinary = await js(`(async()=>{
      const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia,stage=pinia._s.get('stage'),settings=pinia._s.get('settings');let request
      settings.activeChatProvider={id:'synthetic',complete:async input=>{request=input;return{text:'普通合成回复。'}}}
      stage.newConversation();stage.send('灯塔 private 和 public-retained 报告？')
      for(let i=0;i<500&&stage.sending;i++)await new Promise(r=>setTimeout(r,10))
      return{noArchivedInjection:!JSON.stringify(request).includes('NEVER-INJECT-ARCHIVE'),raw:JSON.stringify(request).includes('[Cross-session recall evidence]')}
    })()`)
    assert(ordinary.noArchivedInjection && ordinary.raw)
    const inflight = await js(`(async()=>{
      const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia,stage=pinia._s.get('stage'),settings=pinia._s.get('settings');let finish,calls=0
      const until=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('Current Formation deletion timeout')}
      settings.activeChatProvider={id:'deferred-note',complete:async request=>request.messages[0].content.startsWith('Note-only Formation')?(calls++,new Promise(r=>{finish=r})):{text:'合成回复。'}}
      await settings.setMemoryFormationEnabled(true);stage.newConversation();const id=stage.activeSessionId
      stage.send('灯塔 inflight-private 观察。');await until(()=>!stage.sending)
      await window.aislingDesktop.noteFormation.flush(id);stage.wakeFormation();await until(()=>calls===1)
      stage.deleteSession(id);finish({text:'{"items":[]}'})
      await until(()=>!JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions.some(s=>s.id===id))
      await settings.setMemoryFormationEnabled(false)
      const status=await window.aislingDesktop.noteReview.list()
      return{id,calls,lateOutputIgnored:status.formation.batches.every(b=>!['running','settling'].includes(b.status)),sourceDeleted:!JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions.some(s=>s.id===id)}
    })()`)
    assert.equal(inflight.calls, 1); assert(inflight.lateOutputIgnored && inflight.sourceDeleted)
    assert(!JSON.parse(fs.readFileSync(path.join(profile, 'note-formation-jobs.v1.json'), 'utf8')).batches.some(b => b.sessionId === inflight.id))
    assert.equal(await js("window.aislingDesktop.storage.setItem('aisling.conversations.v1',JSON.stringify({sessions:JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions.filter(s=>s.id!=='source-a')}))"), true)
  }
  let snapshot
  for (let i = 0; i < 600; i++) {
    try { snapshot = await js('window.aislingDesktop.noteRecall.snapshot()'); if (snapshot.reason === 'ready' && snapshot.notes.every(n => !n.note.content.includes('source-private'))) break } catch {}
    await new Promise(r => setTimeout(r, 10))
  }
  assert(snapshot?.notes.every(n => !n.note.content.includes('source-private')))
  const raw = JSON.parse(JSON.parse(fs.readFileSync(path.join(profile, 'aisling-store.json'), 'utf8'))['aisling.conversations.v1'])
  assert(!raw.sessions.some(s => s.id === 'source-a'))
  const archive = path.join(profile, 'legacy-profile-archive')
  assert(!JSON.parse(fs.readFileSync(path.join(archive, 'aisling-reflections.v1.json'), 'utf8')).reflections.some(r => r.id === 'private-origin'))
  assert(!JSON.parse(JSON.parse(fs.readFileSync(path.join(archive, 'aisling-store.json'), 'utf8'))['aisling.conversations.v1']).sessions.some(s => s.id === 'source-a'))
  const replay = JSON.parse(fs.readFileSync(path.join(profile, 'fixture.private.json'), 'utf8')).data['aisling.conversations.v1']
  await js('window.aislingDesktop.storage.setItem("aisling.conversations.v1",' + JSON.stringify(replay) + ')')
  assert.equal(await js("JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions.some(s=>s.id==='source-a')"), false)
  let journal
  for (let i = 0; i < 600; i++) {
    journal = JSON.parse(fs.readFileSync(path.join(profile, 'memory-erasure.v1.json'), 'utf8'))
    if (!journal.pending.length) break
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(journal.pending.length, 0)
  console.log(JSON.stringify({ result: 'p4b-privacy-passed', phase, noReflectionBridge: true, sourceNotResurrected: true, archiveErased: true }))
  clearTimeout(timer); app.quit()
})().catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
