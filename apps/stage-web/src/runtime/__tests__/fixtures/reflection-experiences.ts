import type { ConversationSession } from '../../../conversation/conversation-store'
import { sourceRef } from '../../reflection-formation'
import type { Reflection, ReflectionState } from '../../reflection-store'

// Controlled scenarios from the task and prior study; not imported private user history.
export function experienceSessions(): ConversationSession[] {
  return [
    ['handpan-first', '2026-09-01', '我想练手碟。目标是一口气练完整首曲子，拖了几天没开始；后来缩小成两分钟节奏，当天就完成了。'],
    ['handpan-second', '2026-09-08', '手碟这次又把练习目标定得太大，一直拖延；缩小到一个小节之后，我就动手并练完了。'],
    ['drawing', '2026-10-01', '画画本来想画完整场景，目标太大一直拖延没动笔；缩小到一个杯子，当天完成了。手碟先暂时放下，现在更想画画。'],
    ['purchase-before', '2026-09-02', '手碟还没购买，练习用的是借来的，我正在考虑购买手碟。'],
    ['purchase-after', '2026-10-02', '手碟已经购买并收到了；虽然现在更想画画，手碟仍然留着。'],
  ].map(([id, date, content]) => {
    const createdAt = Date.parse(`${date}T08:00:00Z`)
    return { id: id!, title: '', createdAt, updatedAt: createdAt + 1000,
      messages: [{ role: 'user', content: content!, createdAt },
        { role: 'assistant', content: '看来你天生缺乏自律，而且肯定已经买好所有器材了。', createdAt: createdAt + 1000 }] }
  })
}

export async function experienceState(sessions = experienceSessions()): Promise<ReflectionState> {
  const specs: Array<{ id: string; content: string; kind: Reflection['kind']; basis: Reflection['basis']; tags: string[]; indices: number[]; uncertainty?: string }> = [
    { id: 'practice-event', content: '用户报告把手碟练习缩小成两分钟节奏后，当天完成了练习。', kind: 'event', basis: 'direct', tags: ['手碟', '练习'], indices: [0] },
    { id: 'smaller-tasks', content: '几次尝试中，目标过大时拖延；缩小成短小任务后更容易动手并完成，可作为类似新目标的参考。',
      kind: 'pattern', basis: 'mixed', tags: ['手碟', '画画', '缩小任务'], indices: [0, 1, 2], uncertainty: '仅依据三次用户报告，不代表稳定人格或适用于所有任务。' },
    { id: 'drawing-interest', content: '用户报告手碟先暂时放下，现在更想画画。', kind: 'preference', basis: 'direct', tags: ['手碟', '画画'], indices: [2] },
    { id: 'purchase-planned', content: '用户报告手碟尚未购买，还在考虑购买手碟。', kind: 'project-state', basis: 'direct', tags: ['手碟', '购买'], indices: [3] },
    { id: 'purchase-completed', content: '用户报告手碟已经购买并收到，虽然更想画画仍保留手碟。', kind: 'project-state', basis: 'direct', tags: ['手碟', '购买', '画画'], indices: [4] },
  ]
  const reflections = await Promise.all(specs.map(async ({ indices, ...r }) => ({ ...r, version: 1 as const,
    sourceRefs: await Promise.all(indices.map(i => sourceRef(sessions[i]!.id, 0, sessions[i]!.messages[0]!))),
    relatedReflectionIds: [], createdAt: Date.parse('2026-10-25T08:00:00Z') })))
  return { version: 1, reflections, progress: [], batches: reflections.map((r, i) => ({ id: `batch-${i}`,
    sessionId: r.sourceRefs[0]!.sessionId, sourceRefs: r.sourceRefs, units: 1, status: 'completed', attempts: 1, reflectionIds: [r.id] })) }
}
