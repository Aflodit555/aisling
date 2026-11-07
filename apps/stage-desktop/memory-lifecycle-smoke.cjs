// P1.7a real application/IPC/Main/Worker acceptance; all data and profile paths are synthetic.
const {app}=require('electron')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {startDesktop}=require('./desktop-app.cjs')
const {createMemoryDatabaseStore}=require('./memory-database/store.cjs')
app.disableHardwareAcceleration();delete process.env.AISLING_STAGE_URL;delete process.env.TYPESAFE_API_KEY
const root=path.resolve(__dirname,'../../artifacts/memory-organization-p17');fs.mkdirSync(root,{recursive:true})
const profile=fs.mkdtempSync(path.join(root,'electron-a-'));app.setPath('userData',profile)
const timer=setTimeout(()=>{console.error('P1.7a smoke timeout');app.exit(1)},60000)
;(async()=>{
 const win=await startDesktop({show:false,diagnostics:false}),contents=win.contentView.children[0].webContents
 contents.setBackgroundThrottling(false)
 const sourceA={role:'user',content:'灯塔 source-private 报告。',createdAt:1},sourceB={role:'user',content:'灯塔 public-retained 报告。',createdAt:2}
 const reference=(sessionId,m)=>({sessionId,messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')})
 const a=reference('source-a',sourceA),b=reference('source-b',sourceB),ra=randomUUID(),rb=randomUUID(),batch=randomUUID()
 const conversation={sessions:[{id:'source-a',title:'private',createdAt:1,updatedAt:1,messages:[sourceA]},{id:'source-b',title:'retained',createdAt:2,updatedAt:2,messages:[sourceB]}],activeId:'source-b'}
 const add=(content,refs,rid)=>({action:'ADD',id:randomUUID(),operationId:randomUUID(),reason:'synthetic fixture',meaning:{content,subject:'灯塔',eventTime:null,basis:'direct',tags:['灯塔']},sources:{origins:[{reflectionId:rid}],evidence:refs}})
 const privateNote=add('candidate-private',[a,b],ra),retainedNote=add('public-retained',[b],rb)
 const r=(id,content,refs)=>({version:1,id,content:'灯塔 '+content,kind:'fact',basis:'direct',tags:['灯塔'],sourceRefs:refs,relatedReflectionIds:[],createdAt:1})
 const reflections={version:1,progress:[],reflections:[r(ra,'candidate-private',[a,b]),r(rb,'public-retained',[b])],batches:[
  {id:batch,sessionId:'source-a',sourceRefs:[a,b],units:3,status:'completed',attempts:1,reflectionIds:[ra],organization:{version:1,settled:true,items:[{action:'ADD',reflectionId:ra,operation:privateNote,draft:privateNote.meaning,status:'proposed-not-applied',reason:'review'}]}},
  {id:'legacy-batch',sessionId:'source-b',sourceRefs:[b],units:3,status:'completed',attempts:1,reflectionIds:[rb]},
 ]}
 const initialized=await contents.executeJavaScript(`(async()=>{
  for(let i=0;i<200;i++){const p=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia;if(p?._s.get('settings')?.loaded)break;await new Promise(r=>setTimeout(r,10))}
  const bridge=window.aislingDesktop
  return {conversation:bridge.storage.setItem('aisling.conversations.v1',${JSON.stringify(JSON.stringify(conversation))}),reflection:bridge.reflectionStorage.write(${JSON.stringify(JSON.stringify(reflections))})}
 })()`)
 assert(initialized.conversation&&initialized.reflection)
 const resources=process.env.AISLING_MEMORY_DB_P0_RESOURCES
 fs.mkdirSync(path.join(profile,'memory-organization'),{recursive:true})
 const store=createMemoryDatabaseStore(async()=>({node:path.join(resources,'runtime/node.exe'),entry:path.join(resources,'worker.cjs'),file:path.join(profile,'memory-organization/note-v1.lbdb')}),()=>{})
 await store.open();await store.applyNoteOperation(privateNote);await store.applyNoteOperation(retainedNote);await store.close()
 await contents.loadURL('aisling://stage/settings/memory')
 const qualification=await contents.executeJavaScript(`(async()=>{
  for(let i=0;i<200;i++){const p=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia;if(p?._s.get('stage')&&p._s.get('settings')?.loaded)break;await new Promise(r=>setTimeout(r,10))}
  const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia,stage=pinia._s.get('stage'),settings=pinia._s.get('settings');let request
  settings.activeChatProvider={id:'offline',complete:async r=>{request=r;return {text:'收到'}}}
  stage.send('灯塔 private 与 public-retained 报告？');for(let i=0;i<300&&stage.sending;i++)await new Promise(r=>setTimeout(r,10))
  const block=request.messages.find(m=>m.content?.startsWith('[Historical Aisling reflections]'))?.content??''
  return {candidateExcluded:!block.includes('candidate-private'),legacyIncluded:block.includes('public-retained'),calls:stage.formationStatus.calls}
 })()`)
 assert(qualification.candidateExcluded);assert(qualification.legacyIncluded);assert.equal(qualification.calls,0)
 const concurrent=await contents.executeJavaScript(`(async()=>{
  const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia,stage=pinia._s.get('stage'),settings=pinia._s.get('settings');let finish,calls=0
  const until=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw new Error('concurrent erasure timeout')}
  settings.activeChatProvider={id:'deferred-C',complete:async request=>{
   if(request.messages[0]?.content?.startsWith('Form atomic candidates')){calls++;return new Promise(resolve=>{finish=resolve})}
   return {text:'已收到'}
  }}
  await settings.setMemoryOrganizationEnabled(true);await until(()=>stage.organizationStatus.ready&&stage.formationStatus.lastEvent==='ready')
  stage.newConversation();const sessionId=stage.activeSessionId
  for(let i=0;i<3;i++){stage.send('灯塔 inflight-private 观察。');await until(()=>!stage.sending)}
  await until(()=>calls===1)
  stage.deleteSession(sessionId)
  finish({text:JSON.stringify({items:[]})})
  await until(()=>!stage.formationStatus.running&&window.aislingDesktop.reflectionStorage.read().ok)
  await settings.setMemoryOrganizationEnabled(false);await window.aislingDesktop.memoryOrganization.setEnabled(false)
  const state=JSON.parse(window.aislingDesktop.reflectionStorage.read().value)
  return {calls,lateOutputIgnored:!state.batches.some(b=>b.sessionId===sessionId),sourceDeleted:!JSON.parse(window.aislingDesktop.storage.getItem('aisling.conversations.v1')).sessions.some(s=>s.id===sessionId)}
 })()`)
 assert.equal(concurrent.calls,1);assert(concurrent.lateOutputIgnored&&concurrent.sourceDeleted)
 const deletion=await contents.executeJavaScript(`(async()=>{
  const b=window.aislingDesktop,current=JSON.parse(b.storage.getItem('aisling.conversations.v1'));current.sessions=current.sessions.filter(s=>s.id!=='source-a')
  const saved=b.storage.setItem('aisling.conversations.v1',JSON.stringify(current)),initial=b.reflectionStorage.read()
  for(let i=0;i<1000;i++){const r=b.reflectionStorage.read();if(r.ok&&!JSON.parse(r.value).reflections.some(v=>v.id===${JSON.stringify(ra)}))break;await new Promise(r=>setTimeout(r,10))}
  await b.memoryOrganization.setEnabled(false)
  const state=JSON.parse(b.reflectionStorage.read().value)
  const late=b.reflectionStorage.write(${JSON.stringify(JSON.stringify(reflections))})
  const replay=b.storage.setItem('aisling.conversations.v1',${JSON.stringify(JSON.stringify(conversation))})
  await b.memoryOrganization.setEnabled(false)
  for(let i=0;i<1000&&!b.reflectionStorage.read().ok;i++)await new Promise(r=>setTimeout(r,10))
  return {saved,initialBlocked:!initial.ok,reflections:state.reflections.map(r=>r.id),lateGenerationRejected:late===false,sourceNotResurrected:!JSON.parse(b.storage.getItem('aisling.conversations.v1')).sessions.some(s=>s.id==='source-a'),replay}
 })()`)
 assert(deletion.saved);assert(deletion.initialBlocked);assert(deletion.lateGenerationRejected);assert(deletion.sourceNotResurrected)
 assert.deepEqual(deletion.reflections,[rb])
 await store.open()
 assert.equal(await store.getNoteV1(privateNote.id),null);assert.equal(await store.getRevision(privateNote.id,1),null);assert.equal(await store.getOperationReceipt(privateNote.operationId),null)
 assert.equal((await store.getNoteV1(retainedNote.id)).content,'public-retained')
 await assert.rejects(store.applyNoteOperation(privateNote),{code:'erased'})
 await store.close()
 console.log(JSON.stringify({result:'p17a-electron-passed',profile,qualification,concurrent,deletion,privateNoteErased:true,retainedSharedSource:true,oldOperationBlocked:true}))
 clearTimeout(timer);app.quit()
})().catch(e=>{console.error(e);clearTimeout(timer);app.exit(1)})
