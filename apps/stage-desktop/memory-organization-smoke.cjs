// Real built renderer + trusted IPC + Main + Node Worker. Synthetic profile only.
const {app}=require('electron')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {startDesktop}=require('./desktop-app.cjs')
app.disableHardwareAcceleration()
delete process.env.AISLING_STAGE_URL
delete process.env.TYPESAFE_API_KEY
const root=path.resolve(__dirname,'../../artifacts/memory-organization-p17')
fs.mkdirSync(root,{recursive:true})
const profile=fs.mkdtempSync(path.join(root,'electron-'))
const live=process.env.AISLING_ORGANIZATION_LIVE==='1'
const ledgerFile=path.join(root,'live-budget.json')
const paid=fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(ledgerFile)):{calls:0,tokens:0}
let liveServer,liveCalls=0,liveUsage
app.setPath('userData',profile)
const timeout=setTimeout(()=>{console.error('Organization smoke timeout');app.exit(1)},70000)
;(async()=>{
 let liveUrl=''
 if(live){
  if(!process.env.DEEPSEEK_API_KEY)throw new Error('No authorized test key')
  liveServer=require('node:http').createServer(async(req,res)=>{
   res.setHeader('Access-Control-Allow-Origin','aisling://stage')
   if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.end();return}
   try{
    let input='';for await(const chunk of req){input+=chunk;if(input.length>20000)throw new Error('input-limit')}
    if(liveCalls>=1||paid.calls>=1||paid.tokens+6000>6000)throw new Error('paid-call-budget')
    liveCalls++
    paid.calls++;fs.writeFileSync(ledgerFile,JSON.stringify(paid))
    const request=JSON.parse(input),started=performance.now()
    const upstream=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY},
      body:JSON.stringify({model:'deepseek-flash',messages:request.messages,temperature:.2,max_tokens:1500,thinking:{type:'disabled'},stream:false}),signal:AbortSignal.timeout(45000)})
    if(!upstream.ok)throw new Error('provider-http-'+upstream.status)
    const body=await upstream.json();liveUsage={calls:liveCalls,inputTokens:body.usage?.prompt_tokens,outputTokens:body.usage?.completion_tokens,elapsedMs:performance.now()-started,finishReason:body.choices?.[0]?.finish_reason}
    fs.writeFileSync(path.join(profile,'live-output.json'),JSON.stringify(body,null,2))
    paid.tokens+=body.usage?.total_tokens??6000;fs.writeFileSync(ledgerFile,JSON.stringify(paid))
    fs.appendFileSync(path.join(root,'live-calls.jsonl'),JSON.stringify(liveUsage)+'\n')
    fs.writeFileSync(path.join(root,'live-usage.json'),JSON.stringify(liveUsage,null,2))
    if(!Number.isSafeInteger(liveUsage.inputTokens)||!Number.isSafeInteger(liveUsage.outputTokens)||liveUsage.inputTokens+liveUsage.outputTokens>6000)throw new Error('usage-budget')
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:body.choices?.[0]?.message?.content,usage:{inputTokens:liveUsage.inputTokens,outputTokens:liveUsage.outputTokens}}))
   }catch{res.statusCode=502;res.end('{"error":"test-provider-stopped"}')}
  })
  await new Promise(r=>liveServer.listen(0,'127.0.0.1',r));liveUrl='http://127.0.0.1:'+liveServer.address().port
 }
 const win=await startDesktop({show:false,diagnostics:false})
 const contents=win.contentView.children[0].webContents
 contents.setBackgroundThrottling(false)
 await contents.loadURL('aisling://stage/settings/memory')
 const setup=String.raw`async function context(){
  for(let n=0;n<300;n++){
   const pinia=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia
   const settings=pinia?._s.get('settings'),stage=pinia?._s.get('stage')
   if(settings?.loaded&&stage)return {settings,stage}
   await new Promise(r=>setTimeout(r,10))
  }throw new Error('No settings/stage')
 }
 async function until(fn,label='condition'){for(let n=0;n<800;n++){if(fn())return;await new Promise(r=>setTimeout(r,10))}const {stage}=await context();throw new Error(label+': '+JSON.stringify({formation:stage.formationStatus,organization:stage.organizationStatus,batches:stage.formation.inspect().batches.map(b=>({units:b.units,status:b.status,error:b.error}))}))}
 `
 const missing=process.env.AISLING_ORGANIZATION_MISSING==='1'
 const result=await contents.executeJavaScript(`(async()=>{${setup}
  const {settings,stage}=await context();let calls=0,oldCalls=0
  await settings.saveConsciousness({...settings.config.consciousness,baseUrl:'https://mock.invalid',apiKey:'SYNTHETIC',model:'mock'})
  settings.activeChatProvider={id:'organization-smoke',complete:async request=>{
   if(request.messages[0]?.content?.startsWith('You form append-only')){oldCalls++;throw new Error('Duplicate Formation call')}
   if(request.messages[0]?.content?.startsWith('Form atomic candidates')){
    if(${live}){calls++;const response=await fetch(${JSON.stringify(liveUrl)},{method:'POST',body:JSON.stringify(request)});if(!response.ok)throw new Error('Live test stopped');return await response.json()}
    calls++;const input=JSON.parse(request.messages[1].content),e=input.evidence.find(e=>e.role==='user')
    const s=input.subjects.find(s=>s.subject==='profile-user'&&s.mentions.some(m=>m.label===e.label)),target=input.candidates.find(n=>n.content==='用户陈述：'+e.content)
    const action=calls===3?'RETRACT':target?'NOOP':'ADD'
    return {text:JSON.stringify({items:[{origin:'O1',draft:{content:'用户陈述：'+e.content,subject:s.label,eventTime:null,basis:'direct',kind:'event',tags:['合成灯塔'],sources:[{label:e.label,quote:e.content}]},action,target:action==='ADD'?null:target.label,related:[],reason:'合成逐字发言'}]}),usage:{inputTokens:100,outputTokens:50}}
   }return {text:'收到。'}
  }}
  await settings.setMemoryFormationEnabled(true)
  await settings.setMemoryOrganizationEnabled(true)
  await until(()=>stage.organizationStatus.ready || stage.organizationStatus.reason==='database-unavailable')
  if(${missing})return {missing:!stage.organizationStatus.ready,reason:stage.organizationStatus.reason,chatWorks:!!stage.send}
  await until(()=>stage.formationStatus.enabled && stage.formationStatus.lastEvent==='ready','formation initialization')
  const switches=[...document.querySelectorAll('.module-toggle')].map(e=>e.textContent)
  if(!switches.some(s=>s.includes('Memory Organization')))throw new Error('Missing organization toggle')
  for(let i=0;i<3;i++){stage.send('合成灯塔 R8 门框为银色，传感器 E2。');await until(()=>!stage.sending)}
  await until(()=>stage.formation.inspect().batches.some(b=>b.organization?.settled),'C settlement')
  if(!${live}){
   for(let turn=0;turn<2;turn++){
    for(let i=0;i<3;i++){stage.send('合成灯塔 R8 门框为银色，传感器 E2。');await until(()=>!stage.sending)}
    await until(()=>stage.formation.inspect().batches.filter(b=>b.organization?.settled).length===turn+2,'next C settlement')
   }
  }
  const state=stage.formation.inspect(),batch=state.batches.find(b=>b.organization)
  const o=batch.organization.items[0]
  const before={outcomes:state.batches.filter(b=>b.organization).map(b=>({operation:b.organization.items[0].operation,status:b.organization.items[0].status,reason:b.organization.items[0].reason})),calls,oldCalls,reflections:state.reflections.length,pending:stage.organizationStatus.pending,reason:o.reason,status:o.status,
    operationId:o.operation.operationId,origin:o.reflectionId,metrics:batch.organization.metrics,sessionId:batch.sessionId,
    ready:stage.organizationStatus.ready,autoWrite:stage.organizationStatus.autoWrite}
  await settings.setMemoryOrganizationEnabled(false);await until(()=>!stage.organizationStatus.ready)
  const count=stage.formationStatus.calls
  // Disable the independent old Formation opt-in before checking that all generation stops.
  await settings.setMemoryFormationEnabled(false)
  stage.send('关闭后不得生成新记忆。');await until(()=>!stage.sending);await new Promise(r=>setTimeout(r,30))
  if(stage.formationStatus.calls!==count)throw new Error('Background request after disabling')
  await settings.setMemoryOrganizationEnabled(true);await until(()=>stage.organizationStatus.ready)
  return before
 })()`)
 if(missing){assert(result.missing);console.log(JSON.stringify({result:'organization-missing-passed',profile,...result}));clearTimeout(timeout);app.quit();return}
 assert.equal(result.oldCalls,0);assert.equal(result.autoWrite,true)
 if(!live){
  assert.equal(result.calls,3);assert.equal(result.reflections,3);assert.equal(result.status,'applied');assert.equal(result.reason,'committed')
  assert.deepEqual(result.outcomes.map(o=>o.status),['applied','applied','proposed-not-applied'])
  assert.deepEqual(result.outcomes.map(o=>o.operation.action),['ADD','NOOP','RETRACT']);assert.equal(result.outcomes[2].reason,'high-risk-review');assert.equal(result.metrics.inputTokens,100)
 }else{assert.equal(result.calls,1);assert.equal(result.reflections,1);assert(['applied','proposed-not-applied'].includes(result.status))}
 const {createMemoryDatabaseStore}=require('./memory-database/store.cjs'),resources=process.env.AISLING_MEMORY_DB_P0_RESOURCES
 const reader=createMemoryDatabaseStore(async()=>({node:path.join(resources,'runtime/node.exe'),entry:path.join(resources,'worker.cjs'),file:path.join(profile,'memory-organization/note-v1.lbdb')}),()=>{})
 await contents.executeJavaScript('window.aislingDesktop.memoryOrganization.setEnabled(false)')
 await reader.open()
 if(!live){
  const id=result.outcomes[0].operation.id,note=await reader.getNoteV1(id),changes=await reader.getVersionSourceChanges(id,1)
  assert.equal(note.status,'active');assert.equal(note.version,1);assert.equal(changes.changes.length,1)
  assert.equal(await reader.getOperationReceipt(result.outcomes[2].operation.operationId),null)
  assert.equal((await reader.getRevision(id,1)).grounds.evidence.length,1)
  assert.equal(changes.changes[0].links.evidence.length,1)
 }
 await reader.close()
 console.log(JSON.stringify({checkpoint:'batch-validated',calls:result.calls,pending:result.pending}))
 let screenshot=false
 try { const picture=await Promise.race([contents.capturePage(undefined,{stayHidden:true,stayAwake:true}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('capture-timeout')),1000))]);fs.writeFileSync(path.join(profile,'memory-organization-settings.png'),picture.toPNG());screenshot=true }
 catch { console.log(JSON.stringify({screenshot:'unavailable',reason:'capturePage'})) }
 await contents.loadURL('aisling://stage/settings/memory')
 const recovered=await contents.executeJavaScript(`(async()=>{${setup}
  const {stage,settings}=await context()
  await until(()=>stage.organizationStatus.ready,'restart readiness')
  const before=stage.formation.inspect().batches.find(b=>b.organization)
  const operationId=before.organization.items[0].operation.operationId
  await window.aislingDesktop.memoryOrganization.settle(before.id,0)
  const complete=await window.aislingDesktop.memoryOrganization.candidates();if(!complete.complete)throw new Error('Incomplete fresh candidates')
  const configured=settings.config.memory.organizationEnabled===true
  const restartedReady=stage.organizationStatus.ready
  stage.deleteSession(before.sessionId)
  for(let i=0;i<1000;i++){try{const c=await window.aislingDesktop.memoryOrganization.candidates();if(!c.notes.length)break}catch{}await new Promise(r=>setTimeout(r,10))}
  await window.aislingDesktop.memoryOrganization.setEnabled(false)
  const after=stage.formation.inspect()
  return {operationId,configured,restartedReady,restartedCalls:stage.formationStatus.calls,remainingC:after.batches.filter(b=>b.organization).length,remainingOrigins:after.reflections.filter(r=>r.id===${JSON.stringify(result.origin)}).length}
 })()`)
 assert.equal(recovered.operationId,result.operationId);assert(recovered.configured)
 assert(recovered.restartedReady);assert.equal(recovered.restartedCalls,0)
 assert.equal(recovered.remainingC,0);assert.equal(recovered.remainingOrigins,0)
 await reader.open()
 for(const {operation}of result.outcomes){assert.equal(await reader.getNoteV1(operation.id),null);assert.equal(await reader.getOperationReceipt(operation.operationId),null);await assert.rejects(reader.applyNoteOperation(operation),{code:'erased'})}
 await reader.close()
 console.log(JSON.stringify({result:'organization-app-passed',profile,...result,recovered,screenshot,usageSource:live?'actual provider':'synthetic mock; not paid usage',liveUsage}))
 liveServer?.close();clearTimeout(timeout);app.quit()
})().catch(error=>{console.error(error);liveServer?.close();clearTimeout(timeout);app.exit(1)})
