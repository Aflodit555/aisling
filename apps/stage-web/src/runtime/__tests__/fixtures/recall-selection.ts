import type { ConversationSession } from '../../../conversation/conversation-store'
import { sourceRef } from '../../reflection-formation'
import type { Reflection, ReflectionState } from '../../reflection-store'

// Exact three experimental summaries, with independent synthetic IDs and test-only source digests.
export async function selectionFixture(timed: boolean) {
  const texts = [
    '我之前想练完整首手碟曲子，但一直没开始。后来改成只练两分钟节奏，结果完成了。',
    '另一次我又计划练完整首曲子，但还是拖着没开始。后来只要求自己练一个小节，就完成了。',
    '画画也是，我本来想画完整场景，始终没有动笔。后来只画一个杯子，就完成了。',
  ]
  const sessions: ConversationSession[] = [0, 1, 2, 2].map((topic, i) => {
    const at = Date.parse('2026-10-28T08:00:00Z') + i * 1000
    return { id: `source-${i}`, title: '', createdAt: timed ? at : 0, updatedAt: timed ? at + 100 : 0,
      messages: [{ role: 'user', content: texts[topic]!, ...(timed ? { createdAt: at } : {}) }] }
  })
  const refs = await Promise.all(sessions.map(s => sourceRef(s.id, 0, s.messages[0]!)))
  const reflections: Reflection[] = [
    { version: 1, id: 'narrow-pattern',
      content: '用户两次报告曲子练习拖延：以“完整曲子”为目标时未开始；改为“两分钟节奏”或“一个小节”后完成，显示极小目标可能降低启动门槛。',
      kind: 'pattern', basis: 'inferred', tags: ['曲子练习', '手碟', '启动拖延', '小目标'], sourceRefs: [refs[0]!, refs[1]!],
      relatedReflectionIds: [], createdAt: 1793154238714,
      uncertainty: '基于两次用户报告推断，范围限于曲子/手碟练习；是否适用于其他任务不确定。' },
    { version: 1, id: 'cross-pattern',
      content: '用户报告在手碟/曲子练习和画画中，目标设为完整曲子或完整场景时常未开始；改为两分钟节奏、一个小节或一个杯子等极小具体目标后完成，显示缩小目标可能降低启动门槛。',
      kind: 'pattern', basis: 'inferred', tags: ['小目标启动', '手碟', '曲子练习', '画画', '拖延', '完成'],
      sourceRefs: [refs[1]!, refs[0]!, refs[2]!], relatedReflectionIds: ['narrow-pattern'], createdAt: 1793154521271,
      uncertainty: '基于用户自述的三个跨领域实例推断；不证明稳定偏好或普遍规律，可能受任务类型、情绪和环境等影响。' },
    { version: 1, id: 'drawing-event', content: '用户报告在画画任务中，原本想画完整场景但始终没有动笔；后来把目标缩小为只画一个杯子，并完成了。',
      kind: 'event', basis: 'direct', tags: ['画画', '小目标', '启动', '完成'], sourceRefs: [refs[3]!],
      relatedReflectionIds: ['cross-pattern'], createdAt: 1793155199146, uncertainty: '仅为用户自述的经历，不证明普遍规律或稳定偏好。' },
  ]
  const state: ReflectionState = { version: 1, reflections, progress: [], batches: reflections.map((r, i) => ({
    id: `batch-${i}`, sessionId: r.sourceRefs[0]!.sessionId, sourceRefs: r.sourceRefs, units: 1,
    status: 'completed', attempts: 1, reflectionIds: [r.id],
  })) }
  return { sessions, state }
}
