import { expect, it, vi } from 'vitest'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef } from './formation-evidence'
import { prepareNoteV2Recall, type NoteV2RecallBridge } from './note-v2-recall'
import type { NoteRelation, NoteV2 } from '../../../stage-desktop/memory-database/store'

it('merges semantic hits without lexical overlap and projects bounded two-hop navigation with irrelevant branches pruned', async () => {
  const texts=['Memory Organization 形成认识。','Agent 选择自主行动。','Live2D 表达角色意图。','午后天气晴朗。']
  const sessions: ConversationSession[]=texts.map((content,i)=>({id:'lateral-'+i,title:'test',createdAt:1,updatedAt:1,messages:[{role:'user',content,createdAt:1}]}))
  const refs=await Promise.all(sessions.map(session=>sourceRef(session.id,0,session.messages[0]!)))
  const notes=texts.map((content,i)=>({note:{id:'n'+i,version:1,status:'active',createdAt:1,content,subject:'profile-user',kind:'fact',basis:'direct',eventTime:null,tags:[]} as NoteV2,grounds:{evidence:[refs[i]!]}}))
  const pairs=[[0,1,'Memory Organization 的认识决策与 Agent 的行动选择共同讨论自主性。'],[1,2,'行动选择可通过角色意图表达呈现。'],[0,3,'午后天气与晴朗。']] as const
  const relations:NoteRelation[]=pairs.map(([a,b,reason],i)=>({action:'LINK',operationId:'op'+i,key:'key'+i,from:'n'+a,to:'n'+b,fromVersion:1,toVersion:1,
    type:'ASSOCIATED_WITH',reason,basis:'inferred',order:'unknown',uncertainty:'导航线索，不是事实证明。',sources:{evidence:[refs[a]!,refs[b]!]},status:'active',createdAt:1,endedAt:null}))
  const bridge:NoteV2RecallBridge={snapshot:async()=>({reason:'ready',version:'v',notes}),current:async()=>true,
    candidates:async()=>({complete:true,vectorStatus:'incremental',candidates:[{noteId:'n0',noteVersion:1,channels:['embedding'],score:.016}]}),
    neighbors:async()=>({notes,relations,paths:[{noteId:'n1',steps:[{from:'n0',to:'n1',type:'ASSOCIATED_WITH',reason:relations[0]!.reason}]},
      {noteId:'n2',steps:[{from:'n0',to:'n1',type:'ASSOCIATED_WITH',reason:relations[0]!.reason},{from:'n1',to:'n2',type:'ASSOCIATED_WITH',reason:relations[1]!.reason}]}]})}
  const recall=await prepareNoteV2Recall(bridge,sessions,'query','Memory Organization 与之前的设计有什么联系？',()=>true,()=>{})
  const result=recall!.select(null,items=>items.length<=3&&items.join(',').length<=2000).map(s=>JSON.parse(s))
  expect(result).toHaveLength(3)
  expect(result[0].content).toBe(texts[0]);expect(result.some(item=>item.content===texts[3])).toBe(false)
  expect(result.find(item=>item.content===texts[2]).retrieval.path).toHaveLength(2)
  expect(result.find(item=>item.content===texts[2]).retrieval.uncertainty).toContain('不是事实证明')
  bridge.candidates=async()=>({complete:true,vectorStatus:'incremental',candidates:[{noteId:'n1',noteVersion:1,channels:['embedding'],score:.016}]})
  const semantic=await prepareNoteV2Recall(bridge,sessions,'query','智能体何时自行采取措施',()=>true,()=>{})
  expect(JSON.parse(semantic!.select(null,()=>true)[0]!).content).toBe(texts[1])
  bridge.candidates=async()=>{throw new Error('offline')}
  const fallback=await prepareNoteV2Recall(bridge,sessions,'query','Memory Organization',()=>true,()=>{})
  expect(fallback!.select(null,()=>true).length).toBeGreaterThan(0)
})

it('retrieves topical patterns, preserves uncertainty and excludes raw duplicates and stale sources', async () => {
  const make = (id: string, content: string): ConversationSession => ({
    id, title: id, createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content, createdAt: 2 }],
  })
  const sessions = [make('one', '纸舟实验一中总是先验证导出。'), make('two', '纸舟实验二中也是先验证导出。'),
    make('three', '纸舟安排了下一次检验。')]
  const refs = await Promise.all(sessions.map(session => sourceRef(session.id, 0, session.messages[0]!)))
  const base = { subject: 'profile-user', createdAt: 3, status: 'active' as const, version: 1, eventTime: null, tags: ['纸舟'] }
  const bridge: NoteV2RecallBridge = {
    snapshot: vi.fn<NoteV2RecallBridge['snapshot']>(async () => ({ reason: 'ready', version: 'snapshot', notes: [
      { note: { ...base, id: 'direct', kind: 'fact', basis: 'direct', content: sessions[0]!.messages[0]!.content! },
        grounds: { evidence: [refs[0]!] } },
      { note: { ...base, id: 'pattern', kind: 'pattern', basis: 'inferred', uncertainty: '只观察到两次。', content: '两次实验均先验证导出。' },
        grounds: { evidence: refs.slice(0, 2) } },
      { note: { ...base, id: 'overlap', kind: 'event', basis: 'direct', content: '纸舟实验记录了验证导出。' },
        grounds: { evidence: [refs[1]!] } },
      { note: { ...base, id: 'novel', kind: 'project-state', basis: 'direct', content: '下一次检验已安排。' },
        grounds: { evidence: [refs[2]!] } },
      { note: { ...base, id: 'stale', kind: 'fact', basis: 'direct', content: '纸舟无效摘要。' },
        grounds: { evidence: [{ ...refs[0]!, digest: '0'.repeat(64) }] } },
    ] })),
    current: vi.fn(async () => false),
  }
  const used = vi.fn()
  const snapshot = await prepareNoteV2Recall(bridge, sessions, 'current', '纸舟实验有什么共性？', () => true, used)
  expect(snapshot).toBeDefined()
  const raw = JSON.stringify([sessions[0]!.messages[0]])
  const selected = snapshot!.select(raw, items => items.length <= 2)
  expect(selected).toHaveLength(2)
  expect(JSON.parse(selected[1]!).content).toBe('下一次检验已安排。')
  expect(JSON.parse(selected[0]!)).toMatchObject({
    kind: 'pattern', uncertainty: '只观察到两次。', eventTime: null, storedAt: '1970-01-01T00:00:00.003Z',
  })
  expect(selected[0]).not.toContain('digest')
  expect(used).toHaveBeenCalledOnce()
  expect(await snapshot!.current()).toBe(false)
  expect(bridge.current).toHaveBeenCalledWith('snapshot')
})

it('expands one hop beyond lexical matches, preserves report uncertainty and rejects stale graph evidence', async () => {
  const sessions: ConversationSession[] = ['我开始练习钢琴。', '我现在暂停练习钢琴。'].map((content, i) => ({
    id: 'graph-' + i, title: 'test', createdAt: i + 1, updatedAt: i + 1, messages: [{ role: 'user', content, createdAt: i + 1 }],
  }))
  const refs = await Promise.all(sessions.map(session => sourceRef(session.id, 0, session.messages[0]!)))
  const notes = sessions.map((session, i) => ({
    note: { id: 'note-' + i, version: 1, createdAt: i + 1, status: 'active', subject: 'profile-user',
      kind: 'event', basis: 'direct', eventTime: null, tags: [], content: i ? '这段练习暂时放下。' : session.messages[0]!.content,
      state: { scope: '练习钢琴', value: i ? '暂停' : '开始' } } as NoteV2,
    grounds: { evidence: [refs[i]!] },
  }))
  const relation: NoteRelation = { operationId: 'link', action: 'LINK', key: 'key', from: 'note-0', to: 'note-1',
    fromVersion: 1, toVersion: 1, type: 'STATE_CHANGE', basis: 'inferred', order: 'report', uncertainty: '仅知报告先后。',
    reason: '原始状态报告', sources: { evidence: refs }, status: 'active', createdAt: 3, endedAt: null }
  const bridge: NoteV2RecallBridge = {
    snapshot: async () => ({ reason: 'ready', version: 'graph-version', notes }), current: async () => true,
    neighbors: vi.fn(async () => ({ notes, relations: [relation] })),
  }
  const prepared = await prepareNoteV2Recall(bridge, sessions, 'current', '钢琴', () => true, () => {})
  const selected = prepared!.select(null, () => true).map(item => JSON.parse(item))
  expect(selected).toHaveLength(2)
  expect(selected[1].content).toBe('这段练习暂时放下。')
  expect(selected[1].relations[0]).toMatchObject({ direction: 'earlier', basis: 'inferred', order: 'report' })
  relation.toVersion = 2
  const stale = await prepareNoteV2Recall(bridge, sessions, 'current', '钢琴', () => true, () => {})
  expect(stale!.select(null, () => true)).toHaveLength(1)
  relation.toVersion = 1
  sessions[1]!.messages[0] = { ...sessions[1]!.messages[0]!, content: '原始证据已修改。' }
  const changed = await prepareNoteV2Recall(bridge, sessions, 'current', '钢琴', () => true, () => {})
  expect(changed!.select(null, () => true).map(item => JSON.parse(item))).toEqual([
    expect.not.objectContaining({ relations: expect.anything() }),
  ])
})

it('uses event evolution for current and historical queries without losing direct topical evidence', async () => {
  const texts = ['我开始练习钢琴。', '我暂停钢琴练习。', '我恢复训练。']
  const sessions: ConversationSession[] = texts.map((content, i) => ({ id: 'evolution-' + i, title: 'test',
    createdAt: 4 - i, updatedAt: 4 - i, messages: [{ role: 'user', content, createdAt: 4 - i }] }))
  const refs = await Promise.all(sessions.map(session => sourceRef(session.id, 0, session.messages[0]!)))
  const notes = texts.map((content, i) => ({ note: { id: 'step-' + i, version: 1, createdAt: 4 - i, status: 'active',
    subject: 'profile-user', kind: 'event', basis: 'direct', content, eventTime: { kind: 'date', date: `2026-0${i + 1}-01` }, tags: [] } as NoteV2,
    grounds: { evidence: [refs[i]!] } }))
  const relations: NoteRelation[] = [0, 1].map(i => ({ action: 'LINK', operationId: 'operation-' + i, key: 'link-' + i,
    from: 'step-' + i, to: 'step-' + (i + 1), fromVersion: 1, toVersion: 1, type: 'STATE_CHANGE', order: 'event',
    basis: 'inferred', uncertainty: '只表示事件顺序。', reason: '独立原始经历', sources: { evidence: refs.slice(i, i + 2) },
    status: 'active', createdAt: 5, endedAt: null }))
  const bridge: NoteV2RecallBridge = { snapshot: async () => ({ reason: 'ready', version: 'v', notes }), current: async () => true,
    neighbors: vi.fn(async () => ({ notes, relations })) }
  const fits = (items: readonly string[]) => items.length <= 3 && items.join(',').length <= 2000
  const current = await prepareNoteV2Recall(bridge, sessions, 'query', '我现在还在练钢琴吗？', () => true, () => {})
  const selected = current!.select(null, fits).map(text => JSON.parse(text))
  expect(selected[0].content).toBe(texts[2])
  expect(selected[0].evolution).toMatchObject({ role: 'latest-known-report', order: 'event' })
  expect(selected.some(note => note.content.includes('钢琴'))).toBe(true)
  const compact = current!.select(null, items => items.length <= 2 && items.join(',').length <= 900).map(text => JSON.parse(text))
  expect(compact.some(note => note.evolution?.role === 'latest-known-report')).toBe(true)
  const historical = await prepareNoteV2Recall(bridge, sessions, 'query', '我学钢琴的事后来怎么样了？', () => true, () => {})
  expect(historical!.select(null, fits).map(text => JSON.parse(text).content)).toEqual(texts)
  const tight = current!.select(null, items => items.length <= 1 && items.join(',').length <= 400).map(text => JSON.parse(text))
  expect(tight).toHaveLength(1)
  expect(tight[0].content).toContain('钢琴')
  expect(tight[0].relations).toBeUndefined()
  relations[0]!.type = 'CONFLICTS'; relations[0]!.order = 'unknown'
  const conflict = await prepareNoteV2Recall(bridge, sessions, 'query', '我现在还在练钢琴吗？', () => true, () => {})
  expect(conflict!.select(null, fits).map(text => JSON.parse(text)).filter(note => note.content !== texts[2])
    .every(note => note.evolution.role === 'unresolved')).toBe(true)
})

it('recalls a source-checked prior Revision for correction questions and drops it on source edits', async () => {
  const sessions: ConversationSession[] = ['我暂停钢琴练习。', '更正：只是暂停上课，练习一直继续。'].map((content, i) => ({
    id: 'revision-' + i, title: 'test', createdAt: i + 1, updatedAt: i + 1, messages: [{ role: 'user', content, createdAt: i + 1 }],
  }))
  const refs = await Promise.all(sessions.map(session => sourceRef(session.id, 0, session.messages[0]!)))
  const current = { id: 'recognition', version: 2, createdAt: 1, status: 'active', content: '钢琴课暂停但练习一直继续。',
    subject: 'profile-user', basis: 'direct', kind: 'fact', eventTime: null, tags: ['钢琴'] } as NoteV2
  const previous = { ...current, version: 1, content: '用户暂停了钢琴练习。' }
  const notes = [{ note: current, grounds: { evidence: [refs[1]!] } }]
  const bridge: NoteV2RecallBridge = { snapshot: async () => ({ reason: 'ready', version: 'revision-snapshot', notes }), current: async () => true,
    neighbors: async () => ({ notes, relations: [], history: [{ forId: current.id, revision: { noteId: current.id, version: 1,
      operationId: 'original', action: 'ADD', changedAt: 1, reason: '来自原始暂停报告', snapshot: previous, grounds: { evidence: [refs[0]!] } } }] }) }
  const prepared = await prepareNoteV2Recall(bridge, sessions, 'query', '你以前为什么认为我还在练钢琴？', () => true, () => {})
  const result = JSON.parse(prepared!.select(null, () => true)[0]!)
  expect(result.previousRecognition).toMatchObject({ content: previous.content, version: 1, reason: '来自原始暂停报告' })
  expect(result.previousRecognition.sources[0].content).toBe(sessions[0]!.messages[0]!.content)
  sessions[0]!.messages[0] = { ...sessions[0]!.messages[0]!, content: '旧依据已被编辑。' }
  const stale = await prepareNoteV2Recall(bridge, sessions, 'query', '你以前为什么认为我还在练钢琴？', () => true, () => {})
  expect(JSON.parse(stale!.select(null, () => true)[0]!).previousRecognition).toBeUndefined()
})
