import type { EvidenceRef, NoteMeaningV2, NoteV2, NoteV2Operation } from './memory-database/store'

export interface NoteFormationContext {
  mode?: 'organization'
  noteGrounds?: Record<string, EvidenceRef[]>
  candidatesComplete?: boolean
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
  semantic?: import('./note-semantic-contract.mjs').SemanticJudgment
  action: NoteV2Operation['action'] | 'UNDECIDED'
  reason: string
  draft: NoteDraft | null
  target: NoteV2 | null
  related: string[]
}
export const limits: { units: number; sources: number; evidenceBytes: number; inputBytes: number; outputChars: number; timeoutMs: number }
export function formationInput(context: NoteFormationContext): { messages: Array<{ role: 'system' | 'user'; content: string }> }
export function parseNoteProposals(raw: string, context: NoteFormationContext): OperationProposal[]
export function parseNoteBatch(raw: string, context: NoteFormationContext): Array<{ wire: any; proposal: OperationProposal | null; error?: string }>
