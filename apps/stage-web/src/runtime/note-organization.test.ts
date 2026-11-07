import { expect, it, vi } from 'vitest'
import { createOrganizationProcessor, parseOrganization, rankNoteHeads, type OrganizationBridge } from './note-organization'
import { sourceRef, createReflectionFormation } from './reflection-formation'
import type { ConversationSession } from '../conversation/conversation-store'
import type { FormationBatch, ReflectionState } from './reflection-store'

const proposal=(content='灯塔 R8 门框为银色，传感器 E2。', subject='S3')=>({origin:'O1',draft:{content,subject,eventTime:null,basis:'direct',kind:'fact',tags:['灯塔'],sources:[{label:'E1',quote:content}]},action:'ADD',target:null,related:[],reason:'新陈述'})
async function fixture(){
 const sessions:ConversationSession[]=[{id:'source',title:'test',createdAt:1,updatedAt:1,messages:[{role:'user',content:'灯塔 R8 门框为银色，传感器 E2。'},{role:'assistant',content:'已知。'}]}]
 const evidence=await Promise.all(sessions[0]!.messages.map(async(message,i)=>({message,ref:await sourceRef('source',i,message)})))
 const batch:FormationBatch={id:'batch',sessionId:'source',units:3,status:'pending',attempts:0,reflectionIds:[],sourceRefs:evidence.map(e=>e.ref)}
 const bridge:OrganizationBridge={setEnabled:vi.fn(async()=>({ready:true,autoWrite:false,reason:'privacy-write-blocked'})),candidates:vi.fn(async()=>({notes:[],complete:true})),settle:vi.fn(async()=>({status:'proposed-not-applied' as const,reason:'privacy-write-blocked'}))}
 return {sessions,evidence,batch,bridge,processor:createOrganizationProcessor({enabled:()=>true,bridge,getSessions:()=>sessions})}
}
it('requires the common exact protocol, forbids forged labels/nulls/extra fields',async()=>{
 const f=await fixture(),prepared=await f.processor.prepare(f.evidence,f.batch)
 for(const patch of [{origin:'O99'},{id:'forged'},{draft:{...proposal().draft,context:null}},{draft:{...proposal().draft,sources:[{label:'E99',quote:proposal().draft.content}]}}]){
  await expect(prepared.parse(JSON.stringify({items:[{...proposal(),...patch}]}))).rejects.toThrow()
 }
 expect(()=>parseOrganization(JSON.stringify({items:[{origin:'O1',action:'UNDECIDED',draft:null,target:null,related:[],reason:'不确认'}]}))).not.toThrow()
 await expect(prepared.parse(JSON.stringify({items:[{origin:'O1',action:'UNDECIDED',draft:null,target:null,related:['N99'],reason:'不确认'}]}))).rejects.toThrow('related-not-provided')
})
it('keeps new subjects unconfirmed, supports R8/E2 and saves genuine generated origins',async()=>{
 const f=await fixture(),p=await f.processor.prepare(f.evidence,f.batch),r=await p.parse(JSON.stringify({items:[proposal()]}))
 expect(r.reflections).toHaveLength(1)
 expect(r.record.items[0]!.reason).toBe('subject-needs-review')
 expect(r.record.items[0]!.operation!.sources.origins[0]!.reflectionId).toBe(r.reflections[0]!.id)
 expect(f.bridge.settle).not.toHaveBeenCalled()
})
it('rejects an entire batch before saving if a later independent draft is illegal',async()=>{
 const f=await fixture(),p=await f.processor.prepare(f.evidence,f.batch)
 await expect(p.parse(JSON.stringify({items:[proposal(),{...proposal(),draft:{...proposal().draft,eventTime:{kind:'date',date:'2026-01-01'}}}]}))).rejects.toThrow('date-not-in-quote')
 expect(f.bridge.settle).not.toHaveBeenCalled()
})
it('uses three units and only one C call, persists before settle, recovers without regeneration',async()=>{
 const f=await fixture();let raw:string|null=null;let enabled=true
 const complete=vi.fn(async()=>({text:JSON.stringify({items:[proposal()]})}))
 const create=()=>createReflectionFormation({storage:{read:()=>({ok:true,value:raw}),write:v=>{raw=v;return true}},getSessions:()=>f.sessions,getProvider:()=>({id:'test',complete}),
  organization:{...f.processor,enabled:()=>enabled,settle:async(b,current)=>{
   const state=JSON.parse(raw!) as ReflectionState
   expect(state.reflections.some(r=>r.id===b.organization!.items[0]!.reflectionId)).toBe(true)
   expect(state.batches[0]!.organization?.items[0]!.operation?.operationId).toBe(b.organization!.items[0]!.operation?.operationId)
   return f.processor.settle(b,current)
  }}})
 const a=create();await a.setEnabled(true)
 // Enabling starts at the old tail; only newly delivered successful pairs qualify.
 for(let i=0;i<3;i++){
  const at=f.sessions[0]!.messages.length;f.sessions[0]!.messages.push(...f.sessions[0]!.messages.slice(0,2));await a.delivered('source',[at,at+1])
 }
 await vi.waitFor(()=>expect(a.inspect().batches[0]!.organization?.settled).toBe(true))
 expect(complete).toHaveBeenCalledTimes(1);expect(f.bridge.settle).toHaveBeenCalledTimes(1)
 const identity=a.inspect().batches[0]!.organization!.items[0]!.operation!.operationId
 a.dispose();const b=create();await b.setEnabled(true);await b.flush();await new Promise(r=>setTimeout(r,20))
 expect(complete).toHaveBeenCalledTimes(1);expect(b.inspect().batches[0]!.organization!.items[0]!.operation!.operationId).toBe(identity)
 const saved=JSON.parse(raw!) as ReflectionState;saved.batches[0]!.status='failed';saved.batches[0]!.error='storage-error';raw=JSON.stringify(saved)
 await b.retry(saved.batches[0]!.id)
 await vi.waitFor(()=>expect(b.inspect().batches[0]!.organization!.settled).toBe(true))
 expect(complete).toHaveBeenCalledTimes(1);expect(b.inspect().batches[0]!.organization!.items[0]!.operation!.operationId).toBe(identity)
 enabled=false;b.dispose()
})
it('aborts a C request when disabled; an ignored abort cannot commit late output',async()=>{
 const f=await fixture();let raw:string|null=null,finish!:(value:{text:string})=>void
 const complete=vi.fn(()=>new Promise<{text:string}>(r=>{finish=r}))
 const a=createReflectionFormation({storage:{read:()=>({ok:true,value:raw}),write:v=>{raw=v;return true}},getSessions:()=>f.sessions,getProvider:()=>({id:'test',complete}),organization:f.processor})
 await a.setEnabled(true);const at=f.sessions[0]!.messages.length;f.sessions[0]!.messages.push(...f.sessions[0]!.messages.slice(0,2));await a.delivered('source',[at,at+1]);await a.flush()
 await vi.waitFor(()=>expect(complete).toHaveBeenCalledTimes(1));await a.setEnabled(false)
 finish({text:JSON.stringify({items:[proposal()]})});await new Promise(r=>setTimeout(r,20))
 expect(a.inspect().reflections).toHaveLength(0);expect(f.bridge.settle).not.toHaveBeenCalled();a.dispose()
})
it('caps candidate BM25 at five; topics alone never confirm identity',()=>{
 const notes=Array.from({length:10},(_,i)=>({note:{id:String(i),subject:'灯塔',content:'灯塔门框',tags:['灯塔']},grounds:{origins:[],evidence:[]}}))
 expect(rankNoteHeads('灯塔门框',notes as never)).toHaveLength(5)
})

it.each(['UPDATE','SUPERSEDE','RETRACT','NOOP'])('parses %s against a confirmed candidate identity and version without applying it',async action=>{
 const f=await fixture(),id=crypto.randomUUID()
 vi.mocked(f.bridge.candidates).mockResolvedValue({complete:true,notes:[{note:{id,version:4,status:'active',createdAt:1,subject:'灯塔',content:'灯塔旧记录',eventTime:null,basis:'direct'},grounds:{origins:[],evidence:[f.evidence[0]!.ref]}}]})
 const prepared=await f.processor.prepare(f.evidence,f.batch)
 const r=await prepared.parse(JSON.stringify({items:[{...proposal(undefined,'S1'),action,target:'N1'}]}))
 expect(r.record.items[0]!.status).toBe('proposed-not-applied')
 const op=r.record.items[0]!.operation!
 expect(op).toMatchObject({action,id,expectedVersion:4})
 expect(f.bridge.settle).not.toHaveBeenCalled()
 await expect(prepared.parse(JSON.stringify({items:[{...proposal(),action,target:'N99'}]}))).rejects.toThrow()
})
