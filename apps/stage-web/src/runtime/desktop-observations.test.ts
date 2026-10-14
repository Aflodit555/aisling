import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DesktopActivitySnapshot, DesktopCandidate } from '@aisling/core'
import { createDesktopObservations, mediaCandidateMatches, playingMedia, OBSERVATION_RETENTION_MS, type DesktopObservation } from './desktop-observations'

const track = (title = 'A') => ({ app: 'player', title, artist: 'Artist' })
function desktop(at: number, text = 'Article', app = 'chrome', title = 'Page', media = [] as ReturnType<typeof track>[]): DesktopActivitySnapshot {
  return { capturedAt: at, sequence: at, targetHwnd: '123', focus: { app, title, text }, media, mic: [], idleSeconds: 0, headphones: '',
    textFingerprint: createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex') }
}
function harness() {
  let time = 1000
  const records: DesktopObservation[] = []
  const memory = createDesktopObservations(records, () => time)
  const sample = (text = 'Article', app = 'chrome', title = 'Page', media = [] as ReturnType<typeof track>[]) => {
    time += 2000
    return memory.observe(desktop(time, text, app, title, media))
  }
  return { records, memory, sample, advance: (ms: number) => { time += ms } }
}
describe('bounded desktop object and content observations', () => {
  it('keeps a handled static article through a sampled window round trip', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.reserve(a.id); h.memory.complete(a.id, 'Article comment.', true)
    h.sample('QQ conversation', 'qq', 'QQ')
    const returned = h.sample()
    expect(returned.candidate?.id).toBe(a.id)
    expect(returned.observation).toMatchObject({ objectId: a.objectId, status: 'handled', recentReply: { summary: 'Article comment.' } })
  })
  it('separates object existence from content revisions and remembers a previous revision', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.complete(a.id, 'First page.', false)
    expect(h.sample('New article').reason).toBe('foreground-stabilizing')
    const b = h.sample('New article').candidate!
    expect(b.objectId).toBe(a.objectId)
    expect(b.id).not.toBe(a.id)
    expect(b.change).toBe('content-changed')
    expect(h.sample().observation?.status).toBe('handled')
  })
  it('ignores transient revisions and still offers a stable new section in the same title', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.complete(a.id, 'Article comment.', false)
    for (const text of ['Article 1', 'Article 2', 'Article 1', 'Article 2']) {
      const observed = h.sample(text)
      expect(observed.reason).toBe('foreground-stabilizing'); expect(observed.candidate).toBeUndefined()
    }
    expect(h.sample('New visible section').candidate).toBeUndefined()
    const next = h.sample('New visible section')
    expect(next.candidate).toMatchObject({ objectId: a.objectId, change: 'content-changed', target: { text: 'New visible section' } })
    expect(next.observation?.status).toBe('new')
  })
  it('supersedes observed pending versions on delivery without claiming they were delivered', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.reserve(a.id)
    h.sample('Article variation')
    const b = h.sample('Article variation').observation!
    b.judgment = { key: 'cached', candidateId: b.candidateId, scores: { shouldInterrupt: 0.74 }, historyIncluded: false }
    h.sample('Unstable variation')
    h.memory.complete(a.id, 'Article comment.', true)
    expect(b).toMatchObject({ status: 'superseded', deliveredAt: null })
    expect(b.judgment).toBeUndefined()
    expect(h.sample('Unstable variation').observation?.status).toBe('superseded')
    h.sample('QQ conversation', 'qq', 'QQ')
    expect(h.sample('Article variation').observation?.status).toBe('superseded')
    expect(h.memory.find(a.id)).toMatchObject({ status: 'handled', recentReply: { summary: 'Article comment.' } })
  })
  it('retires cached pending revisions when leaving a replied-to page, including an idle return', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.complete(a.id, 'Article comment.', false)
    h.sample('Article variation')
    const pending = h.sample('Article variation').observation!
    pending.judgment = { key: 'cached', candidateId: pending.candidateId, scores: { shouldInterrupt: 0.74 }, historyIncluded: false }
    h.sample('QQ conversation', 'qq', 'QQ')
    expect(pending.status).toBe('superseded'); expect(pending.judgment).toBeUndefined()
    expect(h.sample('Article variation').observation?.status).toBe('superseded')
    expect(h.memory.observe({ ...desktop(100_000, 'Article variation'), idleSeconds: 60 }).observation?.status).toBe('superseded')
  })
  it('does not restore a superseded older pending version after a newer stable version', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.complete(a.id, 'Article comment.', false)
    h.sample('Section B'); const b = h.sample('Section B').observation!
    h.sample('Section C'); const c = h.sample('Section C').observation!
    expect(b.status).toBe('superseded'); expect(c.status).toBe('new')
    expect(h.sample('Section B').observation?.status).toBe('superseded')
  })
  it('preserves another title observed during generation and lets a new webpage respond in the same window', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.reserve(a.id)
    h.sample('Another article', 'chrome', 'New page')
    const page = h.sample('Another article', 'chrome', 'New page').observation!
    h.memory.complete(a.id, 'Old page comment.', false)
    h.sample('QQ conversation', 'qq', 'QQ')
    expect(h.sample('Another article', 'chrome', 'New page').candidate).toBeUndefined()
    const returned = h.sample('Another article', 'chrome', 'New page')
    expect(returned.observation).toBe(page); expect(page.status).toBe('new')
    expect(returned.candidate?.objectId).toBe(a.objectId)
  })
  it('requires fresh contiguous samples rather than duplicate captures or recovery gaps', () => {
    let time = 1000
    const memory = createDesktopObservations([], () => time)
    memory.observe(desktop(time))
    const changed = desktop(time = 3000, 'New section')
    expect(memory.observe(changed).candidate).toBeUndefined()
    expect(memory.observe(changed).candidate).toBeUndefined()
    expect(memory.observe(desktop(time = 34_000, 'New section')).candidate).toBeUndefined()
    expect(memory.observe(desktop(time = 36_000, 'New section')).candidate).toBeDefined()
  })
  it('requires two stable media samples, ignores lyrics and targets the new track', () => {
    const h = harness()
    expect(h.sample('Lyric A', 'player', 'A', [track()]).candidate).toBeUndefined()
    const a = h.sample('Lyric B', 'player', 'A', [track()]).candidate!
    expect(a.source).toBe('media')
    h.memory.complete(a.id, 'A song comment.', true)
    for (let i = 0; i < 5; i++) expect(h.sample(`Lyric ${i}`, 'player', 'A', [track()]).observation?.status).toBe('handled')
    expect(h.sample('Old lyric A', 'player', 'A', [track('B')]).candidate).toBeUndefined()
    const b = h.sample('Old lyric A', 'player', 'A', [track('B')]).candidate!
    expect(b).toMatchObject({ source: 'media', target: { title: 'B' } })
    expect(b.objectId).not.toBe(a.objectId)
    expect(h.records).toHaveLength(2)
  })
  it('does not treat duplicates, order changes, ambiguity or short dropout as new tracks', () => {
    const h = harness()
    h.sample('Lyrics', 'player', 'A', [track()])
    const a = h.sample('Lyrics', 'player', 'A', [track()]).candidate!
    h.memory.complete(a.id, 'Reply.', false)
    expect(playingMedia([track(), { ...track(), app: 'PLAYER.exe' }])?.title).toBe('A')
    expect(h.sample('Other lyric', 'player', 'A', [track(), track('B')]).candidate).toBeUndefined()
    expect(h.sample('Other lyric', 'player', 'A', [track('B'), track()]).candidate).toBeUndefined()
    expect(h.sample('Other lyric', 'player', 'A', []).candidate).toBeUndefined()
    h.sample('Other lyric', 'player', 'A', [track()])
    expect(h.sample('Other lyric', 'player', 'A', [track(), track()]).candidate?.id).toBe(a.id)
  })
  it('keeps idle opportunity finite and allows a later genuinely new idle episode', () => {
    const records: DesktopObservation[] = [], memory = createDesktopObservations(records, () => time)
    let time = 1000
    const a = memory.observe(desktop(time)).candidate!
    time = 2000
    const idle = memory.observe({ ...desktop(time), idleSeconds: 60 }).candidate!
    expect(idle.change).toBe('idle'); expect(idle.id).not.toBe(a.id)
    for (let i = 0; i < 10; i++) expect(memory.observe({ ...desktop(time += 2000), idleSeconds: 62 + i }).candidate?.id).toBe(idle.id)
    memory.complete(idle.id, 'Idle comment.', false)
    time += 300_000
    expect(memory.observe({ ...desktop(time), idleSeconds: 400 }).candidate?.id).toBe(idle.id)
    memory.observe({ ...desktop(time += 2000), idleSeconds: 0 })
    expect(memory.observe({ ...desktop(time += 60000), idleSeconds: 60 }).candidate?.id).not.toBe(idle.id)
  })
  it('releases failures, records success by candidate, clears only history on opt-out and bounds retention', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.reserve(a.id); h.memory.complete(a.id, undefined, true)
    expect(h.records[0]?.status).toBe('new')
    h.memory.complete(a.id, 'Reply https://private.example', true)
    expect(h.records[0]?.recentReply?.summary).not.toContain('private.example')
    h.memory.clearReplyHistory()
    expect(h.records[0]?.status).toBe('handled'); expect(h.records[0]?.recentReply).toBeUndefined()
    h.advance(OBSERVATION_RETENTION_MS + 1)
    expect(h.sample().candidate?.objectId).not.toBe(a.objectId)
    for (let i = 0; i < 100; i++) h.sample(`Page ${i}`)
    expect(h.records.length).toBeLessThanOrEqual(32)
  })
  it('treats competing or missing current media as stale, without semantic matching', () => {
    const candidate: DesktopCandidate = { id: 'c', objectId: 'o', source: 'media', change: 'track-changed', target: track(), snapshot: desktop(1000) }
    expect(mediaCandidateMatches(candidate, desktop(2000, 'Old lyric', 'player', 'A', [track('B')]))).toBe(false)
    expect(mediaCandidateMatches(candidate, desktop(2000, '', 'player', 'A', [track(), track('B')]))).toBe(false)
    expect(mediaCandidateMatches(candidate, desktop(2000, '', 'player', 'A', [track(), track()]))).toBe(true)
  })
  it('expires reply summaries without reopening a continuously retained handled target', () => {
    const h = harness(), a = h.sample().candidate!
    h.memory.complete(a.id, 'Reply.', true)
    h.advance(300001); h.sample()
    h.advance(300001)
    expect(h.sample().observation).toMatchObject({ candidateId: a.id, status: 'handled' })
    expect(h.records[0]?.recentReply).toBeUndefined()
  })
  it('allows an old track to return after a stable different track and the finite reply interval, never on continuous playback', () => {
    const h = harness()
    h.sample('Lyrics', 'player', 'A', [track()])
    const a = h.sample('Lyrics', 'player', 'A', [track()]).candidate!
    h.memory.complete(a.id, 'A reply.', true)
    for (let i = 0; i < 151; i++)
      expect(h.sample('New lyric', 'player', 'A', [track()]).observation?.status).toBe('handled')
    h.sample('Lyrics', 'player', 'B', [track('B')]); h.sample('Lyrics', 'player', 'B', [track('B')])
    h.sample('Lyrics', 'player', 'A', [track()])
    const returned = h.sample('Lyrics', 'player', 'A', [track()])
    expect(returned.candidate?.objectId).toBe(a.objectId)
    expect(returned.candidate?.id).not.toBe(a.id)
    expect(returned.observation).toMatchObject({ status: 'new', deliveredAt: null, recentReply: { summary: 'A reply.' } })
  })
})
