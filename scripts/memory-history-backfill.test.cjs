const {test}=require('node:test'),assert=require('node:assert/strict')
const {mergeSessions,candidates,verify}=require('./memory-history-backfill.cjs')
const {messageDigest}=require('../apps/stage-desktop/memory-evidence.cjs')
const msg={role:'user',content:'我喜欢空灵的音色',createdAt:1}
const ref={sessionId:'old',messageIndex:0,digest:messageDigest(msg)}
const source={'aisling.conversations.v1':JSON.stringify({activeId:'old',sessions:[{id:'old',createdAt:1,messages:[msg]}]})}
const target={'aisling.config.v1':'private-preserved','aisling.conversations.v1':JSON.stringify({activeId:'current',sessions:[{id:'current',messages:[]}]})}
test('merge preserves current active ID, config and exact original evidence; repeated merge adds zero',()=>{
 const first=mergeSessions(target,source);assert.equal(first.added,1);assert.equal(first.data['aisling.config.v1'],'private-preserved')
 assert.equal(JSON.parse(first.data['aisling.conversations.v1']).activeId,'current')
 assert.deepEqual(JSON.parse(first.data['aisling.conversations.v1']).sessions[1].messages[0],msg)
 assert.equal(mergeSessions(first.data,source).added,0)
 const changed=structuredClone(source);changed['aisling.conversations.v1']=JSON.stringify({sessions:[{id:'current',messages:[msg]}]})
 assert.throws(()=>mergeSessions(target,changed),/conflict/)
})
test('only verified original user evidence is selected, and covered/processed sources are not replayed',()=>{
 const reflection={id:'reflection',kind:'preference',sourceRefs:[ref]}
 assert.equal(candidates(source,{reflections:[reflection]}, {},[]).refs.length,1)
 assert.equal(candidates(source,{reflections:[reflection]}, {progress:{old:1}},[]).refs.length,0)
 assert.equal(candidates(source,{reflections:[reflection]}, {},[{sources:[ref]}]).refs.length,0)
 assert.equal(candidates(source,{reflections:[{...reflection,sourceRefs:[{...ref,digest:'0'.repeat(64)}]}]}, {},[]).skipped[0].reason,'invalid-original-source')
})
test('publish verification rejects lost/changed Notes, dangling sources and duplicate recognition',()=>{
 const note={id:'n',subject:'profile-user',content:msg.content,kind:'preference',basis:'direct',sources:[ref],contextEvidence:[]}
 const graph={notes:[note],relations:[]}
 verify(graph,structuredClone(graph),source)
 assert.throws(()=>verify(graph,{notes:[{...note,content:'changed'}],relations:[]},source),/changed/)
 assert.throws(()=>verify(graph,{notes:[note,{...note,id:'duplicate'}],relations:[]},source),/Duplicate/)
 assert.throws(()=>verify({notes:[],relations:[]},{notes:[{...note,sources:[{...ref,digest:'invalid'}]}],relations:[]},source),/evidence/)
})
