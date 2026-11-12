import type { NoteFormationContext, OperationProposal } from './note-formation-contract.mjs'
import type { EvidenceRef, NoteV2, NoteV2Sources, NoteRelationOperation } from './memory-database/store'
type Citation = { ref: EvidenceRef; quote: string }
export interface SemanticJudgment {
  relation: 'independent' | 'same' | 'state-change' | 'continuation' | 'supplement' | 'conflict' | 'uncertain'
  target: NoteV2 | null; scope: string; sources: Citation[]; targetSources: Citation[]
}
export interface SemanticRelationProposal {
  from: NoteV2; to: NoteV2; type: NoteRelationOperation['type']; scope: string; reason: string; sources: Citation[]
}
export const semanticLimits: { intervalMs: number; callsPerHour: number; timeoutMs: number; outputTokens: number }
export function refKey(ref: EvidenceRef): string
export function parseSemanticJudgment(value: unknown, context: NoteFormationContext): SemanticJudgment
export function authorizeSemantic(proposal: OperationProposal, context: { lookup(ref: EvidenceRef): { role: string } | undefined; complete: boolean }): boolean
export function semanticRelationPlan(type: NoteRelationOperation['type'], scope: string,
  first: { note: NoteV2; grounds: NoteV2Sources }, second: { note: NoteV2; grounds: NoteV2Sources },
  sources: Array<Citation | EvidenceRef>, lookup: (ref: EvidenceRef) => any, reason: string): Omit<NoteRelationOperation, 'operationId' | 'action'> | null
export function organizationInput(context: NoteFormationContext): { messages: Array<{ role: 'system' | 'user'; content: string }> }
export function parseSemanticRelations(raw: string, context: NoteFormationContext): SemanticRelationProposal[]
