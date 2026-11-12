const {createHash}=require('node:crypto')
const {uuid}=require('./note-v1.cjs')
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourceKey=ref=>hash([ref.sessionId,ref.messageIndex,ref.digest])
const id=v=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)
function validateErasure(v, noteV2){
 return v&&Object.keys(v).sort().join(',')===(noteV2?'evidence,operationId,sessionIds':'evidence,operationId,originIds,sessionIds')&&uuid(v.operationId)
  &&Array.isArray(v.evidence)&&v.evidence.length<=32&&v.evidence.every(r=>r&&Object.keys(r).sort().join(',')==='digest,messageIndex,sessionId'&&id(r.sessionId)&&Number.isSafeInteger(r.messageIndex)&&r.messageIndex>=0&&(!noteV2||typeof r.digest==='string')&&/^[a-f0-9]{64}$/.test(r.digest))
  &&[...(noteV2?[]:[v.originIds]),v.sessionIds].every(a=>Array.isArray(a)&&a.length<=32&&a.every(id))
  &&v.evidence.length+(v.originIds?.length??0)+v.sessionIds.length>0
}
const validErasure = v => validateErasure(v, false)
const validEvidenceErasure = v => validateErasure(v, true)
const ddl=['CREATE NODE TABLE IF NOT EXISTS MemoryTombstone(key STRING PRIMARY KEY, erasureId STRING)',
 'CREATE NODE TABLE IF NOT EXISTS MemoryErasure(operationId STRING PRIMARY KEY, fingerprint STRING, notes INT64, operations INT64)']
function erasureOperations(query,graph,noteV2=false,runtime=false){
 const evidenceEdge = runtime ? '[]' : '[:HAS_EVIDENCE]'
 async function blocked(keys){
  if(!keys.length)return false
  return (await query('MATCH(t:MemoryTombstone) WHERE t.key IN $keys RETURN t.key LIMIT 1',{keys})).length>0
 }
 async function assertWritable(command){
  const keys=['operation:'+command.operationId,'note:'+command.id,...(command.newId?['note:'+command.newId]:[]),
   ...(command.sources.origins??[]).map(o=>'origin:'+hash(o.reflectionId)),
   ...[...command.sources.evidence,...(command.contextEvidence??[])].flatMap(r=>['evidence:'+sourceKey(r),'session:'+hash(r.sessionId)])]
  if(await blocked(keys))throw Object.assign(new Error('Deleted identities cannot be replayed'),{code:'erased'})
 }
 async function eraseSources(command){
  const fingerprint=hash({evidence:[...new Set(command.evidence.map(sourceKey))].sort(),...(command.originIds&&{origins:[...new Set(command.originIds)].sort()}),sessions:[...new Set(command.sessionIds)].sort()})
  return graph.transaction(async()=>{
   const [old]=await query('MATCH(e:MemoryErasure {operationId:$id}) RETURN e.fingerprint AS fingerprint,e.notes AS notes,e.operations AS operations',{id:command.operationId})
   if(old){if(old.fingerprint!==fingerprint)throw Object.assign(new Error('Erasure ID conflict'),{code:'operation-id-conflict'});return {operationId:command.operationId,notes:Number(old.notes),operations:Number(old.operations)}}
   const notes=new Set(),operations=new Set()
   if(command.sessionIds.length)for(const r of await query(`MATCH(n:Note)-${evidenceEdge}->(e:Evidence) WHERE e.sessionId IN $ids RETURN DISTINCT n.id AS id`,{ids:command.sessionIds}))notes.add(r.id)
   if(command.evidence.length)for(const r of await query(`MATCH(n:Note)-${evidenceEdge}->(e:Evidence) WHERE e.key IN $keys RETURN DISTINCT n.id AS id`,{keys:command.evidence.map(r=>JSON.stringify([r.sessionId,r.messageIndex,r.digest]))}))notes.add(r.id)
   if(command.originIds?.length)for(const r of await query('MATCH(n:Note)-[:HAS_ORIGIN]->(o:Origin) WHERE o.reflectionId IN $ids RETURN DISTINCT n.id AS id',{ids:command.originIds}))notes.add(r.id)
   // Receipts couple SUPERSEDE endpoints; close over all such lifecycle dependencies.
   let changed=true
   while(changed){changed=false;let after=''
    for(;;){
     const rows=await query('MATCH(o:NoteOperation) WHERE o.operationId > $after RETURN o.operationId AS id,o.data AS data ORDER BY o.operationId LIMIT 128',{after})
     for(const row of rows){const receipt=JSON.parse(row.data)
      if(receipt.affectedNotes.some(n=>notes.has(n.id))){operations.add(row.id);if(receipt.action==='SUPERSEDE')for(const n of receipt.affectedNotes)if(!notes.has(n.id)){notes.add(n.id);changed=true}}
     }
     if(rows.length<128)break;after=rows.at(-1).id
    }
   }
   const keys=[...notes].map(n=>'note:'+n).concat([...operations].map(o=>'operation:'+o),command.sessionIds.map(s=>'session:'+hash(s)),command.evidence.map(r=>'evidence:'+sourceKey(r)),(command.originIds??[]).map(o=>'origin:'+hash(o)))
   for(const key of keys)await query('MERGE(t:MemoryTombstone {key:$key}) ON CREATE SET t.erasureId=$id',{key,id:command.operationId})
   for(const noteId of notes){
    if(runtime)await query('MATCH(e:NOTE_EMBEDDING {noteId:$noteId}) DELETE e',{noteId})
    await query('MATCH(r:NoteRevision) WHERE r.key STARTS WITH $prefix DELETE r',{prefix:JSON.stringify([noteId]).slice(0,-1)+','})
    await query('MATCH(n:Note {id:$id}) DETACH DELETE n',{id:noteId})
   }
   for(const operationId of operations)await query('MATCH(o:NoteOperation {operationId:$id}) DELETE o',{id:operationId})
   // Drop only unreferenced endpoints: a surviving Note keeps its shared source objects.
   await query(`MATCH(e:Evidence) WHERE NOT EXISTS { MATCH(:Note)-${evidenceEdge}->(e) } DELETE e`)
   if(!noteV2)await query('MATCH(o:Origin) WHERE NOT EXISTS { MATCH(:Note)-[:HAS_ORIGIN]->(o) } DELETE o')
   await query('CREATE(:MemoryErasure {operationId:$id,fingerprint:$fingerprint,notes:$notes,operations:$operations})',{id:command.operationId,fingerprint,notes:notes.size,operations:operations.size})
   return {operationId:command.operationId,notes:notes.size,operations:operations.size}
  })
 }
 async function erasedNoteIds(erasureId,after){
  const rows=await query("MATCH(t:MemoryTombstone {erasureId:$id}) WHERE t.key STARTS WITH 'note:' AND t.key > $after RETURN t.key AS key ORDER BY t.key LIMIT 17",{id:erasureId,after:after?'note:'+after:''})
  const ids=rows.slice(0,16).map(r=>r.key.slice(5));return {ids,nextCursor:rows.length>16?ids.at(-1):null}
 }
 async function listNoteEvidence(noteId, after) {
  const rows = await query(`MATCH (:Note {id:$noteId})-${evidenceEdge}->(e:Evidence)
    WHERE e.key > $after RETURN DISTINCT e.key AS key, e.sessionId AS sessionId, e.messageIndex AS messageIndex, e.digest AS digest
    ORDER BY e.key LIMIT 17`, { noteId, after })
  const evidence = rows.slice(0, 16).map(({sessionId,messageIndex,digest}) => ({sessionId,messageIndex:Number(messageIndex),digest}))
  return { evidence, nextCursor: rows.length > 16 ? rows[15].key : null }
 }
 async function listMemorySources(kind,after){
  const rows=kind==='evidence'?await query('MATCH(e:Evidence) WHERE e.key > $after RETURN e.key AS key,e.sessionId AS sessionId,e.messageIndex AS messageIndex,e.digest AS digest ORDER BY e.key LIMIT 17',{after}):
   await query('MATCH(o:Origin) WHERE o.reflectionId > $after RETURN o.reflectionId AS key ORDER BY o.reflectionId LIMIT 17',{after})
  const sources=rows.slice(0,16).map(r=>kind==='evidence'?{key:r.key,ref:{sessionId:r.sessionId,messageIndex:Number(r.messageIndex),digest:r.digest}}:{key:r.key,ref:{reflectionId:r.key}})
  return {sources,nextCursor:rows.length>16?sources.at(-1).key:null}
 }
 async function installErasureBarriers(keys){return graph.transaction(async()=>{for(const key of keys)await query("MERGE(t:MemoryTombstone {key:$key}) ON CREATE SET t.erasureId='00000000-0000-4000-8000-000000000000'",{key});return null})}
 return {assertWritable,eraseSources,erasedNoteIds,listMemorySources,listNoteEvidence,installErasureBarriers}
}
module.exports={ddl,validErasure,validEvidenceErasure,erasureOperations,sourceKey,hash}
