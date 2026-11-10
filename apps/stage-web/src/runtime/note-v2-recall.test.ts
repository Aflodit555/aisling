import { expect, it, vi } from 'vitest'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef } from './formation-evidence'
import { prepareNoteV2Recall, type NoteV2RecallBridge } from './note-v2-recall'

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
