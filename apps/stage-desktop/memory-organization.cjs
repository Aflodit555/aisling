const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { createMemoryDatabaseStore } = require('./memory-database/store.cjs')
const { validOperation, operationFingerprint } = require('./memory-database/note-v1.cjs')
const { speakerQualification, verifiedColorPreference, reportedColor, colorScope } = require('./memory-write-policy.cjs')
const { sourceLookup, currentSources } = require('./memory-evidence.cjs')

/** Narrow Main-owned service; Renderer only names a persisted batch/item, never a raw DB operation. */
function createMemoryOrganization({ profile, resources, readData, readReflections, writeData, writeReflections, consent,
  recallConsent = () => false, report=(_state)=>{} }) {
  let enabled = false, generation = 0, headEpoch = 0, cache, reading, lifecycle = Promise.resolve(), settling = Promise.resolve()
  const invalidateHeads = () => { headEpoch++; cache = undefined }
  const hasDatabase = () => fs.existsSync(path.join(profile,'memory-organization','note-v1.lbdb'))
  const store = createMemoryDatabaseStore(async () => {
    if (!path.isAbsolute(resources)) throw new Error('absolute-resources-required')
    const node = path.join(resources, 'runtime/node.exe'), entry = path.join(resources, 'worker.cjs')
    await Promise.all([fs.promises.access(node),fs.promises.access(entry)])
    const directory = path.join(profile, 'memory-organization')
    await fs.promises.mkdir(directory,{recursive:true})
    if(await fs.promises.realpath(directory)!==directory)throw new Error('organization-directory-link')
    return {node,entry,file:path.join(directory,'note-v1.lbdb')}
  },event=>{if(event==='ready'||event==='exit')invalidateHeads()})
  const privacy=require('./memory-lifecycle.cjs').createMemoryLifecycle({profile,store,readData,writeData,readReflections,writeReflections,
    hasDatabase,invalidate:reason=>{
    generation++;invalidateHeads()
    if(reason==='intent'){report({ready:false,autoWrite:false,reason:'erasing'});if(!privacy.isRecovering())void recoverSources().catch(()=>{})}
  }})
  const active = () => enabled && consent()
  function recoverSources(){
    const work=async()=>{
      try{await privacy.recover();if(!active()&&!recallConsent())await store.close();const ready=active()&&store.status()==='ready';report({ready,autoWrite:ready,reason:active()?'write-limited':'disabled'})}
      catch{report({ready:false,autoWrite:false,reason:'erasure-failed'});throw new Error('erasure-failed')}
    }
    const result=lifecycle.then(work,work);lifecycle=result.then(()=>{},()=>{});return result
  }
  function setEnabled(next, keepForRecall = true) {
    enabled = next === true; generation++; invalidateHeads()
    const ticket=generation
    const change=async()=>{
      if(ticket!==generation)return {ready:false,autoWrite:false,reason:'disabled'}
      if(!enabled){if(!keepForRecall || !recallConsent())await store.close();return {ready:false,autoWrite:false,reason:'disabled'}}
      try {
        await privacy.recover()
        await store.open()
        await privacy.synchronizeBarriers()
        await store.listNoteHeads()
        if(ticket!==generation||!active())return {ready:false,autoWrite:false,reason:'disabled'}
        return {ready:true,autoWrite:true,reason:'write-limited'}
      } catch {await store.close().catch(()=>{});let blocked=true;try{blocked=privacy.pending()}catch{}return {ready:false,autoWrite:false,reason:blocked?'erasure-failed':'database-unavailable'}}
    }
    const result=lifecycle.then(change,change)
    lifecycle=result.then(()=>{},()=>{})
    return result
  }
  async function headIndex(maxPages = 32) {
    const epoch = headEpoch
    if(store.status()!=='ready')throw new Error('database-unavailable')
    if(!cache || !cache.complete && cache.pages < maxPages){
      const notes=[];let cursor='',complete=false
      for(let page=0;page<maxPages;page++){
        const result=await store.listNoteHeads(cursor);notes.push(...result.notes)
        if(epoch!==headEpoch)throw new Error('notes-changed')
        if(!result.nextCursor){complete=true;break}cursor=result.nextCursor
      }
      if(!cache || complete || cache.pages < maxPages)cache={notes,complete,pages:maxPages}
    }
    return {notes:cache.notes.slice(0,maxPages*8),complete:cache.complete&&cache.notes.length<=maxPages*8}
  }
  async function candidates() {
    await recoverSources();privacy.assertReadable()
    if(!active()||store.status()!=='ready')throw new Error('organization-not-ready')
    const index=await headIndex()
    const data=readData()
    const reflections=privacy.guardedReflections().reflections
    const activeNotes=index.notes.filter(h=>h.note.status==='active')
    const notes=activeNotes.filter(h=>currentSources(h.grounds.evidence,data)
      && h.grounds.origins.length>0 && h.grounds.origins.every(o=>reflections.some(r=>r.id===o.reflectionId)))
    return {complete:index.complete&&notes.length===activeNotes.length,notes}
  }
  function recallHeads() {
    if (!recallConsent() || !hasDatabase()) return Promise.resolve({ notes: [], reason: 'unavailable', excluded: 0 })
    if (reading) return reading
    const work = async () => {
      privacy.assertReadable()
      await store.open()
      const epoch = headEpoch
      // shortcut: complete scans cover up to 512 heads; use a paged search index when profiles exceed this bound.
      const index = await headIndex(64)
      privacy.assertReadable()
      if (epoch !== headEpoch || !recallConsent()) return { notes: [], reason: 'snapshot-changed', excluded: 0 }
      if (!index.complete) return { notes: [], reason: 'index-incomplete', excluded: 0 }
      const reflections = new Map()
      for (const reflection of privacy.guardedReflections().reflections)
        reflections.set(reflection.id, reflections.has(reflection.id) ? null : reflection)
      const current = sourceLookup(privacy.sanitizedData(readData()))
      const notes = index.notes.filter(({ note, grounds }) => note.status === 'active'
        && grounds.origins.length && grounds.evidence.length && grounds.evidence.every(current)
        && grounds.origins.every(origin => {
          const refs = reflections.get(origin.reflectionId)?.sourceRefs
          return refs?.length && refs.every(current)
        })
        && grounds.evidence.every(ref => grounds.origins.some(origin => reflections.get(origin.reflectionId)
          ?.sourceRefs.some(candidate => isDeepStrictEqual(candidate, ref)))))
      return { notes, reason: 'ready', excluded: index.notes.length - notes.length }
    }
    const result = lifecycle.then(work, work).catch(() => ({ notes: [], reason: 'unavailable', excluded: 0 }))
    lifecycle = result.then(() => {})
    reading = result.finally(() => { reading = undefined })
    return reading
  }
  async function settle(batchId,index) {
    await recoverSources();privacy.assertReadable()
    if(!active())throw new Error('organization-disabled')
    const ticket=generation, state=privacy.guardedReflections(), batch=state.batches?.find(b=>b.id===batchId)
    const item=batch?.organization?.items[index], operation=item?.operation
    if(!Number.isInteger(index)||index<0||index>=3||!batch||batch.status!=='completed'||!item)throw new Error('unconfirmed-proposal')
    if(!operation)return {status:'undecided',reason:'no-operation'}
    if(!validOperation(operation))throw new Error('invalid-operation')
    const origins=operation.sources.origins
    if(!origins.length||origins.some(o=>!batch.reflectionIds.includes(o.reflectionId)||!state.reflections.some(r=>r.id===o.reflectionId)))throw new Error('origin-not-persisted')
    if(origins.some(o=>operation.sources.evidence.some(ref=>!state.reflections.find(r=>r.id===o.reflectionId).sourceRefs.some(r=>r.sessionId===ref.sessionId&&r.messageIndex===ref.messageIndex&&r.digest===ref.digest))))throw new Error('source-outside-origin')
    if(!currentSources(batch.sourceRefs,readData())||!currentSources(operation.sources.evidence,readData()))throw new Error('source-changed')
    if(!['ADD','NOOP'].includes(operation.action))return {status:'proposed-not-applied',reason:'high-risk-review'}
    const reflection=state.reflections.find(r=>r.id===item.reflectionId)
    const sessions=JSON.parse(readData()['aisling.conversations.v1']).sessions
    const messages=operation.sources.evidence.map(ref=>sessions.find(s=>s.id===ref.sessionId).messages[ref.messageIndex])
    const semantic = operation.action === 'ADD' && verifiedColorPreference(item,reflection,messages)
    const qualification=semantic ? null : speakerQualification(item,reflection,messages)
    if(qualification)return {status:'proposed-not-applied',reason:qualification}
    if(origins.length!==1||origins[0].reflectionId!==reflection.id
      || operation.sources.evidence.length!==reflection.sourceRefs.length
      || reflection.sourceRefs.some(ref=>!operation.sources.evidence.some(e=>isDeepStrictEqual(e,ref)))
      || operation.action==='ADD'&&!isDeepStrictEqual(operation.meaning,item.draft))throw new Error('proposal-meaning-conflict')
    const command=semantic ? {...operation,meaning:{...operation.meaning,tags:semantic.tags}} : operation
    const receipt=await store.getOperationReceipt(operation.operationId)
    if(receipt){
      // P1.8 receipts fingerprinted the original literal tags.
      if(receipt.fingerprint!==operationFingerprint(command)
        && (!semantic || receipt.fingerprint!==operationFingerprint(operation)))throw new Error('operation-id-conflict')
      try{privacy.qualify(origins.map(o=>o.reflectionId));return {status:'applied',reason:'receipt-confirmed'}}
      catch{return {status:'outcome-unknown',reason:'qualification-pending'}}
    }
    if(!active()||generation!==ticket)throw new Error('organization-disabled')
    if(item.reason==='subject-needs-review'||item.reason==='index-incomplete')return {status:'proposed-not-applied',reason:item.reason}
    invalidateHeads()
    const heads=await candidates()
    const history=await headIndex()
    if(!heads.complete)return {status:'proposed-not-applied',reason:'index-incomplete'}
    if(semantic){
      const earlier = history.notes.filter(h => h.note.subject === operation.meaning.subject && colorScope.test(h.note.content))
      if(earlier.some(h => h.note.status === 'active' && h.note.content === operation.meaning.content))
        return {status:'proposed-not-applied',reason:'duplicate-semantic-note'}
      const currentSessions = JSON.parse(readData()['aisling.conversations.v1']).sessions
      if(earlier.length || currentSessions.some(session => session.messages.some(message => message.role === 'user'
        && typeof message.content === 'string' && colorScope.test(message.content) && reportedColor(message)?.content !== semantic.content)))
        return {status:'proposed-not-applied',reason:'preference-conflict-or-history-review'}
    }else if(operation.action==='ADD'){
      // shortcut: no deterministic fact scope yet; any existing same-speaker history requires review.
      if(history.notes.some(h=>h.note.subject===operation.meaning.subject))
        return {status:'proposed-not-applied',reason:'novelty-or-meaning-review'}
    }else{
      const target=await store.getNoteV1(operation.id)
      const revision=target&&await store.getRevision(target.id,target.version)
      if(!target||!revision||target.status!=='active'||target.version!==operation.expectedVersion||target.content!==reflection.content
        ||!item.draft||item.draft.subject!==target.subject||JSON.stringify(item.draft.eventTime)!==JSON.stringify(target.eventTime)
        ||target.basis!=='direct'||target.uncertainty!==undefined||target.context!==undefined||target.keywords!==undefined
        ||revision.grounds.origins.some(o=>!state.reflections.some(r=>r.id===o.reflectionId))
        ||!currentSources(revision.grounds.evidence,readData()))return {status:'proposed-not-applied',reason:'target-or-meaning-review'}
    }
    if(!active()||generation!==ticket||!currentSources(operation.sources.evidence,readData()))throw new Error('source-or-consent-changed')
    try{await store.applyNoteOperation(command)}
    catch(error){return {status:error.code==='outcome-unknown'?'outcome-unknown':'rejected',reason:error.code||'database-error'}}
    finally{invalidateHeads()}
    try{privacy.qualify(origins.map(o=>o.reflectionId));return {status:'applied',reason:'committed'}}
    catch{return {status:'outcome-unknown',reason:'qualification-pending'}}
  }
  // Serialize eligibility plus commit, so concurrent candidates cannot both pass an empty-head check.
  function settleSerial(batchId,index){const work=()=>settle(batchId,index),result=settling.then(work,work);settling=result.then(()=>{},()=>{});return result}
  async function freeze() {
    const closing = setEnabled(false, false)
    await settling
    await closing
    if (privacy.pending()) await recoverSources()
  }
  return {setEnabled,candidates,recallHeads,settle:settleSerial,close:()=>setEnabled(false,false),store,privacy,recoverSources,freeze}
}
module.exports={createMemoryOrganization,currentSources}
