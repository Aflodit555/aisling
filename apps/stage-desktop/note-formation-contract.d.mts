import type { EvidenceRef, NoteMeaningV2, NoteV2, NoteV2Operation } from './memory-database/store'

export interface NoteFormationContext {
  evidence: Array<{ ref: EvidenceRef; message: { role: string; content: string; createdAt?: number; autonomousContext?: unknown }; scope: 'current' | 'history' }>
  notes: NoteV2[]
  speakers: Record<'user' | 'assistant', { subject: string; prefix: string }>
}
export interface NoteDraft {
  meaning: NoteMeaningV2
  confirmed: boolean
  citations: Array<{ ref: EvidenceRef; quote: string }>
}
export interface OperationProposal {
  action: NoteV2Operation['action'] | 'UNDECIDED'
  reason: string
  draft: NoteDraft | null
  target: NoteV2 | null
  related: string[]
}
export const limits: { units: number; sources: number; evidenceBytes: number; inputBytes: number; outputChars: number; timeoutMs: number }
export function formationInput(context: NoteFormationContext): { messages: Array<{ role: 'system' | 'user'; content: string }> }
export function parseNoteProposals(raw: string, context: NoteFormationContext): OperationProposal[]
