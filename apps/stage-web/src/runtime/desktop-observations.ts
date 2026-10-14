import type { DesktopActivitySnapshot, DesktopCandidate, DesktopMediaSnapshot } from '@aisling/core'

export const OBSERVATION_RETENTION_MS = 10 * 60_000
export const REPLY_REVISIT_MS = 5 * 60_000
export const CAPTURE_MAX_GAP_MS = 30_000
export const IDLE_OPPORTUNITY_SECONDS = 60
export const MAX_OBSERVATIONS = 32
export const MEDIA_STABLE_SAMPLES = 2
export const FOREGROUND_STABLE_SAMPLES = 2

export interface CandidateJudgment {
  key: string
  candidateId: string
  scores: { shouldInterrupt: number }
  historyIncluded: boolean
  trace?: { sampleId: string; judgmentId?: string; judgmentSampleId?: string }
}

export interface DesktopObservation {
  objectId: string
  candidateId: string
  source: DesktopCandidate['source']
  app: string
  identity: string
  content: string
  // shortcut: app/HWND/title scopes lifecycle; distinguishing same-title documents needs stronger capture data.
  foregroundScope?: string
  change: DesktopCandidate['change']
  lastSeenAt: number
  status: 'new' | 'reserved' | 'handled' | 'superseded'
  deliveredAt: number | null
  idleOffered: boolean
  recentReply?: { deliveredAt: number; summary: string }
  judgment?: CandidateJudgment
}

export function normalizeApp(app: string): string { return app.trim().toLowerCase().replace(/\.exe$/, '') }
export function mediaIdentity(item: DesktopMediaSnapshot): string {
  return JSON.stringify([normalizeApp(item.app), item.title.trim(), item.artist.trim()])
}

/** Order and duplicate sessions are not track changes. Incomplete or competing identities are unknown. */
export function playingMedia(media: readonly DesktopMediaSnapshot[]): DesktopMediaSnapshot | undefined {
  if (!media.length || media.some(item => !item.app.trim() || !item.title.trim() || item.app.length >= 120 || item.title.length >= 300 || item.artist.length >= 200)) return undefined
  const unique = new Map(media.map(item => [mediaIdentity(item), item]))
  return unique.size === 1 ? unique.values().next().value : undefined
}

export function mediaCandidateMatches(candidate: DesktopCandidate, context: DesktopActivitySnapshot): boolean {
  if (candidate.source !== 'media') return true
  const current = playingMedia(context.media)
  return Boolean(current && mediaIdentity(current) === mediaIdentity(candidate.target))
}

export function boundedReplyText(text: string): string {
  if (/password|api.?key|验证码|密码/i.test(text)) return '[redacted]'
  return text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bsk-[\w-]{8,}|\d{7,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

/** One bounded registry owns reservation, successful delivery and recent target replies. */
export function createDesktopObservations(records: DesktopObservation[], now = Date.now) {
  let mediaProbe: { identity: string; count: number; capturedAt: number } | undefined
  let foregroundProbe: { content: string; scope: string; count: number; capturedAt: number } | undefined
  let activeForegroundScope: string | undefined

  function supersedePending(scope: string, except?: DesktopObservation): void {
    for (const record of records) {
      if (record.foregroundScope !== scope || record === except || record.status !== 'new') continue
      record.status = 'superseded'
      delete record.judgment
    }
  }
  function leaveForeground(): void {
    if (activeForegroundScope && records.some(record => record.foregroundScope === activeForegroundScope && record.deliveredAt !== null)) supersedePending(activeForegroundScope)
    activeForegroundScope = undefined
    foregroundProbe = undefined
  }

  function expire(): void {
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i]!
      if (record.recentReply && now() - record.recentReply.deliveredAt > OBSERVATION_RETENTION_MS) delete record.recentReply
      if (record.status !== 'reserved' && (now() < record.lastSeenAt || now() - record.lastSeenAt > OBSERVATION_RETENTION_MS)) records.splice(i, 1)
    }
    while (records.length > MAX_OBSERVATIONS) {
      const oldest = records.filter(record => record.status !== 'reserved').reduce<DesktopObservation | undefined>((a, b) => !a || b.lastSeenAt < a.lastSeenAt ? b : a, undefined)
      const index = oldest ? records.indexOf(oldest) : -1
      if (index < 0) break
      records.splice(index, 1)
    }
  }

  function observe(context: DesktopActivitySnapshot): { candidate?: DesktopCandidate; observation?: DesktopObservation; reason: string } {
    expire()
    const selected = playingMedia(context.media)
    const mediaKey = selected ? mediaIdentity(selected) : ''
    const contiguous = mediaProbe && mediaProbe.identity === mediaKey && context.capturedAt > mediaProbe.capturedAt
      && context.capturedAt - mediaProbe.capturedAt <= CAPTURE_MAX_GAP_MS
    mediaProbe = selected ? { identity: mediaKey, count: contiguous ? mediaProbe!.count + 1 : 1, capturedAt: context.capturedAt } : undefined
    const choices: { candidate: DesktopCandidate; observation: DesktopObservation }[] = []
    let foregroundStabilizing = false

    function add(source: DesktopCandidate['source'], identity: string, content: string, target: DesktopCandidate['target']): void {
      const priorMedia = source === 'media' ? records.filter(record => record.source === 'media')
        .reduce<DesktopObservation | undefined>((a, b) => !a || b.lastSeenAt > a.lastSeenAt ? b : a, undefined) : undefined
      let observation = records.find(record => record.source === source && record.identity === identity && record.content === content)
      if (!observation) {
        const objectId = records.find(record => record.source === source && record.identity === identity)?.objectId ?? crypto.randomUUID()
        observation = { objectId, candidateId: crypto.randomUUID(), source, app: target.app, identity, content,
          change: source === 'media' ? records.some(record => record.source === 'media' && normalizeApp(record.app) === normalizeApp(target.app)) ? 'track-changed' : 'appeared'
            : records.some(record => record.objectId === objectId) ? 'content-changed' : 'appeared',
          ...(source === 'foreground' ? { foregroundScope: activeForegroundScope } : {}),
          lastSeenAt: now(), status: 'new', deliveredAt: null, idleOffered: context.idleSeconds >= IDLE_OPPORTUNITY_SECONDS }
        records.push(observation)
        expire()
      }
      else {
        observation.lastSeenAt = now()
        if (source === 'media' && priorMedia && priorMedia.identity !== identity && observation.status === 'handled'
          && observation.deliveredAt !== null && now() - observation.deliveredAt >= REPLY_REVISIT_MS) {
          observation.candidateId = crypto.randomUUID()
          observation.change = 'track-changed'
          observation.status = 'new'
          observation.deliveredAt = null
        }
        if (source === 'foreground' && observation.status !== 'superseded') {
          if (context.idleSeconds < IDLE_OPPORTUNITY_SECONDS) observation.idleOffered = false
          else if (!observation.idleOffered && observation.status !== 'reserved') {
            observation.idleOffered = true
            if (observation.deliveredAt === null || now() - observation.deliveredAt >= REPLY_REVISIT_MS) {
              observation.candidateId = crypto.randomUUID()
              observation.change = 'idle'
              observation.status = 'new'
              observation.deliveredAt = null
            }
          }
        }
      }
      if (source === 'foreground' && observation.status === 'new' && observation.change !== 'appeared') {
        if (!foregroundProbe || foregroundProbe.count < FOREGROUND_STABLE_SAMPLES) { foregroundStabilizing = true; return }
        if (records.some(record => record.foregroundScope === activeForegroundScope && record.deliveredAt !== null)) supersedePending(activeForegroundScope!, observation)
      }
      const base = { id: observation.candidateId, objectId: observation.objectId, change: observation.change,
        snapshot: { capturedAt: context.capturedAt, targetHwnd: context.targetHwnd, sequence: context.sequence } }
      const candidate: DesktopCandidate = source === 'media'
        ? { ...base, source, target: target as DesktopMediaSnapshot }
        : { ...base, source, target: context.focus }
      choices.push({ candidate, observation })
    }

    if (selected && mediaProbe!.count >= MEDIA_STABLE_SAMPLES) add('media', mediaKey, mediaKey, selected)
    const { focus, textFingerprint } = context
    // No application-specific lyrics rules: when an app owns Playing media,
    // its changing UIA is background, including brief session dropouts.
    const mediaOwned = context.media.some(item => normalizeApp(item.app) === normalizeApp(focus.app))
      || records.some(record => record.source === 'media' && normalizeApp(record.app) === normalizeApp(focus.app))
    const trusted = focus.app.trim() && focus.app.length < 120 && focus.title.trim() && focus.title.length < 300
      && focus.text.trim() && focus.text.length <= 2000 && textFingerprint && /^[a-f0-9]{64}$/.test(textFingerprint)
      && /^\d+$/.test(context.targetHwnd) && context.targetHwnd !== '0'
    const identity = JSON.stringify([context.targetHwnd, focus.app])
    const scope = JSON.stringify([identity, focus.title])
    if (activeForegroundScope && scope !== activeForegroundScope) leaveForeground()
    if (!mediaOwned && trusted) {
      activeForegroundScope = scope
      const content = JSON.stringify([focus.title, textFingerprint])
      const contiguous = foregroundProbe && foregroundProbe.scope === scope && foregroundProbe.content === content
        && context.capturedAt > foregroundProbe.capturedAt && context.capturedAt - foregroundProbe.capturedAt <= CAPTURE_MAX_GAP_MS
      foregroundProbe = { scope, content, count: contiguous ? foregroundProbe!.count + 1 : 1, capturedAt: context.capturedAt }
      add('foreground', identity, content, focus)
    }
    else foregroundProbe = undefined
    const choice = choices.find(item => item.observation.status === 'new') ?? choices[0]
    return choice ? { ...choice, reason: 'candidate' } : { reason: foregroundStabilizing ? 'foreground-stabilizing'
      : mediaOwned ? selected ? 'media-stabilizing' : 'media-ambiguous' : 'foreground-unavailable' }
  }

  function find(id: string) { return records.find(record => record.candidateId === id) }
  function reserve(id: string): void { const record = find(id); if (record) record.status = 'reserved' }
  function complete(id: string, text: string | undefined, includeHistory: boolean): boolean {
    const record = find(id)
    if (!record) return false
    if (!text?.trim()) { if (record.status === 'reserved') record.status = 'new'; return false }
    record.status = 'handled'
    record.deliveredAt = now()
    // Consume already observed pending versions of this reading context, not future content or another title.
    if (record.foregroundScope) supersedePending(record.foregroundScope)
    if (includeHistory) record.recentReply = { deliveredAt: now(), summary: boundedReplyText(text) }
    return includeHistory
  }
  function clearReplyHistory(): void { for (const record of records) delete record.recentReply }
  function clearJudgments(): void { for (const record of records) delete record.judgment }
  function interrupt(): void { mediaProbe = undefined; leaveForeground() }
  return { observe, find, reserve, complete, clearReplyHistory, clearJudgments, interrupt }
}
