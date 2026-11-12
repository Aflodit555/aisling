const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { randomUUID } = require('node:crypto'), { test } = require('node:test')
const { buildNoteEmbeddingText, discoverCandidates } = require('./note-candidates.mjs')
const { embed, resolveEmbeddingConfig, embeddingIdentity } = require('./note-embedding.cjs')
const { createNoteFormationService } = require('./note-formation.cjs')
const { createNoteV2Store } = require('./memory-database/store.cjs')
const { messageDigest } = require('./memory-evidence.cjs')
const config = { modelId: 'mock/qwen3.7-text-embedding', model: 'qwen3.7-text-embedding', apiKey: 'test-only', endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding' }
const vector = (a=1,b=0) => [a,b,...Array(1022).fill(0)]
const resources = process.env.AISLING_MEMORY_DB_P0_TEST_RESOURCES
const native = { skip: !resources && 'Prepared Worker required', timeout: 90000 }

test('deterministic projection excludes identity/lifecycle noise and RRF fuses independent cross-subject channels', () => {
  const note = { id:'a',version:1,status:'active',content:'自主行动研究',subject:'profile-user',kind:'fact',tags:['研究','研究'] }
  assert.equal(buildNoteEmbeddingText(note),buildNoteEmbeddingText({...note,id:'b',version:3,status:'superseded',createdAt:32}))
  assert.equal(buildNoteEmbeddingText({...note,tags:['研究','项目']}),buildNoteEmbeddingText({...note,tags:['项目','研究']}))
  const heads = [{note}, {note:{...note,id:'b',subject:'aisling',kind:'event',tags:['表现'],content:'角色自己决定何时行动'}},
    {note:{...note,id:'c',content:'Zeta导出协议'}}]
  const found = discoverCandidates('自主行动 Zeta',heads,[{noteId:'b',noteVersion:1,score:.91}])
  assert(found.candidates.some(c=>c.head.note.id==='b'&&c.channels.includes('embedding')))
  assert(found.candidates.some(c=>c.head.note.id==='c'&&c.channels.includes('bm25')))
  assert.equal(new Set(found.candidates.map(c=>c.head.note.id)).size,found.candidates.length)
  assert(!discoverCandidates('自主',heads,[{noteId:'b',noteVersion:2,score:1}],undefined,false).complete)
})

test('native DashScope batches validate positions, dimension, type, errors and credential routing', async () => {
  const requests=[]
  const fetchImpl=async (url,init)=>{const body=JSON.parse(init.body);requests.push(body)
    assert.equal(url,config.endpoint)
    return new Response(JSON.stringify({output:{embeddings:body.input.texts.map((_,i)=>({text_index:i,embedding:vector()})).reverse()}}))}
  assert.equal((await embed(config,Array(20).fill('合成材料'),'document',{fetchImpl})).length,20)
  await embed(config,['同义表达'],'query',{fetchImpl})
  assert.equal(requests[0].parameters.text_type,'document'); assert.equal(requests[1].parameters.text_type,'query')
  assert.equal(requests[0].parameters.dimension,1024);assert.equal(requests[0].parameters.output_type,'dense')
  await assert.rejects(embed(config,Array(21).fill('x'),'document',{fetchImpl}),/embedding-input/)
  await assert.rejects(embed(config,['x'],'query',{fetchImpl:async()=>new Response('{}',{status:429})}),e=>e.retryable)
  await assert.rejects(embed(config,['x'],'query',{fetchImpl:async()=>new Response(JSON.stringify({output:{embeddings:[{text_index:0,embedding:[1]}]}}))}),/embedding-vector/)
  await assert.rejects(embed(config,['x'],'query',{timeoutMs:10,fetchImpl:(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timed-out'))))}),/timed-out/)
  const configured=resolveEmbeddingConfig({consciousness:{baseUrl:'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',apiKey:'borrowed'}},{})
  assert(configured.endpoint.endsWith('/api/v1/services/embeddings/text-embedding/text-embedding'))
  assert.equal(configured.apiKey,'borrowed')
  const dedicated={memory:{embedding:{credentialSource:'dedicated',endpoint:'https://dashscope.aliyuncs.com',apiKey:'own',model:'qwen3.7-text-embedding'}},consciousness:{baseUrl:'https://dashscope.aliyuncs.com',apiKey:'other'}}
  assert.equal(resolveEmbeddingConfig(dedicated,{}).apiKey,'own')
  dedicated.memory.embedding.apiKey='';assert.equal(resolveEmbeddingConfig(dedicated,{DASHSCOPE_API_KEY:'must-not-fallback'}),undefined)
  assert.equal(resolveEmbeddingConfig({speech:{endpoint:'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',apiKey:'speech-key'}},{}).apiKey,'speech-key')
  assert.equal(resolveEmbeddingConfig({consciousness:{baseUrl:'https://api.deepseek.com',apiKey:'wrong-provider'}},{}),undefined)
})

function fixture(request=async(_config,texts)=>texts.map(()=>vector())) {
  const root=path.resolve(__dirname,'../../artifacts/memory-p7'); fs.mkdirSync(root,{recursive:true})
  const profile=fs.realpathSync(fs.mkdtempSync(path.join(root,'test-'))), session={id:'synthetic',messages:[]}
  let clock=Date.UTC(2026,10,12), selected=config, enabled=true
  const readData=()=>({'aisling.conversations.v1':JSON.stringify({sessions:[session]})})
  const runtime=()=>createNoteFormationService({profile,resources,readData,writeData:()=>{},autonomous:true,consent:()=>enabled,
    now:()=>clock,embeddingConfig:()=>selected,embeddingRequest:request})
  const admin=(workerResources=resources)=>createNoteV2Store(async()=>({node:path.join(workerResources,'runtime/node.exe'),entry:path.join(workerResources,'worker.cjs'),
    file:path.join(profile,'memory-note-v2/note-v2.lbdb')}),()=>{},{readData,isSubjectConfirmed:()=>true})
  return {profile,session,runtime,admin,advance:()=>{clock+=60001},config:c=>{selected=c},enable:v=>{enabled=v},async seed() {
    await runtime().close();const s=admin(),ids=[]
    try {await s.open(); for (const [i,content] of ['我在研究 Memory Organization 的自主决策。','我研究过 Agent 的行动选择。','Aisling 的 Live2D 自主表现需要表达意图。'].entries()) {
      const id=randomUUID();ids.push(id); const message={role:'user',content,createdAt:clock+i};session.messages.push(message)
      await s.applyNoteOperation({action:'ADD',id,operationId:randomUUID(),reason:'合成用户报告',meaning:{content,kind:i===2?'event':'fact',
        subject:i===2?'aisling':'profile-user',basis:'direct',eventTime:null,tags:[['记忆'],['Agent'],['Live2D']][i]},
        sources:{evidence:[{sessionId:session.id,messageIndex:i,digest:messageDigest(message)}]},contextEvidence:[]})
    }} finally {await s.close()}return ids
  }}
}

test('persisted vectors survive restart, isolate model space, invalidate on update and disappear on source erase',native,async()=>{
  let calls=0;const f=fixture(async(_c,texts)=>{calls++;return texts.map(()=>vector())}),ids=await f.seed()
  let runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close()
  const s=f.admin();try {await s.open();const saved=await s.getEmbedding(ids[0]);assert.equal(saved.embedding.length,1024)
    const search=await s.searchEmbeddings({modelId:config.modelId,projectionVersion:1,embedding:vector()})
    console.log('Vector storage query mode:',search.mode)
    assert(search.hits.some(hit=>hit.noteId===ids[0])); assert.equal((await s.searchEmbeddings({modelId:'different',projectionVersion:1,embedding:vector()})).hits.length,0)
    const note=await s.getNoteV2(ids[0]), revision=await s.getRevision(ids[0],1)
    await s.applyNoteOperation({action:'UPDATE',id:ids[0],expectedVersion:1,operationId:randomUUID(),reason:'修订',meaning:{content:note.content,kind:note.kind,subject:note.subject,basis:note.basis,eventTime:null,tags:['新投影']},sources:revision.grounds,contextEvidence:[]})
    assert.equal(await s.getEmbedding(ids[0]),null)
  }finally{await s.close()}
  runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close();assert.equal(calls,2)
  f.config({...config,modelId:'mock/new-model'});runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close();assert.equal(calls,3)
  const reopened=f.admin();try{await reopened.open();assert.equal((await reopened.getEmbedding(ids[0])).modelId,'mock/new-model')
    assert.equal((await reopened.searchEmbeddings({modelId:'mock/new-model',projectionVersion:1,embedding:vector()})).hits.length,3)
    const rev=await reopened.getRevision(ids[0],2);await reopened.eraseSources({operationId:randomUUID(),evidence:rev.grounds.evidence,sessionIds:[]})
    assert.equal(await reopened.getEmbedding(ids[0]),null);assert(await reopened.getEmbedding(ids[1]))
    assert(!(await reopened.searchEmbeddings({modelId:'mock/new-model',projectionVersion:1,embedding:vector()})).hits.some(hit=>hit.noteId===ids[0]))
  }finally{await reopened.close()}
})

test('embedding alone never links Notes; bounded LLM organization creates canonical associations and two-hop paths',native,async()=>{
  const f=fixture(),ids=await f.seed(),runtime=f.runtime()
  try{await runtime.syncEmbeddings();for(let i=0;i<5;i++)await runtime.organize()
    let snapshot=await runtime.recallSnapshot();assert.equal((await runtime.recallNeighbors([ids[0]],snapshot.version)).relations.length,0)
    const job=await runtime.next(),ctx=await runtime.prepare(job.id,job.attempt,[])
    const label=id=>'N'+(ctx.notes.findIndex(n=>n.id===id)+1)
    const relations=[[ids[0],ids[1]],[ids[1],ids[2]]].map(([a,b])=>({from:label(a),to:label(b),type:'ASSOCIATED_WITH',scope:'自主行动设计',
      reason:'记忆决策与行动选择及自主意图表达可在讨论系统自主性时互相提示；不是因果证明',sources:ctx.evidence.map((e,i)=>({label:'E'+(i+1),quote:e.message.content}))
        .filter((_,i)=>[...ctx.noteGrounds[a],...ctx.noteGrounds[b]].some(ref=>ref.digest===ctx.evidence[i].ref.digest))}))
    await runtime.submit(job.id,job.attempt,JSON.stringify({relations}));snapshot=await runtime.recallSnapshot()
    const graph=await runtime.recallNeighbors([ids[0]],snapshot.version)
    assert.equal(graph.relations.length,2);assert(graph.relations.every(edge=>edge.from<edge.to&&edge.type==='ASSOCIATED_WITH'))
    assert.equal(graph.paths.find(p=>p.noteId===ids[2]).steps.length,2)
    const reverse=await runtime.recallNeighbors([ids[2]],snapshot.version);assert(reverse.paths.some(p=>p.noteId===ids[0]))
    const hybrid=await runtime.recallCandidates('记忆自治与角色表现有什么联系',snapshot.version)
    assert(hybrid.candidates.some(hit=>hit.channels.includes('embedding')))
  }finally{await runtime.close()}
  const store=f.admin();try{await store.open()
    const edge=(await store.listNoteRelations(ids[0])).relations[0]
    const command=Object.fromEntries(Object.entries(edge).filter(([key])=>!['key','status','createdAt','endedAt'].includes(key)))
    command.action='UNLINK';command.operationId=randomUUID()
    const receipt=await store.applyRelationOperation(command)
    assert.deepEqual(await store.applyRelationOperation(command),receipt)
    assert.equal((await store.listRecallRelations(ids[0])).relations.length,0)
    const rev=await store.getRevision(ids[1],1),note=await store.getNoteV2(ids[1])
    await store.applyNoteOperation({action:'UPDATE',id:ids[1],expectedVersion:1,operationId:randomUUID(),reason:'重新表述',
      meaning:{content:note.content,subject:note.subject,kind:note.kind,basis:note.basis,eventTime:null,tags:['修订']},sources:rev.grounds,contextEvidence:[]})
    assert.equal((await store.listRecallRelations(ids[2])).relations.length,0)
  }finally{await store.close()}
})

test('built Stage reuses Provider and IPC for document/query embeddings, semantic associations and actual Core injection',native,()=>{
  const root=path.resolve(__dirname,'../../artifacts/memory-note-only-p1');fs.mkdirSync(root,{recursive:true})
  const profile=fs.realpathSync(fs.mkdtempSync(path.join(root,'associative-')))
  fs.writeFileSync(path.join(profile,'.note-formation-test'),'aisling-note-formation-p1-fixture\n')
  const result=require('node:child_process').spawnSync(require('electron'),[path.join(__dirname,'note-formation-smoke.cjs'),'associative',profile,resources],{
    cwd:__dirname,windowsHide:true,encoding:'utf8',timeout:80000,
    env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^AISLING_|API_KEY$|^ELECTRON_RUN_AS_NODE$/i.test(key)))})
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  assert.match(result.stdout,/"result":"note-formation-passed"/)
})

test('rate-limited document failures persist retries across restart and stop after three attempts',native,async()=>{
  let calls=0;const f=fixture(async()=>{calls++;throw Object.assign(new Error('limited'),{retryable:true})});await f.seed()
  for(let i=0;i<3;i++){const runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close();f.advance()}
  const runtime=f.runtime();try{await runtime.syncEmbeddings();assert.equal(calls,3)}finally{await runtime.close()}
})

test('superseded experience vectors are retained/rebuilt while RETRACT removes vectors and backfill cannot recreate them',native,async()=>{
  const f=fixture(),ids=await f.seed();let runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close()
  const store=f.admin(),successor=randomUUID()
  try{await store.open();const old=await store.getNoteV2(ids[0]),revision=await store.getRevision(ids[0],1)
    await store.applyNoteOperation({action:'SUPERSEDE',id:ids[0],newId:successor,expectedVersion:1,operationId:randomUUID(),reason:'独立后续认识',
      transition:'explicit-same-scope-change',meaning:{content:old.content,kind:old.kind,subject:old.subject,basis:old.basis,eventTime:null},sources:revision.grounds,contextEvidence:[]})
    assert(await store.getEmbedding(ids[0]))
  }finally{await store.close()}
  runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close()
  const reopened=f.admin();try{await reopened.open();assert.equal((await reopened.getEmbedding(ids[0])).noteVersion,2)
    assert(await reopened.getEmbedding(successor));const rev=await reopened.getRevision(successor,1)
    await reopened.applyNoteOperation({action:'RETRACT',id:successor,expectedVersion:1,operationId:randomUUID(),reason:'明确撤回',sources:rev.grounds,contextEvidence:[]})
    assert.equal(await reopened.getEmbedding(successor),null)
  }finally{await reopened.close()}
  runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close()
  const last=f.admin();try{await last.open();assert.equal(await last.getEmbedding(successor),null)}finally{await last.close()}
})

test('closing Formation or editing a source during an embedding request cannot persist its stale derivative',native,async()=>{
  let release,start;const started=new Promise(resolve=>{start=resolve})
  const f=fixture(async(_config,texts)=>{start();await new Promise(resolve=>{release=resolve});return texts.map(()=>vector())}),ids=await f.seed()
  let runtime=f.runtime();const pending=runtime.syncEmbeddings();await started;f.enable(false);release();await pending;await runtime.close()
  const store=f.admin();try{await store.open();assert.equal(await store.getEmbedding(ids[0]),null)}finally{await store.close()}
  f.enable(true);f.advance();const again=new Promise(resolve=>{start=resolve});runtime=f.runtime()
  const retried=runtime.syncEmbeddings();await again;f.session.messages[0]={...f.session.messages[0],content:'该来源已经编辑。'};release();await retried;await runtime.close()
  const final=f.admin();try{await final.open();assert.equal(await final.getEmbedding(ids[0]),null)}finally{await final.close()}
})

test('missing Vector extension falls back to persisted exact Cosine without another database',native,async()=>{
  const f=fixture(),ids=await f.seed(),copied=path.join(f.profile,'resources');fs.cpSync(resources,copied,{recursive:true})
  const file=path.join(copied,'adapter.cjs');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("await query('LOAD vector')","throw new Error('injected-extension-unavailable')"))
  const store=f.admin(copied);try{await store.open();for(const id of ids){const note=await store.getNoteV2(id);await store.putEmbedding({...embeddingIdentity(note,config),embedding:vector()})}
    const result=await store.searchEmbeddings({modelId:config.modelId,projectionVersion:1,embedding:vector()})
    assert.equal(result.mode,'exact');assert.equal(result.hits.length,3);assert(result.complete)
    const note=await store.getNoteV2(ids[0]);await assert.rejects(store.putEmbedding({...embeddingIdentity(note,config),embedding:[1]}),{code:'invalid-payload'})
  }finally{await store.close()}
})

test('high-degree associations stay bounded and traversal cannot emit third-hop paths',native,async()=>{
  const f=fixture(),ids=await f.seed(),store=f.admin()
  try{await store.open();const base=await store.getRevision(ids[0],1)
    for(let i=0;i<18;i++){const id=randomUUID(),message={role:'user',content:'自主系统的旁支研究样本'+i,createdAt:1};f.session.messages.push(message)
      const ref={sessionId:f.session.id,messageIndex:f.session.messages.length-1,digest:messageDigest(message)}
      await store.applyNoteOperation({action:'ADD',id,operationId:randomUUID(),reason:'有界图夹具',meaning:{content:message.content,subject:'profile-user',kind:'fact',basis:'direct',eventTime:null},sources:{evidence:[ref]},contextEvidence:[]})
      const [from,to]=[ids[0],id].sort();await store.applyRelationOperation({action:'LINK',operationId:randomUUID(),from,to,fromVersion:1,toVersion:1,
        type:'ASSOCIATED_WITH',method:'semantic',basis:'inferred',scope:'自主设计',order:'unknown',uncertainty:'仅导航线索',reason:'研究方向之间的设计参考',sources:{evidence:[...base.grounds.evidence,ref]}})
    }
  }finally{await store.close()}
  const runtime=f.runtime();try{for(let i=0;i<8;i++)await runtime.organize()
    const snapshot=await runtime.recallSnapshot(),graph=await runtime.recallNeighbors([ids[0]],snapshot.version)
    assert(graph.relations.length<=16);assert(graph.notes.length<=12);assert(graph.paths.length<=12);assert(graph.paths.every(p=>p.steps.length<=2))
    assert.equal(new Set(graph.relations.map(r=>r.key)).size,graph.relations.length)
  }finally{await runtime.close()}
})

test('new-note priority survives restart and runs before the historical cursor',native,async()=>{
  const f=fixture(),ids=await f.seed(),file=path.join(f.profile,'note-formation-jobs.v1.json')
  const jobs=JSON.parse(fs.readFileSync(file,'utf8'));jobs.embeddingPriority=[ids[2]];fs.writeFileSync(file,JSON.stringify(jobs))
  const runtime=f.runtime();await runtime.syncEmbeddings();await runtime.close()
  const store=f.admin();try{await store.open();assert(await store.getEmbedding(ids[2]));assert.equal(await store.getEmbedding(ids[0]),null)
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).embeddingPriority.length,0)
  }finally{await store.close()}
})
