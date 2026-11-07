const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {createMemoryOrganization}=require('./memory-organization.cjs')
const resources=process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
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
  consent=false;await assert.rejects(service.settle(a.batch.id,0),/disabled/);consent=true
  const changed=JSON.parse(data['aisling.conversations.v1']);changed.sessions[0].messages[0].content='edited';data['aisling.conversations.v1']=JSON.stringify(changed);save()
  await service.candidates();await assert.rejects(service.settle(a.batch.id,0),/unconfirmed-proposal/)
  assert.equal(await service.store.getNoteV1(a.operation.id),null);assert.equal(await service.store.getOperationReceipt(a.operation.operationId),null)
  await assert.rejects(service.store.applyNoteOperation(a.operation),{code:'erased'})
 }finally{await service.close()}
})
