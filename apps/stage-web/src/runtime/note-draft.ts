import type { NoteMeaning } from '../../../stage-desktop/memory-database/store'
import type { ConversationSession } from '../conversation/conversation-store'
import { sourceRef } from './reflection-formation'
import { safeText } from './memory-recall'
import { reflectionValidationField, type Reflection, type ReflectionKind, type SourceRef } from './reflection-store'

export interface NoteIdentity { id: string; version: number; subject: string }
/** Supplied by a trusted caller after identity confirmation, never deserialized from a model response. */
export interface SubjectAnchor {
  label: string; subject: string; confirmed: boolean; targets: NoteIdentity[]
  mentions: Array<{ label: string; text: string }>
}
export interface DraftEvidence { label: string; ref: SourceRef }
export interface DraftProposal {
  content: string
  subject: string
  subjectDescription?: string
  eventTime: NoteMeaning['eventTime']
  basis: Reflection['basis']
  uncertainty?: string
  kind: ReflectionKind
  tags: string[]
  context?: string
  keywords?: string[]
  sources: Array<{ label: string; quote: string }>
}
export type NoteDraft = NoteMeaning & {
  kind: ReflectionKind
  origins: Array<{ reflectionId: string }>
  evidence: SourceRef[]
  sourceCategories: Array<'user-report' | 'assistant-speech' | 'autonomous-speech'>
  subjectAnchor: SubjectAnchor
  subjectDescription?: string
}

const sameRef = (a: SourceRef, b: SourceRef) => a.sessionId === b.sessionId && a.messageIndex === b.messageIndex && a.digest === b.digest
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max
function check(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code) }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
}

/** Maps explicitly proposed pieces. Atomicity and semantic support still require upstream judgment. */
export async function adaptReflectionDrafts(reflection: Reflection, proposals: DraftProposal[], context: {
  evidence: DraftEvidence[]; subjects: SubjectAnchor[]; getSessions: () => ConversationSession[]; reviewOnly?: boolean
}): Promise<NoteDraft[]> {
  check(Array.isArray(proposals) && proposals.length <= 3, 'draft-count')
  const output: NoteDraft[] = []
  for (const proposal of proposals) {
    check(proposal && Object.keys(proposal).every(key => ['content', 'subject', 'subjectDescription', 'eventTime', 'basis',
      'uncertainty', 'kind', 'tags', 'context', 'keywords', 'sources'].includes(key)), 'draft-fields')
    const anchors = context.subjects.filter(anchor => anchor.label === proposal.subject)
    check(anchors.length === 1 && (anchors[0]!.confirmed || context.reviewOnly === true) && text(anchors[0]!.subject, 128), 'subject-unconfirmed')
    const anchor = anchors[0]!
    check(proposal.subjectDescription === undefined || text(proposal.subjectDescription, 128), 'subject-description')
    check(proposal.context === undefined || text(proposal.context, 800), 'draft-context')
    check(proposal.keywords === undefined || Array.isArray(proposal.keywords) && proposal.keywords.length <= 12
      && proposal.keywords.every(word => text(word, 40)), 'draft-keywords')
    check(Array.isArray(proposal.sources) && proposal.sources.length > 0 && proposal.sources.length <= 12, 'draft-sources')
    const references: SourceRef[] = []
    const messages: ConversationSession['messages'] = []
    for (const citation of proposal.sources) {
      check(citation && Object.keys(citation).every(key => ['label', 'quote'].includes(key)) && text(citation.quote, 6000), 'draft-quote')
      const matches = context.evidence.filter(item => item.label === citation.label)
      check(matches.length === 1 && reflection.sourceRefs.some(ref => sameRef(ref, matches[0]!.ref)), 'draft-source-outside-origin')
      const ref = matches[0]!.ref
      const sessions = context.getSessions().filter(session => session.id === ref.sessionId)
      check(sessions.length === 1, 'draft-session-missing-or-ambiguous')
      const message = sessions[0]!.messages[ref.messageIndex]
      check(message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
        && !message.toolCalls?.length && !message.toolCallId && safeText(message.content), 'draft-message-ineligible')
      check((await sourceRef(ref.sessionId, ref.messageIndex, message)).digest === ref.digest, 'draft-digest-mismatch')
      check(message.content.includes(citation.quote), 'draft-quote-not-in-source')
      if (!references.some(old => sameRef(old, ref))) { references.push({ ...ref }); messages.push(message) }
    }
    check(anchor.mentions.some(mention => text(mention.text, 800) && proposal.sources.some(citation => citation.label === mention.label
      && citation.quote.includes(mention.text))), 'draft-subject-not-in-quote')
    const candidate: Reflection = { ...reflection, content: proposal.content, kind: proposal.kind, basis: proposal.basis,
      tags: proposal.tags, sourceRefs: references, uncertainty: proposal.uncertainty }
    check(reflectionValidationField(candidate) === undefined, 'draft-reflection-fields')
    const users = messages.filter(message => message.role === 'user')
    check(!['fact', 'preference', 'project-state'].includes(proposal.kind) || users.length > 0, 'draft-assistant-only-claim')
    check(proposal.kind !== 'pattern' || users.length >= 2 && text(proposal.uncertainty, 300), 'draft-pattern-evidence')
    const sourceCodes = new Set(messages.flatMap(message => message.content?.match(/\b[ER]\d+\b/g) ?? []))
    const statement = `${proposal.content} ${proposal.tags.join(' ')} ${proposal.uncertainty ?? ''}`
    check((statement.match(/\b[ER]\d+\b/g) ?? []).every(code => sourceCodes.has(code)), 'draft-reference-in-text')
    check(!references.some(ref => statement.includes(ref.sessionId)), 'draft-source-id-in-text')
    const time = proposal.eventTime
    let eventTime: NoteMeaning['eventTime'] = null
    if (time !== null) {
      check(time && typeof time === 'object', 'draft-event-time')
      if (time.kind === 'date') {
        check(Object.keys(time).length === 2 && validDate(time.date), 'draft-event-date')
        eventTime = { kind: 'date', date: time.date }
      } else {
        check(time.kind === 'date-range' && Object.keys(time).length === 3 && validDate(time.start) && validDate(time.end)
          && time.start <= time.end, 'draft-event-range')
        eventTime = { kind: 'date-range', start: time.start, end: time.end }
      }
      const dates = eventTime.kind === 'date' ? [eventTime.date] : [eventTime.start, eventTime.end]
      check(dates.every(date => proposal.sources.some(source => source.quote.includes(date))), 'draft-date-not-in-quote')
    }
    const meaning = { content: proposal.content, subject: anchor.subject, eventTime, basis: proposal.basis,
      tags: [...proposal.tags], ...(proposal.uncertainty === undefined ? {} : { uncertainty: proposal.uncertainty }),
      ...(proposal.context === undefined ? {} : { context: proposal.context }),
      ...(proposal.keywords === undefined ? {} : { keywords: [...proposal.keywords] }) } as NoteMeaning
    output.push({ ...meaning, kind: proposal.kind, origins: [{ reflectionId: reflection.id }], evidence: references,
      sourceCategories: [...new Set(messages.map(message => message.role === 'user' ? 'user-report' as const
        : message.autonomousContext ? 'autonomous-speech' as const : 'assistant-speech' as const))],
      subjectAnchor: { ...anchor, targets: anchor.targets.map(target => ({ ...target })), mentions: anchor.mentions.map(mention => ({ ...mention })) },
      ...(proposal.subjectDescription === undefined ? {} : { subjectDescription: proposal.subjectDescription }) })
  }
  return output
}

export function assertDraftTarget(draft: NoteDraft, target: NoteIdentity): void {
  check(draft.subjectAnchor.confirmed && draft.subject === target.subject && draft.subjectAnchor.targets.some(bound => bound.id === target.id
    && bound.version === target.version && bound.subject === target.subject), 'draft-target-not-confirmed')
}
