// One-shot offline backfill; never imported by the application.
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createNoteFormationService } = require('../apps/stage-desktop/note-formation.cjs')
const { sourceMessageLookup, messageDigest } = require('../apps/stage-desktop/memory-evidence.cjs')
const { safeText } = require('../apps/stage-desktop/memory-text.mjs')
const { formationInput } = require('../apps/stage-desktop/note-formation-contract.mjs')
const { organizationInput } = require('../apps/stage-desktop/note-semantic-contract.mjs')
const { openLadybug } = require('../apps/stage-desktop/memory-database/adapter.cjs')
const resources = path.resolve(__dirname, '../.local/memory-database')
const tracked = ['aisling-store.json', 'memory-authority', 'memory-note-v2/note-v2.lbdb', 'note-formation-jobs.v1.json', 'memory-erasure.v1.json', 'memory-erasure.v2.json', 'memory-migration.v1.json']
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx', flush: true }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
}
function assertOffline() {
  const code = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.Name -in @('electron.exe','node.exe') -and ($_.ExecutablePath -like '*project_Aisling*' -or $_.CommandLine -like '*project_Aisling*') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', code], { encoding: 'utf8', windowsHide: true }).trim()
  if (result && result !== 'null' && result !== '[]') throw new Error('Close Aisling and its development server before backfill')
}
function mergeSessions(targetData, sourceData) {
  const current = JSON.parse(targetData['aisling.conversations.v1']), previous = JSON.parse(sourceData['aisling.conversations.v1'])
  const byId = new Map(current.sessions.map(s => [s.id, s]))
  if (byId.size !== current.sessions.length) throw new Error('Duplicate target session IDs')
  const added = []
  for (const session of previous.sessions) {
    if (!/^[\w-]{1,128}$/.test(session.id) || !Array.isArray(session.messages)) throw new Error('Invalid historical session')
    const existing = byId.get(session.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(session)) throw new Error('Session ID conflict: ' + session.id)
    if (!existing) { byId.set(session.id, session); added.push(session) }
  }
  return { data: { ...targetData, 'aisling.conversations.v1': JSON.stringify({ ...current, sessions: [...current.sessions, ...added] }) }, added: added.length }
}
function candidates(sourceData, reflections, targetJobs, existingNotes) {
  const lookup = sourceMessageLookup(sourceData), refs = new Map(), skipped = []
  const known = new Set(existingNotes.flatMap(n => n.sources.map(r => JSON.stringify([r.sessionId, r.messageIndex, r.digest]))))
  for (const reflection of reflections.reflections) {
    const valid = reflection.sourceRefs?.length && reflection.sourceRefs.every(lookup)
    if (!valid) { skipped.push({ reflectionId: reflection.id, reason: 'invalid-original-source' }); continue }
    if (!['fact', 'preference', 'project-state', 'pattern'].includes(reflection.kind)) { skipped.push({ reflectionId: reflection.id, reason: 'event-or-question-retained-in-raw' }); continue }
    for (const ref of reflection.sourceRefs) {
      const message = lookup(ref)
      if (message.role !== 'user' || !safeText(message.content)) continue
      if (known.has(JSON.stringify([ref.sessionId, ref.messageIndex, ref.digest])) || ref.messageIndex < (targetJobs.progress?.[ref.sessionId] ?? 0)) continue
      refs.set(JSON.stringify(ref), ref)
    }
  }
  const sessions = JSON.parse(sourceData['aisling.conversations.v1']).sessions
  return { refs: [...refs.values()].sort((a,b) => (sessions.find(s => s.id === a.sessionId).createdAt - sessions.find(s => s.id === b.sessionId).createdAt) || a.sessionId.localeCompare(b.sessionId) || a.messageIndex-b.messageIndex), skipped }
}
async function snapshot(profile) {
  const api = require(path.join(resources, 'node_modules/@ladybugdb/core'))
  const store = openLadybug(api, path.join(profile, 'memory-note-v2/note-v2.lbdb'), 'note-v2-runtime', true)
  try { return await store.mirrorSnapshot() } finally { await store.close() }
}
function verify(before, after, data) {
  const lookup = sourceMessageLookup(data)
  const meaning = ({ sources, contextEvidence, ...note }) => note
  for (const note of before.notes) {
    const current = after.notes.find(n => n.id === note.id)
    if (!current || JSON.stringify(meaning(current)) !== JSON.stringify(meaning(note))
      || note.sources.some(ref => !current.sources.some(r => JSON.stringify(r) === JSON.stringify(ref)))
      || note.contextEvidence.some(ref => !current.contextEvidence.some(r => JSON.stringify(r) === JSON.stringify(ref)))) throw new Error('Existing Note changed: ' + note.id)
  }
  for (const relation of before.relations) if (!after.relations.some(r => JSON.stringify(r) === JSON.stringify(relation))) throw new Error('Existing relation changed')
  if (after.notes.some(n => !n.sources.length || !n.sources.every(lookup) || !n.contextEvidence.every(lookup))) throw new Error('Unresolvable evidence')
  const ids = new Set(after.notes.map(n => n.id))
  if (after.relations.some(r => !ids.has(r.source) || !ids.has(r.target))) throw new Error('Dangling relation')
  const normalized = text => text.normalize('NFKC').replace(/^用户(?:报告|陈述|自述)[：: ]*/u, '').trim().replace(/[。.]+$/u, '')
  const seen = new Set()
  for (const note of after.notes) {
    const key = JSON.stringify([note.subject, note.kind, note.basis, normalized(note.content), note.eventTime, note.state])
    if (seen.has(key)) throw new Error('Duplicate recognition')
    seen.add(key)
  }
}
async function plan(target, source, run) {
  assertOffline()
  if (fs.existsSync(run)) throw new Error('Use a fresh run directory')
  const before = await snapshot(target)
  const targetData = json(path.join(target, 'aisling-store.json')), sourceData = json(path.join(source, 'aisling-store.json'))
  const reflections = json(path.join(source, 'aisling-reflections.v1.json')), jobs = json(path.join(target, 'note-formation-jobs.v1.json'))
  const merged = mergeSessions(targetData, sourceData), selected = candidates(sourceData, reflections, jobs, before.notes)
  fs.mkdirSync(run, { recursive: true })
  const files = []
  for (const [folder, names, label] of [[target, tracked, 'target'], [source, ['aisling-store.json', 'aisling-reflections.v1.json'], 'source']]) {
    for (const name of names) {
      const original = path.join(folder, name), backup = path.join(run, 'backup', label, name), digest = hash(original)
      files.push({ original, backup, digest, name, label })
      if (digest) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(original, backup); if (hash(original) !== digest || hash(backup) !== digest) throw new Error('Unstable backup') }
    }
  }
  if (fs.existsSync(path.join(target, 'memory-note-v2/note-v2.lbdb.wal')) && fs.statSync(path.join(target, 'memory-note-v2/note-v2.lbdb.wal')).size) throw new Error('Database WAL present; require clean shutdown')
  for (const file of files.filter(f => f.label === 'target' && f.digest)) {
    const destination = path.join(run, 'stage', file.name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(file.backup, destination)
  }
  save(path.join(run, 'stage/aisling-store.json'), merged.data)
  save(path.join(run, 'before.json'), before)
  save(path.join(run, 'plan.json'), { version: 1, target, source, files, state: 'planned', refs: selected.refs, skipped: selected.skipped,
    addedSessions: merged.added, maxFormationCalls: 16, maxOrganizationCalls: 1, calls: [] })
  return { selectedSources: selected.refs.length, addedSessions: merged.added, skippedReflections: selected.skipped.length }
}
async function stage(run, complete = callModel) {
  const file = path.join(run, 'plan.json'), plan = json(file)
  if (['staged','applied'].includes(plan.state)) return { noOp: true, calls: 0 }
  if (plan.state !== 'planned') throw new Error('Interrupted run; retain backup and inspect before retry')
  plan.state = 'staging'; save(file, plan)
  const profile = path.join(run, 'stage'), storeFile = path.join(profile, 'aisling-store.json')
  if (!plan.refs.length) return finalize(run, plan)
  const config = JSON.parse(json(storeFile)['aisling.config.v1']).consciousness
  if (!config?.apiKey || !config.model || !/^https:\/\//.test(config.baseUrl)) throw new Error('Configured HTTPS provider required')
  const service = createNoteFormationService({ profile, resources, readData: () => json(storeFile), writeData: d => save(storeFile, d),
    autonomous: true, consent: () => true, recallConsent: () => true, reviewConsent: () => true })
  const baselineIds = new Set(json(path.join(profile,'note-formation-jobs.v1.json')).batches.map(b=>b.id))
  try {
    for (const ref of plan.refs) { await service.delivered(ref.sessionId, [ref.messageIndex]) }
    for (const id of new Set(plan.refs.map(r=>r.sessionId))) await service.flush(id)
    for (let call = 0; call < plan.maxFormationCalls; call++) {
      const job = await service.next(false)
      if (!job) break
      if (baselineIds.has(job.id)) { await service.fail(job.id, job.attempt, 'cancelled'); throw new Error('Existing pending job requires separate handling') }
      await generate(job, false)
    }
    await service.recover()
    // Reject only this backfill's unauthorized proposals through the existing service; never auto-approve.
    const jobs = json(path.join(profile,'note-formation-jobs.v1.json'))
    plan.decisions = jobs.batches.filter(b=>!baselineIds.has(b.id)).flatMap(b=>(b.items||[]).map(i=>({batchId:b.id,operationId:i.operationId,status:i.status,action:i.action,reason:i.reason})))
    for (const decision of plan.decisions.filter(d=>d.status==='review')) await service.decide(decision.operationId, false)
    for (let i=0;i<64;i++) await service.organize()
    const semantic = await service.next(true)
    if (semantic && plan.maxOrganizationCalls) { if (semantic.kind !== 'organization') throw new Error('Formation budget exhausted'); await generate(semantic, true); await service.organize() }
    plan.pendingBackfillJobs = json(path.join(profile,'note-formation-jobs.v1.json')).batches.filter(b=>!baselineIds.has(b.id)&&['pending','running','collecting','settling'].includes(b.status)).length
    if (plan.pendingBackfillJobs) throw new Error('Unfinished backfill jobs; do not publish')
    async function generate(job, semantic) {
      const record = { kind: semantic ? 'organization' : 'formation', jobId: job.id, status: 'started' }
      plan.calls.push(record); save(file, plan)
      try {
        const context = await service.prepare(job.id,job.attempt,[])
        const input = semantic ? organizationInput(context) : formationInput(context)
        const result = await complete(config, input.messages)
        record.usage = result.usage; record.status = 'received'
        save(path.join(run, 'responses', `${plan.calls.length}.json`), result.body)
        let raw = result.text
        if (!semantic) { const body = JSON.parse(raw); plan.skippedActions ??= []; body.items = body.items.filter(item=>{if(['ADD','NOOP','UNDECIDED'].includes(item.action))return true;plan.skippedActions.push({jobId:job.id,action:item.action,reason:'historical-destructive-action-blocked'});return false}); raw=JSON.stringify(body) }
        await service.submit(job.id,job.attempt,raw)
        await service.recover()
        record.status = 'submitted'
      } catch(error) { record.status = 'failed';record.error = /^[a-z][a-z0-9-]{0,60}$/.test(error.message)?error.message:'provider-or-contract-error';await service.fail(job.id,job.attempt,'provider-error') }
      save(file,plan)
      console.log(JSON.stringify({call:plan.calls.length,kind:record.kind,status:record.status}))
    }
  } finally { await service.close() }
  return finalize(run, plan)
}
async function finalize(run, plan) {
  const profile = path.join(run, 'stage'), storeFile = path.join(profile, 'aisling-store.json'), file = path.join(run, 'plan.json')
  const after = await snapshot(profile)
  verify(json(path.join(run,'before.json')),after,json(storeFile))
  save(path.join(run,'after.json'),after)
  plan.state='staged';plan.stats={notesBefore:json(path.join(run,'before.json')).notes.length,notesAfter:after.notes.length,relationsAfter:after.relations.length,calls:plan.calls.length}
  plan.stagedFiles=tracked.filter(name=>fs.existsSync(path.join(profile,name))).map(name=>({name,digest:hash(path.join(profile,name))}))
  save(file,plan)
  return plan.stats
}
async function callModel(config, messages) {
  const response = await fetch(config.baseUrl.replace(/\/+$/,'')+'/chat/completions', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},
    body:JSON.stringify({model:config.model,messages,temperature:.2,max_tokens:1500,enable_thinking:false}),signal:AbortSignal.timeout(45000)})
  if(!response.ok) throw new Error('Provider HTTP '+response.status)
  const body=await response.json(), text=body.choices?.[0]?.message?.content
  if(typeof text!=='string'||body.choices[0].message.tool_calls?.length) throw new Error('Invalid provider output')
  return {body,text,usage:body.usage}
}
function apply(run) {
  assertOffline()
  const file=path.join(run,'plan.json'),plan=json(file)
  if(plan.state==='applied') return {noOp:true,notesAdded:0}
  if(plan.state!=='staged')throw new Error('Successful dry-run required')
  for(const record of plan.files)if(hash(record.original)!==record.digest||hash(record.backup)!==record.digest)throw new Error('Source, target or backup changed; refuse apply')
  for(const item of plan.stagedFiles)if(hash(path.join(run,'stage',item.name))!==item.digest)throw new Error('Staged data changed')
  if(fs.existsSync(path.join(plan.target,'memory-note-v2/note-v2.lbdb.wal'))&&fs.statSync(path.join(plan.target,'memory-note-v2/note-v2.lbdb.wal')).size)throw new Error('Database WAL present')
  const changed=plan.stagedFiles.filter(item=>hash(path.join(plan.target,item.name))!==item.digest)
  plan.state='applying';save(file,plan)
  const installed=[]
  try {
    for(const item of changed){const dest=path.join(plan.target,item.name),temp=dest+'.backfill.tmp';fs.copyFileSync(path.join(run,'stage',item.name),temp,fs.constants.COPYFILE_EXCL);try{fs.renameSync(temp,dest);installed.push(item)}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}}
  }catch(error){
    for(const item of installed.reverse()){const record=plan.files.find(r=>r.label==='target'&&r.name===item.name),dest=path.join(plan.target,item.name);if(record.digest)fs.copyFileSync(record.backup,dest);else fs.unlinkSync(dest)}
    plan.state='staged';save(file,plan);throw error
  }
  plan.state='applied';save(file,plan)
  return {notesAdded:plan.stats.notesAfter-plan.stats.notesBefore,files:changed.map(i=>i.name)}
}
function restore(run) {
  assertOffline()
  const file=path.join(run,'plan.json'),plan=json(file)
  if(plan.state==='restored')return{noOp:true}
  if(!['applied','applying'].includes(plan.state))throw new Error('No installed backfill to restore')
  for(const record of plan.files.filter(f=>f.label==='target')){
    const current=hash(record.original),staged=plan.stagedFiles.find(f=>f.name===record.name)?.digest
    if(hash(record.backup)!==record.digest||(current!==record.digest&&current!==staged))throw new Error('Later target changes detected; refuse restore')
  }
  for(const record of plan.files.filter(f=>f.label==='target')){
    if(hash(record.original)===record.digest)continue
    if(record.digest){const temp=record.original+'.restore.tmp';fs.copyFileSync(record.backup,temp,fs.constants.COPYFILE_EXCL);try{fs.renameSync(temp,record.original)}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}}
    else fs.unlinkSync(record.original)
  }
  plan.state='restored';save(file,plan)
  return{restored:true}
}
module.exports={mergeSessions,candidates,verify,plan,stage,apply,restore}
if(require.main===module){
 const [mode,...args]=process.argv.slice(2)
 ;(async()=>{let result;if(mode==='plan'&&args.length===3)result=await plan(...args.map(p=>fs.realpathSync(path.dirname(path.resolve(p)))===path.dirname(path.resolve(p))?path.resolve(p):(()=>{throw new Error('Canonical paths required')})()));else if(mode==='stage'&&args.length===1)result=await stage(path.resolve(args[0]));else if(mode==='apply'&&args.length===1)result=apply(path.resolve(args[0]));else if(mode==='restore'&&args.length===1)result=restore(path.resolve(args[0]));else throw new Error('Usage: plan TARGET SOURCE RUN | stage RUN | apply RUN | restore RUN');console.log(JSON.stringify(result))})().catch(error=>{console.error(error.message);process.exitCode=1})
}
