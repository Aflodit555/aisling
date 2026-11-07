const fs=require('node:fs')
const path=require('node:path')
const {randomUUID,createHash}=require('node:crypto')
const {sourceKey,hash,validErasure}=require('./memory-database/erasure.cjs')
const digest=m=>createHash('sha256').update(JSON.stringify(m)).digest('hex')
const sessions=data=>{const v=JSON.parse(data['aisling.conversations.v1']||'{"sessions":[]}');if(!Array.isArray(v.sessions))throw new Error('conversation-invalid');return v.sessions}
function current(ref,data){const s=sessions(data).filter(s=>s.id===ref.sessionId);return s.length===1&&s[0].messages[ref.messageIndex]&&digest(s[0].messages[ref.messageIndex])===ref.digest}
function pruneReflections(state,data,blocked={batches:[],origins:[],sources:[],sessions:[]},noteIds=[]){
 const removed=new Set(blocked.origins),removedBatches=new Set(blocked.batches),notes=new Set(noteIds)
 const valid=r=>!blocked.sources.includes(sourceKey(r))&&!blocked.sessions.includes(hash(r.sessionId))&&current(r,data)
 const lostOutput=b=>[...b.reflectionIds,...(b.organization?.items??[]).map(i=>i.reflectionId).filter(Boolean)].some(id=>removed.has(hash(id)))
 for(const b of state.batches){
  if(removedBatches.has(hash(b.id))||lostOutput(b)||b.sourceRefs.some(r=>!valid(r))||b.contextSources?.some(r=>!valid(r))||b.organization?.contextSources?.some(r=>!valid(r))||b.organization?.contextNoteIds?.some(id=>notes.has(id))){
   removedBatches.add(hash(b.id));for(const id of b.reflectionIds)removed.add(hash(id))
  }
 }
 for(const r of state.reflections)if(r.sourceRefs.some(ref=>!valid(ref)))removed.add(hash(r.id))
 // A recorded model-input dependency is stronger than a weak display link; invalidate the whole output.
 let changed=true
 while(changed){changed=false
  for(const b of state.batches)if(!removedBatches.has(hash(b.id))&&(lostOutput(b)||b.contextReflectionIds?.some(id=>removed.has(hash(id))))){
   removedBatches.add(hash(b.id));for(const id of b.reflectionIds)if(!removed.has(hash(id))){removed.add(hash(id));changed=true}
  }
 }
 const originIds=state.reflections.filter(r=>removed.has(hash(r.id))).map(r=>r.id)
 const batchIds=state.batches.filter(b=>removedBatches.has(hash(b.id))).map(b=>b.id)
 const next=structuredClone(state)
 next.reflections=next.reflections.filter(r=>!removed.has(hash(r.id)))
 next.batches=next.batches.filter(b=>!removedBatches.has(hash(b.id)))
 for(const r of next.reflections)r.relatedReflectionIds=r.relatedReflectionIds.filter(id=>!removed.has(hash(id)))
 for(const b of next.batches)b.reflectionIds=b.reflectionIds.filter(id=>!removed.has(hash(id)))
 return {state:next,originIds,batchIds}
}

/** One durable erase intent list, not a general task queue. No conversation bodies are journaled. */
function createMemoryLifecycle({profile,store,readData,writeData,readReflections,writeReflections,hasDatabase=()=>true,invalidate=(_reason)=>{}}){
 const file=path.join(profile,'memory-erasure.v1.json')
 let running,audited
 const empty=()=>({version:1,pending:[],qualified:[],blocked:{batches:[],origins:[],sources:[],sessions:[]}})
 function read(){try{const j=JSON.parse(fs.readFileSync(file,'utf8'));const hashes=a=>Array.isArray(a)&&a.every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v));if(j.version!==1||!Array.isArray(j.pending)||!j.pending.every(p=>p&&typeof p.id==='string'&&Array.isArray(p.steps)&&p.steps.every(validErasure))||!hashes(j.qualified)||!j.blocked||!['batches','origins','sources','sessions'].every(k=>hashes(j.blocked[k])))throw new Error('erase-journal-invalid');return j}catch(e){if(e.code==='ENOENT')return empty();throw e}}
 function save(j){fs.mkdirSync(profile,{recursive:true});const temp=file+'.tmp';const fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,JSON.stringify(j));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,file)}
 function remember(j,pruned){for(const id of pruned.batchIds)if(!j.blocked.batches.includes(hash(id)))j.blocked.batches.push(hash(id));for(const id of pruned.originIds)if(!j.blocked.origins.includes(hash(id)))j.blocked.origins.push(hash(id))}
 function chunks(evidence,sessionIds,originIds){const steps=[];while(evidence.length||sessionIds.length||originIds.length)steps.push({operationId:randomUUID(),evidence:evidence.splice(0,32),sessionIds:sessionIds.splice(0,32),originIds:originIds.splice(0,32)});return steps}
 function record(evidence,sessionIds,nextData,extraOrigins=[],extraBatches=[]){
  const j=read(),raw=readReflections(),pruned=pruneReflections(raw,nextData,j.blocked)
  pruned.originIds=[...new Set([...pruned.originIds,...extraOrigins])];pruned.batchIds=[...new Set([...pruned.batchIds,...extraBatches])]
  const known=new Set(evidence.map(sourceKey)),present=new Set(sessions(nextData).map(s=>s.id))
  for(const r of raw.reflections.flatMap(r=>r.sourceRefs))if(!current(r,nextData)&&!known.has(sourceKey(r))){evidence.push(r);known.add(sourceKey(r));if(!present.has(r.sessionId)&&!sessionIds.includes(r.sessionId))sessionIds.push(r.sessionId)}
  if(!evidence.length&&!sessionIds.length&&!pruned.originIds.length&&!pruned.batchIds.length)return
  for(const r of evidence)if(!j.blocked.sources.includes(sourceKey(r)))j.blocked.sources.push(sourceKey(r))
  for(const id of sessionIds)if(!j.blocked.sessions.includes(hash(id)))j.blocked.sessions.push(hash(id))
  remember(j,pruned)
  j.pending.push({id:randomUUID(),steps:chunks([...evidence],[...sessionIds],[...pruned.originIds])})
  save(j);invalidate('intent')
 }
 function beforeReflectionsChange(old,next){
  assertReadable()
  const fields=r=>JSON.stringify([r.version,r.id,r.content,r.kind,r.basis,r.tags,r.sourceRefs,r.relatedReflectionIds,r.createdAt,r.uncertainty])
  const gone=old.reflections.filter(r=>!next.reflections.some(n=>n.id===r.id&&fields(n)===fields(r))).map(r=>r.id)
  const batches=old.batches.filter(b=>!next.batches.some(n=>n.id===b.id)).map(b=>b.id)
  for(const b of old.batches)if(batches.includes(b.id))gone.push(...b.reflectionIds)
  if(gone.length||batches.length)record([],[],readData(),gone,batches)
 }
 function beforeConversationChange(oldData,newData){
  const next=sessions(newData),gone=[],refs=[]
  for(const s of sessions(oldData)){
   const n=next.find(n=>n.id===s.id)
   if(!n){gone.push(s.id);continue}
   for(const [i,m]of s.messages.entries())if(!n.messages[i]||digest(m)!==digest(n.messages[i]))refs.push({sessionId:s.id,messageIndex:i,digest:digest(m)})
  }
  record(refs,gone,newData)
 }
 function sanitizedData(data){
  const j=read(),next=structuredClone(data),ss=sessions(next)
  const kept=ss.filter(s=>!j.blocked.sessions.includes(hash(s.id)))
  const changedSessions=new Set(j.pending.flatMap(p=>p.steps.flatMap(step=>step.evidence.map(r=>r.sessionId))))
  for(const s of kept){let changed=changedSessions.has(s.id);s.messages=s.messages.map((m,i)=>{
    if(!j.blocked.sources.includes(sourceKey({sessionId:s.id,messageIndex:i,digest:digest(m)})))return m
    changed=true;return {role:m.role,content:null}
  });if(changed)s.title='New conversation'}
  if(next['aisling.conversations.v1']){const parsed=JSON.parse(next['aisling.conversations.v1']);parsed.sessions=kept;next['aisling.conversations.v1']=JSON.stringify(parsed)}
  return next
 }
 function assertReadable(){if(read().pending.length)throw new Error('erasure-pending')}
 function guardedReflections(){assertReadable();const data=sanitizedData(readData()),j=read(),p=pruneReflections(readReflections(),data,j.blocked);if(p.originIds.length||p.batchIds.length){record([],[],data);throw new Error('erasure-pending')}
  const cIds=new Set(p.state.batches.filter(b=>b.organization).flatMap(b=>b.reflectionIds))
  for(const r of p.state.reflections)if(cIds.has(r.id))r.recallEligible=(j.qualified??[]).includes(hash(r.id))
  return p.state
 }
 function qualify(ids){const j=read();if(j.pending.length)throw new Error('erasure-pending');j.qualified??=[];for(const id of ids)if(!j.qualified.includes(hash(id)))j.qualified.push(hash(id));save(j)}
 function validateWrite(state){assertReadable();const j=read(),p=pruneReflections(state,sanitizedData(readData()),j.blocked);if(p.originIds.length||p.batchIds.length)throw new Error('erased-generation')}
 async function synchronizeBarriers(){const j=read(),keys=[...j.blocked.sources.map(h=>'evidence:'+h),...j.blocked.sessions.map(h=>'session:'+h),...j.blocked.origins.map(h=>'origin:'+h)];for(let i=0;i<keys.length;i+=32)await store.installErasureBarriers(keys.slice(i,i+32))}
 async function recover(){
  if(running)return running
  running=(async()=>{
   let j=read()
   const data=sanitizedData(readData()),raw=readReflections(),fingerprint=hash([data['aisling.conversations.v1'],raw.reflections.map(r=>[r.id,r.sourceRefs])])
   if(!j.pending.length&&hasDatabase()&&audited!==fingerprint){
    await store.open()
    for(const kind of ['evidence','origin']){let cursor='';do{
     const page=await store.listMemorySources(kind,cursor)
     const invalid=page.sources.filter(s=>kind==='evidence'?!current(s.ref,data):!raw.reflections.some(r=>r.id===s.ref.reflectionId))
     if(invalid.length)record(kind==='evidence'?invalid.map(s=>s.ref):[],[],data,kind==='origin'?invalid.map(s=>s.ref.reflectionId):[])
     cursor=page.nextCursor
    }while(cursor)}
    audited=fingerprint;j=read()
   }
   if(!j.pending.length){const data=sanitizedData(readData()),state=readReflections(),p=pruneReflections(state,data,j.blocked,hasDatabase()?[]:state.batches.flatMap(b=>b.organization?.contextNoteIds??[]));if(p.originIds.length||p.batchIds.length)record([],[],data,p.originIds,p.batchIds);j=read()}
   if(!j.pending.length)return
   const database=hasDatabase()
   if(database)await store.open()
   for(let round=0;round<1024;round++){
    j=read();const intent=j.pending[0];if(!intent)break
    // Complete an interrupted source mutation without retaining the discarded body.
    writeData(sanitizedData(readData()))
    const affected=[]
    for(let i=0;i<intent.steps.length;i++){
     const step=intent.steps[i]
     if(!database)continue
     await store.eraseSources(step)
     let cursor='';do{const page=await store.erasedNoteIds(step.operationId,cursor);affected.push(...page.ids);cursor=page.nextCursor}while(cursor)
    }
    // Another source deletion can append an intent while the Worker is committing.
    j=read();const latest=j.pending[0];if(!latest||latest.id!==intent.id)throw new Error('erase-journal-conflict')
    const p=pruneReflections(readReflections(),readData(),j.blocked,affected)
    // Seal all descendants before writing the pruned JSON, then erase their Notes too.
    const seen=new Set(latest.steps.flatMap(s=>s.originIds)),extra=p.originIds.filter(id=>!seen.has(id))
    remember(j,p)
    if(extra.length){latest.steps.push(...chunks([],[],extra));save(j);invalidate('intent');continue}
    j.qualified=(j.qualified??[]).filter(id=>!j.blocked.origins.includes(id))
    save(j);writeReflections(p.state);j.pending.shift();save(j);invalidate('complete')
   }
   if(read().pending.length)throw new Error('erasure-work-limit')
  })().finally(()=>{running=undefined})
  return running
 }
 return {beforeConversationChange,beforeReflectionsChange,sanitizedData,assertReadable,guardedReflections,validateWrite,qualify,recover,synchronizeBarriers,isRecovering:()=>!!running,pending:()=>read().pending.length>0,readJournal:read}
}
module.exports={createMemoryLifecycle,pruneReflections,current}
