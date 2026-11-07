const {app}=require('electron')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {startDesktop}=require('./desktop-app.cjs')
const {createMemoryDatabaseStore}=require('./memory-database/store.cjs')
const directory=process.env.AISLING_P17_RESTART_ROOT,phase=process.env.AISLING_P17_RESTART_PHASE
const allowed=path.resolve(__dirname,'../../artifacts/memory-organization-p17')
assert(directory&&!path.relative(allowed,directory).startsWith('..')&&fs.readFileSync(path.join(directory,'synthetic-test'),'utf8')==='P1.7 synthetic')
const profile=path.join(directory,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile)
app.disableHardwareAcceleration();delete process.env.AISLING_STAGE_URL;delete process.env.TYPESAFE_API_KEY
const timer=setTimeout(()=>{console.error('P1.7 restart timeout');app.exit(1)},50000)
;(async()=>{
 const win=await startDesktop({show:false,diagnostics:false}),contents=win.contentView.children[0].webContents
 const resources=process.env.AISLING_MEMORY_DB_P0_RESOURCES
 const dbDirectory=path.join(profile,'memory-organization');fs.mkdirSync(dbDirectory,{recursive:true})
 const store=createMemoryDatabaseStore(async()=>({node:path.join(resources,'runtime/node.exe'),entry:path.join(resources,'worker.cjs'),file:path.join(dbDirectory,'note-v1.lbdb')}),()=>{})
 if(phase==='intent'){
  const m={role:'user',content:'restart-private-marker',createdAt:1},ref={sessionId:'restart-source',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')},rid=randomUUID()
  const op={action:'ADD',id:randomUUID(),operationId:randomUUID(),reason:'restart fixture',meaning:{content:m.content,subject:'profile-user',basis:'direct',eventTime:null},sources:{origins:[{reflectionId:rid}],evidence:[ref]}}
  const state={version:1,progress:[],reflections:[{version:1,id:rid,content:m.content,kind:'fact',basis:'direct',tags:['synthetic'],sourceRefs:[ref],relatedReflectionIds:[],createdAt:1}],batches:[{id:'restart-batch',sessionId:'restart-source',sourceRefs:[ref],units:3,status:'completed',attempts:1,reflectionIds:[rid]}]}
  await contents.executeJavaScript(`window.aislingDesktop.storage.setItem('aisling.conversations.v1',${JSON.stringify(JSON.stringify({sessions:[{id:'restart-source',title:m.content,messages:[m]}]}))});window.aislingDesktop.reflectionStorage.write(${JSON.stringify(JSON.stringify(state))})`)
  await store.open();await store.applyNoteOperation(op);await store.close();fs.writeFileSync(path.join(directory,'fixture.json'),JSON.stringify({op,state}))
  const rename=fs.renameSync
  fs.renameSync=function(from,to){rename(from,to);if(to===path.join(profile,'memory-erasure.v1.json'))process.exit(74)}
  await contents.executeJavaScript("window.aislingDesktop.storage.setItem('aisling.conversations.v1',JSON.stringify({sessions:[]}))")
  throw new Error('Fault injection did not terminate Main')
 }
 assert.equal(phase,'resume')
 const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')))
 const result=await contents.executeJavaScript(`(async()=>{
  const bridge=window.aislingDesktop
  for(let i=0;i<1500;i++){const r=bridge.reflectionStorage.read();if(r.ok&&!JSON.parse(r.value).reflections.length)break;await new Promise(r=>setTimeout(r,10))}
  await bridge.memoryOrganization.setEnabled(false)
  const sources=JSON.parse(bridge.storage.getItem('aisling.conversations.v1'))
  return {sourceAbsent:!sources.sessions.some(s=>s.id==='restart-source'),reflectionAbsent:!JSON.parse(bridge.reflectionStorage.read().value).reflections.length,lateRejected:!bridge.reflectionStorage.write(${JSON.stringify(JSON.stringify(fixture.state))})}
 })()`)
 assert(result.sourceAbsent&&result.reflectionAbsent&&result.lateRejected)
 await store.open();assert.equal(await store.getNoteV1(fixture.op.id),null);assert.equal(await store.getRevision(fixture.op.id,1),null);assert.equal(await store.getOperationReceipt(fixture.op.operationId),null)
 await assert.rejects(store.applyNoteOperation(fixture.op),{code:'erased'});await store.close()
 const journal=fs.readFileSync(path.join(profile,'memory-erasure.v1.json'),'utf8');assert(!journal.includes('restart-private-marker'));assert.equal(JSON.parse(journal).pending.length,0)
 console.log(JSON.stringify({result:'p17a-main-restart-passed',profile,...result,oldOperationBlocked:true,pendingCleared:true}))
 clearTimeout(timer);app.quit()
})().catch(e=>{console.error(e);clearTimeout(timer);app.exit(1)})
