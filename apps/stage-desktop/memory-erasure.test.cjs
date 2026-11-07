const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {createMemoryDatabaseStore}=require('./memory-database/store.cjs')
const {startWorker}=require('./memory-database/client.cjs')
const {createMemoryLifecycle}=require('./memory-lifecycle.cjs')
const resources=process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const ref=(s,i=0)=>({sessionId:s,messageIndex:i,digest:'a'.repeat(64)})
const origin=id=>({reflectionId:id})
const operation=(content,refs,origins=[origin(randomUUID())])=>({action:'ADD',id:randomUUID(),operationId:randomUUID(),reason:'synthetic '+content,meaning:{content,subject:'synthetic',eventTime:null,basis:'direct'},sources:{origins,evidence:refs}})
const scope=(evidence=[],sessionIds=[],originIds=[])=>({operationId:randomUUID(),evidence,sessionIds,originIds})
test('Main speaker qualification never grants a new project identity or upgrades promises/plans to external facts',()=>{
 const {speakerQualification}=require('./memory-write-policy.cjs')
 const user={role:'user',content:'我计划明天维修风扇，尚未执行。'},speech={content:'用户陈述：'+user.content,subject:'profile-user',eventTime:null,basis:'direct'}
 assert.equal(speakerQualification({draft:speech},{content:speech.content,basis:'direct',kind:'event'},[user]),null)
 assert.equal(speakerQualification({draft:{...speech,subject:'新风扇'}},{content:speech.content,basis:'direct',kind:'event'},[user]),'subject-needs-review')
 assert.equal(speakerQualification({draft:speech},{content:speech.content,basis:'direct',kind:'fact'},[user]),'source-category-review')
 assert.equal(speakerQualification({draft:{...speech,eventTime:{kind:'date',date:'2026-01-01'}}},{content:speech.content,basis:'direct',kind:'event'},[user]),'time-or-inference-review')
 const assistant={role:'assistant',content:'我答应寄送，但尚未寄送。'},a={...speech,subject:'aisling',content:'Aisling 发言：'+assistant.content}
 assert.equal(speakerQualification({draft:a},{content:a.content,basis:'direct',kind:'event'},[assistant]),null)
 assert.equal(speakerQualification({draft:a},{content:a.content,basis:'direct',kind:'fact'},[assistant]),'source-category-review')
})
async function fixture(){
 const root=path.resolve(__dirname,'../../artifacts/memory-organization-p17');fs.mkdirSync(root,{recursive:true})
 const directory=fs.mkdtempSync(path.join(root,'erase-')),config={node:path.join(resources,'runtime/node.exe'),entry:path.join(resources,'worker.cjs'),file:path.join(directory,'note-v1.lbdb')}
 const store=createMemoryDatabaseStore(async()=>config,()=>{});await store.open();return {store,config,directory}
}
test('shared evidence, multiple Notes and multi-source Notes erase all dependent records but retain unrelated shared endpoints',{skip:!resources,timeout:30000},async()=>{
 const {store}=await fixture()
 try{
  const a=ref('removed'),b=ref('retained'),sharedOrigin=origin('shared-retained-origin')
  const first=operation('private-one',[a]),second=operation('private-two',[a]),multi=operation('private-multi',[a,b],[sharedOrigin]),retained=operation('public-retained',[b],[sharedOrigin])
  for(const op of [first,second,multi,retained])await store.applyNoteOperation(op)
  const erase=scope([a]);const receipt=await store.eraseSources(erase)
  assert.equal(receipt.notes,3);assert.equal(receipt.operations,3)
  assert.deepEqual(await store.eraseSources(erase),receipt)
  for(const op of [first,second,multi]){
   assert.equal(await store.getNoteV1(op.id),null);assert.equal(await store.getRevision(op.id,1),null);assert.equal(await store.getOperationReceipt(op.operationId),null)
   await assert.rejects(store.applyNoteOperation(op),{code:'erased'})
  }
  assert.equal((await store.getNoteV1(retained.id)).content,'public-retained')
  await assert.rejects(store.applyNoteOperation({...first,id:randomUUID(),operationId:randomUUID()}),{code:'erased'})
  assert.equal((await store.listNoteHeads()).notes.length,1)
  assert.equal((await store.erasedNoteIds(erase.operationId)).ids.length,3)
 }finally{await store.close()}
})
test('historical Revision and NOOP supplemental evidence are dependencies; every receipt and version disappears',{skip:!resources,timeout:30000},async()=>{
 const {store}=await fixture()
 try{
  const add=operation('old-private',[ref('old')]);await store.applyNoteOperation(add)
  const update={...add,action:'UPDATE',operationId:randomUUID(),expectedVersion:1,meaning:{...add.meaning,content:'new-private'},sources:{origins:[origin('updated-origin')],evidence:[ref('new')]}}
  await store.applyNoteOperation(update)
  const noop={action:'NOOP',id:add.id,operationId:randomUUID(),expectedVersion:2,reason:'private supplement',sources:{origins:[],evidence:[ref('supplement')]}}
  await store.applyNoteOperation(noop)
  const erased=await store.eraseSources(scope([],['supplement']))
  assert.equal(erased.notes,1);assert.equal(erased.operations,3)
  for(const v of [1,2])assert.equal(await store.getRevision(add.id,v),null)
  assert.deepEqual((await store.getVersionSourceChanges(add.id,2)).changes,[])
  for(const op of [add,update,noop]){assert.equal(await store.getOperationReceipt(op.operationId),null);await assert.rejects(store.applyNoteOperation(op),{code:'erased'})}
 }finally{await store.close()}
})
test('SUPERSEDE lifecycle closure removes both endpoints without touching an independent Note',{skip:!resources,timeout:30000},async()=>{
 const {store}=await fixture()
 try{
  const add=operation('before-private',[ref('before')]);await store.applyNoteOperation(add)
  const sup={...add,action:'SUPERSEDE',newId:randomUUID(),operationId:randomUUID(),expectedVersion:1,transition:'explicit-same-scope-change',meaning:{...add.meaning,content:'after-private'},sources:{origins:[origin('after-origin')],evidence:[ref('after')]}}
  await store.applyNoteOperation(sup)
  const kept=operation('independent',[ref('after')]);await store.applyNoteOperation(kept)
  assert.equal((await store.eraseSources(scope([],['before']))).notes,2)
  assert.equal(await store.getNoteV1(add.id),null);assert.equal(await store.getNoteV1(sup.newId),null)
  assert.equal(await store.getOperationReceipt(sup.operationId),null)
  assert.equal((await store.getNoteV1(kept.id)).content,'independent')
 }finally{await store.close()}
})
test('durable intent blocks reads immediately and completes source/JSON/DB cleanup after restart without journaling bodies',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),message={role:'user',content:'private-marker-intent'}
 const r={sessionId:'source',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(message)).digest('hex')}
 const add=operation(message.content,[r],[origin('real-formation')]);await store.applyNoteOperation(add)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'source',messages:[message]}]})}
 let state={version:1,progress:[],reflections:[{id:'real-formation',content:message.content,sourceRefs:[r],relatedReflectionIds:[]}],batches:[{id:'batch',sourceRefs:[r],reflectionIds:['real-formation'],organization:{items:[{operation:add}],settled:false}}]}
 const options={profile:directory,store,readData:()=>structuredClone(data),writeData:v=>{data=v},readReflections:()=>structuredClone(state),writeReflections:v=>{state=v}}
 const first=createMemoryLifecycle(options)
 first.beforeConversationChange(data,{'aisling.conversations.v1':JSON.stringify({sessions:[]})})
 assert.throws(()=>first.assertReadable(),/erasure-pending/)
 assert(!fs.readFileSync(path.join(directory,'memory-erasure.v1.json'),'utf8').includes(message.content))
 // Simulated process loss before the source write: recreate coordinator from disk, not an in-memory Set.
 const recovered=createMemoryLifecycle(options);await recovered.recover()
 assert.equal(recovered.pending(),false);assert.equal(JSON.parse(data['aisling.conversations.v1']).sessions.length,0)
 assert.equal(state.reflections.length,0);assert.equal(state.batches.length,0)
 assert.equal(await store.getNoteV1(add.id),null)
 await assert.rejects(store.applyNoteOperation(add),{code:'erased'})
 assert.throws(()=>recovered.validateWrite({version:1,progress:[],reflections:[],batches:[{id:'batch',sourceRefs:[r],reflectionIds:[]}]}),/erased-generation/)
 await store.close()
})
test('real Worker death inside erasure rolls back; restart replays the stable erase request and then rejects old operations',{skip:!resources,timeout:45000},async()=>{
 const {store,config}=await fixture();const add=operation('crash-private',[ref('crash-source')]);await store.applyNoteOperation(add);await store.close()
 const entry=path.join(resources,'erase-crash-worker.cjs')
 fs.writeFileSync(entry,"const fs=require('node:fs'),Module=require('node:module');const file=require.resolve('./adapter.cjs');const m=new Module(file,module);m.filename=file;m.paths=module.paths;m._compile(fs.readFileSync(file,'utf8').replace('async function query(statement, params = undefined) {',\"async function query(statement, params = undefined) { if(statement.includes('DETACH DELETE'))process.exit(72);\"),file);require.cache[file]=m;require('./worker.cjs')")
 const erase=scope([],['crash-source']),worker=startWorker({...config,entry})
 try{await worker.ready;await assert.rejects(worker.request('eraseSources',[erase]),{code:'outcome-unknown'})}finally{await worker.close().catch(()=>{})}
 await store.open()
 try{await store.eraseSources(erase);assert.equal(await store.getNoteV1(add.id),null);assert.equal(await store.getOperationReceipt(add.operationId),null);await assert.rejects(store.applyNoteOperation(add),{code:'erased'})}finally{await store.close()}
})

test('a single edited message erases only its dependents, resets a derived title and cannot be restored from an old source snapshot',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),old={role:'user',content:'single-private-marker'},kept={role:'user',content:'retained-source'}
 const r=(m,i)=>({sessionId:'same-session',messageIndex:i,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')})
 const a=r(old,0),b=r(kept,1),first=operation(old.content,[a],[origin('first')]),second=operation(kept.content,[b],[origin('second')])
 await store.applyNoteOperation(first);await store.applyNoteOperation(second)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'same-session',title:old.content,messages:[old,kept]}]})}
 let state={version:1,progress:[],reflections:[{id:'first',content:old.content,sourceRefs:[a],relatedReflectionIds:[]},{id:'second',content:kept.content,sourceRefs:[b],relatedReflectionIds:[]}],batches:[]}
 const options={profile:directory,store,readData:()=>structuredClone(data),writeData:v=>{data=v},readReflections:()=>structuredClone(state),writeReflections:v=>{state=v}}
 const privacy=createMemoryLifecycle(options),next=structuredClone(data),parsed=JSON.parse(next['aisling.conversations.v1']);parsed.sessions[0].messages[0]={role:'user',content:'replacement'};next['aisling.conversations.v1']=JSON.stringify(parsed)
 privacy.beforeConversationChange(data,next);data=next;await privacy.recover()
 assert.equal(await store.getNoteV1(first.id),null);assert.equal((await store.getNoteV1(second.id)).content,kept.content)
 assert.equal(JSON.parse(data['aisling.conversations.v1']).sessions[0].title,'New conversation')
 const stale={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'same-session',title:old.content,messages:[old,kept]}]})}
 assert.equal(JSON.parse(privacy.sanitizedData(stale)['aisling.conversations.v1']).sessions[0].messages[0].content,null)
 await store.close()
})

test('deleting historical grounds also erases C descendants which used the affected Note as model context',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),ma={role:'user',content:'history-private'},mb={role:'user',content:'current-source'}
 const r=(id,m)=>({sessionId:id,messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')})
 const a=r('old',ma),b=r('new',mb),first=operation(ma.content,[a],[origin('old-origin')]);await store.applyNoteOperation(first)
 await store.applyNoteOperation({...first,action:'UPDATE',operationId:randomUUID(),expectedVersion:1,meaning:{...first.meaning,content:'updated'},sources:{origins:[origin('current-origin')],evidence:[b]}})
 const derived=operation('derived-private',[b],[origin('derived-origin')]);await store.applyNoteOperation(derived)
 const independent=operation('independent-public',[b],[origin('independent-origin')]);await store.applyNoteOperation(independent)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'old',messages:[ma]},{id:'new',messages:[mb]}]})}
 const rf=(id,refs)=>({id,content:id,sourceRefs:refs,relatedReflectionIds:[]})
 let state={version:1,progress:[],reflections:[rf('old-origin',[a]),rf('current-origin',[b]),rf('derived-origin',[b]),rf('independent-origin',[b])],batches:[{id:'derived-batch',sourceRefs:[b],reflectionIds:['derived-origin'],organization:{contextSources:[b],contextNoteIds:[first.id],items:[],settled:true}}]}
 const privacy=createMemoryLifecycle({profile:directory,store,readData:()=>structuredClone(data),writeData:v=>{data=v},readReflections:()=>structuredClone(state),writeReflections:v=>{state=v}})
 const next={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'new',messages:[mb]}]})};privacy.beforeConversationChange(data,next);data=next;await privacy.recover()
 assert.equal(await store.getNoteV1(first.id),null);assert.equal(await store.getNoteV1(derived.id),null)
 assert.equal((await store.getNoteV1(independent.id)).content,'independent-public')
 assert(!state.reflections.some(r=>r.id==='derived-origin'));assert.equal(privacy.pending(),false)
 await store.close()
})

test('failed cleanup stays unreadable and resumes the same persistent request without automatic retry',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),m={role:'user',content:'failed-cleanup-private'},r={sessionId:'failed',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')},op=operation(m.content,[r],[origin('failed-origin')])
 await store.applyNoteOperation(op)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'failed',messages:[m]}]})},state={version:1,progress:[],batches:[],reflections:[{id:'failed-origin',content:m.content,sourceRefs:[r],relatedReflectionIds:[]}]}
 const options={profile:directory,store,readData:()=>data,writeData:v=>{data=v},readReflections:()=>state,writeReflections:v=>{state=v}}
 const privacy=createMemoryLifecycle(options),next={'aisling.conversations.v1':JSON.stringify({sessions:[]})}
 privacy.beforeConversationChange(data,next);data=next
 const requestId=privacy.readJournal().pending[0].steps[0].operationId,original=store.eraseSources;let attempts=0
 store.eraseSources=async()=>{attempts++;throw new Error('synthetic-worker-unavailable')}
 await assert.rejects(privacy.recover(),/synthetic-worker-unavailable/)
 assert.equal(attempts,1);assert(privacy.pending());assert.throws(()=>privacy.guardedReflections(),/erasure-pending/)
 store.eraseSources=original
 const restart=createMemoryLifecycle(options);assert.equal(restart.readJournal().pending[0].steps[0].operationId,requestId);await restart.recover()
 assert(!restart.pending());assert.equal(await store.getNoteV1(op.id),null);await store.close()
})

test('missing DB still records permanent barriers; later DB creation cannot revive a source, and corrupt journal fails closed',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),message={role:'user',content:'no-db-private'},r={sessionId:'no-db-source',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(message)).digest('hex')}
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:r.sessionId,messages:[message]}]})},state={version:1,progress:[],reflections:[],batches:[]}
 const options={profile:directory,store,readData:()=>data,writeData:v=>{data=v},readReflections:()=>state,writeReflections:v=>{state=v},hasDatabase:()=>false}
 const privacy=createMemoryLifecycle(options),next={'aisling.conversations.v1':JSON.stringify({sessions:[]})};privacy.beforeConversationChange(data,next);data=next;await privacy.recover();await privacy.synchronizeBarriers()
 await assert.rejects(store.applyNoteOperation(operation('replay',[r])),{code:'erased'})
 const file=path.join(directory,'memory-erasure.v1.json'),journal=JSON.parse(fs.readFileSync(file));journal.pending=[{id:randomUUID(),steps:[{operationId:'bad'}]}];fs.writeFileSync(file,JSON.stringify(journal))
 assert.throws(()=>privacy.assertReadable(),/erase-journal-invalid/);assert.throws(()=>privacy.sanitizedData(data),/erase-journal-invalid/)
 await store.close()
})

test('deleting a Reflection Origin erases its saved draft batch and Note even while the original message remains valid',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),m={role:'user',content:'origin-only-private'},r={sessionId:'origin-source',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')},op=operation(m.content,[r],[origin('gone-origin')])
 await store.applyNoteOperation(op)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:r.sessionId,messages:[m]}]})},state={version:1,progress:[],reflections:[{id:'gone-origin',content:m.content,sourceRefs:[r],relatedReflectionIds:[]}],batches:[{id:'saved-private-draft',sourceRefs:[r],reflectionIds:['gone-origin'],organization:{items:[{reflectionId:'gone-origin',draft:op.meaning,operation:op}]}}]}
 const privacy=createMemoryLifecycle({profile:directory,store,readData:()=>data,writeData:v=>{data=v},readReflections:()=>state,writeReflections:v=>{state=v}})
 const next=structuredClone(state);next.reflections=[];next.batches[0].reflectionIds=[]
 privacy.beforeReflectionsChange(state,next);state=next;await privacy.recover()
 assert.equal(state.batches.length,0);assert(!JSON.stringify(state).includes(m.content));assert.equal(await store.getNoteV1(op.id),null);assert.equal(await store.getOperationReceipt(op.operationId),null)
 assert.equal(JSON.parse(data['aisling.conversations.v1']).sessions[0].messages[0].content,m.content)
 await assert.rejects(store.applyNoteOperation(op),{code:'erased'});await store.close()
})

test('a second source deletion during a Worker commit retains both durable intents and both replay barriers',{skip:!resources,timeout:30000},async()=>{
 const {store,directory}=await fixture(),a={role:'user',content:'concurrent-private-a'},b={role:'user',content:'concurrent-private-b'}
 const r=(id,m)=>({sessionId:id,messageIndex:0,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')})
 const ra=r('concurrent-a',a),rb=r('concurrent-b',b),oa=operation(a.content,[ra],[origin('origin-a')]),ob=operation(b.content,[rb],[origin('origin-b')]);await store.applyNoteOperation(oa);await store.applyNoteOperation(ob)
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:ra.sessionId,messages:[a]},{id:rb.sessionId,messages:[b]}]})},state={version:1,progress:[],batches:[],reflections:[{id:'origin-a',content:a.content,sourceRefs:[ra],relatedReflectionIds:[]},{id:'origin-b',content:b.content,sourceRefs:[rb],relatedReflectionIds:[]}]}
 const privacy=createMemoryLifecycle({profile:directory,store,readData:()=>data,writeData:v=>{data=v},readReflections:()=>state,writeReflections:v=>{state=v}})
 let release,started;const hold=new Promise(r=>{release=r}),begin=new Promise(r=>{started=r}),original=store.eraseSources
 store.eraseSources=async scope=>{started();await hold;return original(scope)}
 const next={'aisling.conversations.v1':JSON.stringify({sessions:[{id:rb.sessionId,messages:[b]}]})};privacy.beforeConversationChange(data,next);data=next
 const recovery=privacy.recover();await begin
 const empty={'aisling.conversations.v1':JSON.stringify({sessions:[]})};privacy.beforeConversationChange(data,empty);data=empty
 assert.equal(privacy.readJournal().pending.length,2);release();await recovery
 assert.equal(privacy.readJournal().pending.length,0);assert.equal(privacy.readJournal().blocked.sessions.length,2)
 for(const op of [oa,ob]){assert.equal(await store.getNoteV1(op.id),null);await assert.rejects(store.applyNoteOperation(op),{code:'erased'})}
 await store.close()
})
