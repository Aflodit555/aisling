import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createCharacterRuntime, createCharacter, createUserTextStimulus, type ChatCompletionRequest } from '@aisling/core'
import corpus from './__tests__/fixtures/p2-public-sequences.json'
import { createSituationWorkingState, SITUATION_LIMITS } from './situation-working-state'

afterEach(() => vi.useRealTimers())

// Literal mocks verify scope, bounded retention and prompt assembly, not model semantics.
it.each(corpus.cases)('replays $id through A state and B input offline', async sequence => {
  vi.useFakeTimers(); vi.setSystemTime(100_000)
  const s = createSituationWorkingState({ execute: async input => {
    const evidence = [...input.evidence, ...input.incoming].filter(e => e.kind === 'observation').slice(-6)
    return { scope: input.scope, baseRevision: input.baseRevision, covered: input.incoming.map(e => e.id),
      claims: evidence.map(e => ({ kind: 'fact', text: `Observed source text: ${e.text.slice(0, 150)}`,
        evidence: [{ id: e.id, version: e.version, quote: e.text.slice(0, 150) }] })),
      retracted: [], unknowns: ['Literal Mock: semantic continuity and user attention are unverified.'] }
  } })
  s.setEnabled(true)
  try {
    const scopes: string[] = []
    for (const observation of sequence.observations) {
      s.observe({ capturedAt: Date.now(), sequence: Date.now(), targetHwnd: '123',
        textFingerprint: createHash('sha256').update(observation.text).digest('hex'),
        focus: { app: 'public-replay', title: observation.refs[0]!.split(':')[0]!, text: observation.text },
        idleSeconds: 0, media: [], mic: [], headphones: '' })
      scopes.push(s.currentScope()!.scope); await s.flush()
      expect(s.status.lastEvent).toBe('updated')
      vi.setSystemTime(Date.now() + SITUATION_LIMITS.minIntervalMs)
    }
    if (sequence.id === 'S06') {
      expect(scopes[0]).not.toBe(scopes.at(-1))
      expect(JSON.stringify(s.snapshot()!.claims)).not.toContain('main context')
    }
    const requests: ChatCompletionRequest[] = []
    const runtime = createCharacterRuntime({
      character: createCharacter({ id: 'regression', name: 'Aisling', persona: 'Use source evidence only.', capabilities: [] }),
      getSituationContext: stimulus => s.contextFor(stimulus),
      getChatProvider: () => ({ id: 'offline-capture', complete: async request => { requests.push(request); return { text: '' } } }),
    })
    try {
      await runtime.ingest(createUserTextStimulus({ source: 'test', text: '当前页面相对此前有什么进展？' }))
      await runtime.ingest(createUserTextStimulus({ source: 'test', text: 'An unrelated question' }))
      expect(JSON.stringify(requests[0])).toContain('[Short-term understanding]')
      expect(JSON.stringify(requests[1])).not.toContain('[Short-term understanding]')
      expect(JSON.stringify(runtime.history)).not.toContain('[Short-term understanding]')
    }
    finally { runtime.dispose() }
  }
  finally { s.dispose() }
})
