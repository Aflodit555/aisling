import { expect, it } from 'vitest'
import type { ConversationMessage } from '@aisling/core'
import type { ConversationSession } from '../conversation/conversation-store'
import { retrieveRecall } from './memory-recall'

const topic = '我们以前聊过《灌篮高手》吗？你当时怎么评价的？'
const followup = '还记得有什么吗'
const session = (id: string, messages: ConversationMessage[]): ConversationSession => ({ id, title: '', createdAt: 0, updatedAt: 0, messages })
const old = [
  session('story', [{ role: 'user', content: '我们以前聊过《灌篮高手》。' },
    { role: 'assistant', content: '我编过“流川枫邻居”的笑话，那是我瞎编的。' }]),
  session('battery', [{ role: 'user', content: '电池闭环的充放电原理还记得有什么吗？' }]),
  session('song', [{ role: 'user', content: '还记得上一首放的歌有什么吗？' }]),
]
const retrieve = (messages: ConversationMessage[], query: string) => retrieveRecall([...old, session('active', messages)], 'active', query)

it('keeps a user topic through vague follow-ups without using assistant inventions as anchors', () => {
  const messages: ConversationMessage[] = [{ role: 'user', content: topic },
    { role: 'assistant', content: '我猜刚才的话题其实是电池和歌曲。' }]
  expect(retrieve(messages, topic).sessionIds[0]).toBe('story')
  for (const query of [followup, '还有呢？']) {
    messages.push({ role: 'user', content: query })
    const result = retrieve(messages, query)
    expect(result.sessionIds[0]).toBe('story')
    expect(result.packingOmittedSessionIds).not.toContain('story')
    expect(JSON.parse(result.evidence!).find((r: { role: string }) => r.role === 'assistant')).toMatchObject({
      sourceScope: 'stored-assistant-utterance', content: old[0]!.messages[1]!.content,
    })
    expect(result.evidence).not.toContain('我猜刚才的话题')
  }
})

it('uses an explicit new topic as-is and anchors its next follow-up to that newer user topic', () => {
  const query = '换个话题，电池闭环的充放电原理是什么？'
  const messages: ConversationMessage[] = [{ role: 'user', content: topic }, { role: 'user', content: query }]
  const switched = retrieve(messages, query)
  expect(switched.sessionIds[0]).toBe('battery')
  expect(switched.evidence).toBe(retrieve([], query).evidence)
  expect(retrieve([...messages, { role: 'user', content: followup }], followup).sessionIds[0]).toBe('battery')
})

it('does not borrow an assistant-only, distant, oversized or unsafe topic', () => {
  const baseline = retrieve([], followup).evidence
  const histories: ConversationMessage[][] = [
    [{ role: 'assistant', content: topic }],
    [{ role: 'user', content: topic }, ...Array.from({ length: 12 }, (): ConversationMessage => ({ role: 'assistant', content: '嗯。' }))],
    [{ role: 'user', content: topic.repeat(20) }],
    [{ role: 'user', content: topic }, { role: 'user', content: 'password: private topic' }],
  ]
  for (const history of histories) expect(retrieve(history, followup).evidence).toBe(baseline)
})
