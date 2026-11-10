const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {createMemoryOrganization}=require('./memory-organization.cjs')
const {speakerQualification, verifiedColorPreference}=require('./memory-write-policy.cjs')
const resources=process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
// P1.9 A1 and A2 provider outputs, with JSON whitespace compacted.
const liveColorProposals = [
 '{"items":[{"origin":"O1","draft":{"content":"用户自述最喜欢的颜色是蓝色。","subject":"S1","eventTime":null,"basis":"direct","kind":"preference","tags":["颜色偏好"],"sources":[{"label":"E1","quote":"我最喜欢的颜色是蓝色。"}]},"action":"ADD","target":null,"related":[],"reason":"新陈述"}]}',
 '{"items":[{"origin":"O1","draft":{"content":"用户自述最喜欢的颜色是蓝色。","subject":"S1","eventTime":null,"basis":"direct","kind":"preference","tags":["偏好","颜色"],"sources":[{"label":"E1","quote":"我最喜欢的颜色是蓝色。"}]},"action":"ADD","target":null,"related":[],"reason":"新陈述"}]}',
].map(output => JSON.parse(output).items[0])

test('P1.9 live color drafts qualify with semantic tags',()=>{
 for(const {draft:{kind,sources,...meaning}} of liveColorProposals){
  const draft={...meaning,subject:'profile-user'}
  assert.deepEqual(verifiedColorPreference({draft},{kind,basis:draft.basis,content:draft.content},
   [{role:'user',content:sources[0].quote}])?.tags,['颜色偏好','蓝色'])
 }
})

test('W1 qualifies only a single unambiguous, direct user color preference',()=>{
 const message={role:'user',content:'我最喜欢的颜色是蓝色。'}
 const content='用户自述最喜欢的颜色是蓝色。'
 const reflection={content,kind:'preference',basis:'direct'}
 const draft={content,subject:'profile-user',basis:'direct',eventTime:null,tags:['颜色','蓝色']}
 assert.equal(speakerQualification({draft},reflection,[message]),'source-category-review')
 assert(verifiedColorPreference({draft},reflection,[message]))
 for(const content of ['我不再最喜欢蓝色。','我最喜欢的颜色是蓝色和绿色。','我最喜欢的颜色是蓝色吗？',
  '如果我最喜欢的颜色是蓝色。','我最喜欢的颜色是蓝色。项目已经完成。','她说我最喜欢的颜色是蓝色。','我最喜欢的颜色是青空。',
  '我朋友最喜欢的颜色是蓝色。','我觉得蓝色挺好看。','我打算以后把房间刷成蓝色。'])
  assert(!verifiedColorPreference({draft},reflection,[{...message,content}]))
 assert(!verifiedColorPreference({draft},reflection,[{...message,role:'assistant'}]))
 assert(!verifiedColorPreference({draft},reflection,[message,message]))
 for(const change of [{subject:'new-project'},{content:'用户现在使用蓝色工具。'},{eventTime:{kind:'date',date:'2026-11-07'}},
  {basis:'inferred',uncertainty:'可能'},{context:'计划已完成'}])
  assert(!verifiedColorPreference({draft:{...draft,...change}},reflection,[message]))
 assert.deepEqual(verifiedColorPreference({draft:{...draft,tags:['捏造']}},reflection,[message])?.tags,['颜色偏好','蓝色'])
})
test('Note head paging is bounded and rejects invalid cursors', {skip:!resources,timeout:30000},async()=>{
 const root=path.resolve(__dirname,'../../artifacts/memory-organization-p16');fs.mkdirSync(root,{recursive:true})
 const profile=fs.mkdtempSync(path.join(root,'paging-'))
 const {createMemoryDatabaseStore}=require('./memory-database/store.cjs')
 const store=createMemoryDatabaseStore(async()=>({node:path.join(resources,'runtime/node.exe'),entry:path.join(resources,'worker.cjs'),file:path.join(profile,'note-v1.lbdb')}),()=>{})
 try{
  await store.open()
  for(let i=0;i<12;i++)await store.applyNoteOperation({action:'ADD',id:randomUUID(),operationId:randomUUID(),reason:'synthetic paging',meaning:{content:'page '+i,subject:'synthetic',eventTime:null,basis:'direct'},sources:{origins:[{reflectionId:'synthetic-paging'}],evidence:[{sessionId:'synthetic',messageIndex:i,digest:'a'.repeat(64)}]}})
  const first=await store.listNoteHeads(),second=await store.listNoteHeads(first.nextCursor)
  assert.equal(first.notes.length,8);assert.equal(second.notes.length,4);assert.equal(second.nextCursor,null)
  assert.equal(new Set([...first.notes,...second.notes].map(h=>h.note.id)).size,12)
  assert(first.notes.every(h=>h.grounds.evidence.length===1))
  await assert.rejects(store.listNoteHeads('not-a-uuid'),{code:'invalid-payload'})
 }finally{await store.close()}
})

test('Recall scans beyond 256, reports the scan ceiling, and excludes superseded or erased heads', {skip:!resources,timeout:90000},async()=>{
 const root=path.resolve(__dirname,'../../artifacts/memory-p1-8');fs.mkdirSync(root,{recursive:true})
 const profile=fs.mkdtempSync(path.join(root,'recall-scale-'))
 const message={role:'user',content:'虚构的长索引资料。'}
 const ref={sessionId:'scale',messageIndex:0,digest:createHash('sha256').update(JSON.stringify(message)).digest('hex')}
 const reflection={id:'scale-origin',content:message.content,kind:'event',basis:'direct',tags:['虚构'],sourceRefs:[ref],relatedReflectionIds:[]}
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'scale',messages:[message]}]})}
 let state={reflections:[reflection],batches:[]}, recallConsent=true
 const service=createMemoryOrganization({profile,resources,readData:()=>data,writeData:value=>{data=value},
  readReflections:()=>state,writeReflections:value=>{state=value},consent:()=>true,recallConsent:()=>recallConsent})
 const id=index=>'00000000-0000-4000-8000-'+index.toString(16).padStart(12,'0')
 const sources={origins:[{reflectionId:reflection.id}],evidence:[ref]}
 const insert=async(from,to)=>{
  for(let i=from;i<to;i++)await service.store.applyNoteOperation({action:'ADD',id:id(i),operationId:randomUUID(),
   reason:'scale fixture',meaning:{content:'虚构索引 '+i,subject:'scale',eventTime:null,basis:'direct'},sources})
 }
 try{
  await service.setEnabled(true)
  await insert(1,258)
  await service.store.applyNoteOperation({action:'RETRACT',id:id(256),expectedVersion:1,operationId:randomUUID(),reason:'fictional withdrawal',sources})
  await service.setEnabled(false);await service.setEnabled(true)
  const cold=performance.now(),read=await service.recallHeads(),scanMs=performance.now()-cold
  assert.equal(read.reason,'ready');assert.equal(read.notes.length,256);assert.equal(read.excluded,1)
  assert(read.notes.some(h=>h.note.id===id(257)));assert(!read.notes.some(h=>h.note.id===id(256)))
  const warm=performance.now();await service.recallHeads();console.log('Note read at 257 heads, ms:',{scan:scanMs,warm:performance.now()-warm})
  await insert(258,514)
  await service.setEnabled(false);await service.setEnabled(true)
  assert.deepEqual(await service.recallHeads(),{notes:[],reason:'index-incomplete',excluded:0})
  const erased={'aisling.conversations.v1':'{"sessions":[]}'}
  service.privacy.beforeConversationChange(data,erased);data=erased
  assert.equal((await service.recallHeads()).notes.length,0)
  await service.recoverSources()
  assert.equal((await service.recallHeads()).notes.length,0)
  recallConsent=false
  assert.equal((await service.recallHeads()).reason,'unavailable')
 }finally{await service.close()}
})

test('production Main independently qualifies ADD/NOOP, serializes novelty, preserves review and rejects replay after erasure', {skip:!resources,timeout:60000},async()=>{
 const root=path.resolve(__dirname,'../../artifacts/memory-organization-p17');fs.mkdirSync(root,{recursive:true})
 const profile=fs.mkdtempSync(path.join(root,'main-b-')),message={role:'user',content:'合成灯塔门框为银色。'}
 let data={'aisling.conversations.v1':JSON.stringify({sessions:[{id:'synthetic',messages:[]}]})},state={version:1,progress:[],reflections:[],batches:[]},consent=true
 const dataFile=path.join(profile,'data.json'),reflectionFile=path.join(profile,'reflections.json')
 const save=()=>{fs.writeFileSync(dataFile,JSON.stringify(data));fs.writeFileSync(reflectionFile,JSON.stringify(state))}
 const propose=(m=message,subject=m.role==='user'?'profile-user':'aisling')=>{
  const parsed=JSON.parse(data['aisling.conversations.v1']),messages=parsed.sessions[0].messages,i=messages.length;messages.push(m);data['aisling.conversations.v1']=JSON.stringify(parsed)
  const ref={sessionId:'synthetic',messageIndex:i,digest:createHash('sha256').update(JSON.stringify(m)).digest('hex')}
  const content=(m.role==='user'?'用户陈述：':'Aisling 发言：')+m.content
  const reflection={version:1,id:randomUUID(),content,basis:'direct',kind:'event',tags:['灯塔'],createdAt:1,relatedReflectionIds:[],sourceRefs:[ref]}
  const draft={content,subject,eventTime:null,basis:'direct',tags:['灯塔']},operation={action:'ADD',id:randomUUID(),operationId:randomUUID(),reason:'synthetic speech',sources:{origins:[{reflectionId:reflection.id}],evidence:[ref]},meaning:draft}
  const item={action:'ADD',reflectionId:reflection.id,operation,draft,status:'proposed-not-applied',reason:'policy-review'}
  const batch={id:randomUUID(),sessionId:'synthetic',units:3,attempts:1,status:'completed',sourceRefs:[ref],reflectionIds:[reflection.id],organization:{version:1,settled:false,items:[item]}}
  state.reflections.push(reflection);state.batches.push(batch);save();return {batch,item,reflection,operation}
 }
 const a=propose(),options={profile,resources,readData:()=>JSON.parse(fs.readFileSync(dataFile)),writeData:v=>fs.writeFileSync(dataFile,JSON.stringify(v)),readReflections:()=>JSON.parse(fs.readFileSync(reflectionFile)),writeReflections:v=>fs.writeFileSync(reflectionFile,JSON.stringify(v)),consent:()=>consent}
 let service=createMemoryOrganization(options)
 try{
  assert.deepEqual(await service.setEnabled(true),{ready:true,autoWrite:true,reason:'write-limited'})
  const close=service.close(),reopen=service.setEnabled(true);await close;assert((await reopen).ready)
  const concurrent=propose({role:'user',content:'灯塔另一个报告。'})
  const results=await Promise.all([service.settle(a.batch.id,0),service.settle(concurrent.batch.id,0)])
  assert.equal(results[0].status,'applied');assert.equal(results[1].reason,'novelty-or-meaning-review')
  assert.equal((await service.store.listNoteHeads()).notes.length,1)
  assert.equal((await service.store.getRevision(a.operation.id,1)).grounds.origins[0].reflectionId,a.reflection.id)
  await service.close();service=createMemoryOrganization(options);await service.setEnabled(true)
  assert.equal((await service.settle(a.batch.id,0)).reason,'receipt-confirmed')
  const qualify=service.privacy.qualify;service.privacy.qualify=()=>{throw new Error('synthetic journal failure')}
  assert.equal((await service.settle(a.batch.id,0)).status,'outcome-unknown')
  service.privacy.qualify=qualify
  assert.equal((await service.settle(a.batch.id,0)).reason,'receipt-confirmed')
  a.item.operation={...a.operation,reason:'tampered'};save();await assert.rejects(service.settle(a.batch.id,0),/operation-id-conflict/);a.item.operation=a.operation;save()
  const n=propose();n.item.action='NOOP';n.item.operation={action:'NOOP',id:a.operation.id,operationId:randomUUID(),expectedVersion:1,reason:'same speech',sources:n.operation.sources};save()
  assert.equal((await service.settle(n.batch.id,0)).status,'applied')
  assert.equal((await service.settle(n.batch.id,0)).reason,'receipt-confirmed')
  assert.equal((await service.store.getNoteV1(a.operation.id)).version,1)
  assert.equal((await service.store.getVersionSourceChanges(a.operation.id,1)).changes.length,1)
  assert.equal((await service.store.getRevision(a.operation.id,1)).grounds.evidence.length,1)
  assert.equal((await service.store.getVersionSourceChanges(a.operation.id,1)).changes[0].links.evidence[0].messageIndex,n.operation.sources.evidence[0].messageIndex)
  n.item.operation={...n.item.operation,operationId:randomUUID(),expectedVersion:2};save();assert.equal((await service.settle(n.batch.id,0)).reason,'target-or-meaning-review')
  for(const action of ['UPDATE','SUPERSEDE','RETRACT']){
   n.item.action=action;n.item.operation={...a.operation,action,operationId:randomUUID(),expectedVersion:1,sources:n.operation.sources,...(action==='SUPERSEDE'?{newId:randomUUID(),transition:'explicit-same-scope-change'}:{})};if(action==='RETRACT')delete n.item.operation.meaning;save()
   assert.equal((await service.settle(n.batch.id,0)).reason,'high-risk-review')
  }
  assert.equal((await service.store.getNoteV1(a.operation.id)).status,'active')
  const project=propose(message,'new-project');assert.equal((await service.settle(project.batch.id,0)).reason,'subject-needs-review')
  const assistant=propose({role:'assistant',content:'灯塔：我承诺明天检查，尚未执行。'});assert.equal((await service.settle(assistant.batch.id,0)).status,'applied')
  const fact=propose({role:'assistant',content:'灯塔已修复。'});fact.reflection.kind='fact';save();assert.equal((await service.settle(fact.batch.id,0)).reason,'source-category-review')
  const proposeColor=(color, live)=>{
   const m={role:'user',content:`我最喜欢的颜色是${color}。`}, result=propose(m)
   const content=live?.draft.content ?? `用户自述最喜欢的颜色是${color}。`
   const tags=live?.draft.tags ?? ['颜色',color]
   Object.assign(result.reflection,{content,kind:'preference',tags})
   Object.assign(result.item.draft,{content,tags})
   if(live)result.operation.reason=live.reason
   save()
   return result
  }
  const blue=proposeColor('蓝色',liveColorProposals[0])
  assert.equal((await service.settle(blue.batch.id,0)).reason,'committed')
  const blueNote=await service.store.getNoteV1(blue.operation.id)
  assert.deepEqual([blueNote.status,blueNote.version,blueNote.content],['active',1,'用户自述最喜欢的颜色是蓝色。'])
  assert.deepEqual(blueNote.tags,['颜色偏好','蓝色'])
  assert.equal((await service.settle(blue.batch.id,0)).reason,'receipt-confirmed')
  const duplicate=proposeColor('蓝色',liveColorProposals[1]),red=proposeColor('红色')
  assert.equal((await service.settle(duplicate.batch.id,0)).reason,'duplicate-semantic-note')
  assert.equal((await service.settle(red.batch.id,0)).reason,'preference-conflict-or-history-review')
  assert.equal(await service.store.getOperationReceipt(duplicate.operation.operationId),null)
  assert.equal(await service.store.getOperationReceipt(red.operation.operationId),null)
  const afterColor=JSON.parse(data['aisling.conversations.v1'])
  afterColor.sessions[0].messages[blue.operation.sources.evidence[0].messageIndex].content='原话已删除'
  const nextData={...data,'aisling.conversations.v1':JSON.stringify(afterColor)}
  service.privacy.beforeConversationChange(data,nextData);data=nextData;save()
  await service.recoverSources()
  assert.equal(await service.store.getNoteV1(blue.operation.id),null)
  await assert.rejects(service.store.applyNoteOperation(blue.operation),{code:'erased'})
  assert.equal((await service.settle(duplicate.batch.id,0)).reason,'preference-conflict-or-history-review')
  const legacy=proposeColor('绿色')
  await service.store.applyNoteOperation(legacy.operation)
  assert.equal((await service.settle(legacy.batch.id,0)).reason,'receipt-confirmed')
  assert.deepEqual((await service.store.getNoteV1(legacy.operation.id)).tags,['颜色','绿色'])
  consent=false;await assert.rejects(service.settle(a.batch.id,0),/disabled/);consent=true
  const changed=JSON.parse(data['aisling.conversations.v1']);changed.sessions[0].messages[0].content='edited';data['aisling.conversations.v1']=JSON.stringify(changed);save()
  await service.candidates();await assert.rejects(service.settle(a.batch.id,0),/unconfirmed-proposal/)
  assert.equal(await service.store.getNoteV1(a.operation.id),null);assert.equal(await service.store.getOperationReceipt(a.operation.operationId),null)
  await assert.rejects(service.store.applyNoteOperation(a.operation),{code:'erased'})
 }finally{await service.close()}
})
