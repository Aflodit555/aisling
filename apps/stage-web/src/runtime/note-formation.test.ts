import { expect, it, vi } from 'vitest'
import { createNoteFormation, type NoteFormationBridge } from './note-formation'
import type { NoteFormationContext } from '../../../stage-desktop/note-formation-contract.mjs'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef } from './formation-evidence'
import speakers from '../../../stage-desktop/memory-subjects.json'

it('polls idle semantic work through the existing Provider, and cancels on Provider removal', async () => {
  vi.useFakeTimers()
  let runner: ReturnType<typeof createNoteFormation> | undefined
  try {
    const session: ConversationSession = { id: 'original', title: 'test', createdAt: 1, updatedAt: 2,
      messages: [{ role: 'user', content: '纸舟支持离线导出。', createdAt: 1 }, { role: 'user', content: '补充：仅提供PDF。', createdAt: 2 }] }
    const refs = await Promise.all(session.messages.map((message, i) => sourceRef(session.id, i, message)))
    const context: NoteFormationContext = { mode: 'organization', speakers, notes: refs.map((_, i) => ({ id: 'note-' + i,
      version: 1, status: 'active', createdAt: i + 1, subject: 'profile-user', content: session.messages[i]!.content!,
      kind: 'fact', basis: 'direct', eventTime: null })), evidence: refs.map((ref, i) => ({ ref,
      message: { role: 'user', content: session.messages[i]!.content! }, scope: 'history' })),
      noteGrounds: { 'note-0': [refs[0]!], 'note-1': [refs[1]!] } }
    let busy = true, claimed = false
    const bridge: NoteFormationBridge = { delivered: vi.fn(async () => {}), flush: vi.fn(async () => {}),
      next: vi.fn(async allow => allow && !claimed ? (claimed = true, { id: 'organization-note-0-1', attempt: 1,
        kind: 'organization' as const, sessionId: '', refs }) : null), prepare: vi.fn(async () => context),
      submit: vi.fn(async () => {}), fail: vi.fn(async () => {}) }
    const complete = vi.fn(async () => ({ text: '{"relations":[]}' }))
    runner = createNoteFormation(bridge, () => [session], () => undefined, () => busy)
    runner.setProvider({ id: 'shared', complete })
    await vi.advanceTimersByTimeAsync(0)
    expect(complete).not.toHaveBeenCalled()
    busy = false
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(bridge.submit).toHaveBeenCalledWith('organization-note-0-1', 1, '{"relations":[]}'))
    expect(bridge.delivered).not.toHaveBeenCalled()
    claimed = false
    let signal: AbortSignal | undefined
    runner.setProvider({ id: 'replacement', complete: vi.fn(async request => {
      signal = request.signal
      return new Promise<{ text: string }>(() => {})
    }) })
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(signal).toBeDefined())
    runner.setProvider(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(signal?.aborted).toBe(true)
    expect(bridge.fail).toHaveBeenCalledWith('organization-note-0-1', 1, 'cancelled')
  } finally { runner?.setProvider(undefined); vi.useRealTimers() }
})
