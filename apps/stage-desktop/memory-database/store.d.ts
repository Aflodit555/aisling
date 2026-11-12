export interface Note {
  id: string
  content: string
  createdAt: number
}

export interface Origin { reflectionId: string }
export interface EvidenceRef { sessionId: string; messageIndex: number; digest: string }

export type EventTime = null | { kind: 'date'; date: string } | { kind: 'instant'; epochMs: number }
  | { kind: 'date-range'; start: string; end: string }
type NoteBasis = { basis: 'direct'; uncertainty?: string } | { basis: 'mixed' | 'inferred'; uncertainty: string }
type MeaningFields = { content: string; subject: string; eventTime: EventTime; tags?: string[] }
export type NoteMeaning = MeaningFields & NoteBasis & { context?: string; keywords?: string[] }
export type NoteV1 = NoteMeaning & { id: string; createdAt: number; status: 'active' | 'superseded' | 'retracted'; version: number }
export interface NoteSources { origins: Origin[]; evidence: EvidenceRef[] }
type ExistingNote = { expectedVersion: number }
type Operation<Meaning, Sources> = { operationId: string; id: string; reason: string; sources: Sources } & (
  | { action: 'ADD'; meaning: Meaning }
  | (ExistingNote & { action: 'UPDATE'; meaning: Meaning })
  | (ExistingNote & { action: 'NOOP' | 'RETRACT' })
  | (ExistingNote & { action: 'SUPERSEDE'; newId: string; meaning: Meaning; transition: 'explicit-same-scope-change' })
)
export type NoteOperation = Operation<NoteMeaning, NoteSources>
export interface NoteRevision {
  noteId: string; version: number; operationId: string; action: Exclude<NoteOperation['action'], 'NOOP'>
  changedAt: number; reason: string; grounds: NoteSources; snapshot: NoteV1; successorId?: string
}
export interface OperationReceipt {
  operationId: string; fingerprint: string; action: NoteOperation['action']; changedAt: number
  affectedNotes: Array<{ id: string; version: number }>; links?: NoteSources
}
export interface VersionSourceChanges { changes: OperationReceipt[]; nextCursor: string | null }
export interface ErasureScope { operationId: string; evidence: EvidenceRef[]; originIds: string[]; sessionIds: string[] }

export type NoteKind = 'event' | 'fact' | 'pattern' | 'preference' | 'project-state' | 'open-question'
export type NoteMeaningV2 = MeaningFields & NoteBasis & { state?: { scope: string; value: string } } & (
  | { kind: 'pattern'; uncertainty: string }
  | { kind: Exclude<NoteKind, 'pattern'> }
)
export type NoteV2 = NoteMeaningV2 & Pick<NoteV1, 'id' | 'createdAt' | 'status' | 'version'>
export interface NoteV2Sources { evidence: EvidenceRef[] }
export type NoteV2Operation = Operation<NoteMeaningV2, NoteV2Sources>
export type NoteRuntimeOperation = NoteV2Operation & { contextEvidence: EvidenceRef[] }
export type NoteV2Revision = Omit<NoteRevision, 'grounds' | 'snapshot'> & { grounds: NoteV2Sources; snapshot: NoteV2 }
export type NoteV2Receipt = Omit<OperationReceipt, 'links'> & { links?: NoteV2Sources }
export type EvidenceErasureScope = Omit<ErasureScope, 'originIds'>

export interface NoteRelationOperation {
  operationId: string; action: 'LINK' | 'UNLINK'; from: string; to: string; fromVersion: number; toVersion: number
  type: 'STATE_CHANGE' | 'CONTINUES' | 'SUPPLEMENTS' | 'CONFLICTS' | 'ASSOCIATED_WITH'; basis: 'direct' | 'inferred'; order: 'event' | 'report' | 'unknown'
  scope?: string; method?: 'semantic'
  uncertainty?: string; reason: string; sources: NoteV2Sources
}
export type NoteRelation = NoteRelationOperation & {
  key: string; status: 'active' | 'stale' | 'retracted'; createdAt: number; endedAt: number | null
}
export interface NoteRelationReceipt extends Omit<NoteV2Receipt, 'action'> {
  action: NoteRelationOperation['action']; relationKey: string; reason: string; sources: NoteV2Sources
}

export interface NoteV2Authority {
  /** Fresh ConversationStore snapshot in the Desktop file format. */
  readData(): Record<string, unknown>
  /** Caller-owned identity decision. Model output must not supply this decision. */
  isSubjectConfirmed(subject: string): boolean
}

export interface NoteV2Store extends Pick<MemoryDatabaseStore, 'open' | 'close' | 'status' | 'erasedNoteIds'> {
  getEmbedding(id: string): Promise<NoteEmbedding | null>
  getEmbeddingHead(id: string): Promise<Awaited<ReturnType<NoteV2Store['listRecallHeads']>>['notes'][number] | null>
  putEmbedding(value: Omit<NoteEmbedding,'createdAt'>): Promise<{noteId: string; noteVersion: number}>
  listEmbeddingHeads(afterId?: string): ReturnType<NoteV2Store['listRecallHeads']>
  searchEmbeddings(value: {modelId: string; projectionVersion: number; embedding: number[]}): Promise<{mode: 'hnsw' | 'exact'; complete: boolean; hits: Array<{noteId: string; noteVersion: number; contentHash: string; score: number}>}>
  applyNoteOperation(operation: NoteV2Operation | NoteRuntimeOperation): Promise<NoteV2Receipt>
  applyRelationOperation(operation: NoteRelationOperation): Promise<NoteRelationReceipt>
  listNoteRelations(id: string, afterKey?: string): Promise<{ relations: NoteRelation[]; nextCursor: string | null }>
  getRecallHistory(id: string): Promise<NoteV2Revision | null>
  listRecallRelations(id: string, afterKey?: string): Promise<{ relations: NoteRelation[]; nextCursor: string | null }>
  listMemorySources(kind: 'evidence', after?: string): Promise<{sources: Array<{key: string; ref: EvidenceRef}>; nextCursor: string | null}>
  installErasureBarriers(keys: string[]): Promise<void>
  eraseSources(scope: EvidenceErasureScope): Promise<{ operationId: string; notes: number; operations: number }>
  /** Administrative lookup. Use listRecallHeads for eligible memory. */
  getNoteV2(id: string): Promise<NoteV2 | null>
  listNoteHeads(afterId?: string): Promise<{ notes: Array<{ note: NoteV2; grounds: NoteV2Sources }>; nextCursor: string | null }>
  getRevision(id: string, version: number): Promise<NoteV2Revision | null>
  getOperationReceipt(id: string): Promise<NoteV2Receipt | NoteRelationReceipt | null>
  getVersionSourceChanges(id: string, version: number, afterId?: string): Promise<{ changes: NoteV2Receipt[]; nextCursor: string | null }>
  listRecallHeads(afterId?: string): Promise<{ notes: Array<{ note: NoteV2; grounds: NoteV2Sources; cumulativeEvidence: EvidenceRef[] }>; nextCursor: string | null }>
}

export interface NoteEmbedding {
  noteId: string; noteVersion: number; modelId: string; dimension: number; projectionVersion: number;
  contentHash: string; embedding: number[]; createdAt: number
}

export type Write =
  | { type: 'createNote'; note: Note }
  | { type: 'addOrigin'; noteId: string; origin: Origin }
  | { type: 'addEvidence'; noteId: string; evidence: EvidenceRef }
  | { type: 'linkNotes'; from: string; to: string }

export interface MemoryDatabaseStore {
  open(): Promise<void>
  close(): Promise<void>
  status(): 'closed' | 'opening' | 'ready' | 'closing' | 'failed'
  createNote(note: Note): Promise<void>
  getNote(id: string): Promise<Note | null>
  addOrigin(id: string, origin: Origin): Promise<void>
  getOrigins(id: string): Promise<Origin[]>
  listNoteEvidence(id: string, after?: string): Promise<{evidence: EvidenceRef[]; nextCursor: string | null}>
  addEvidence(id: string, evidence: EvidenceRef): Promise<void>
  getEvidence(id: string): Promise<EvidenceRef[]>
  applyNoteOperation(operation: NoteOperation): Promise<OperationReceipt>
  eraseSources(scope:ErasureScope):Promise<{operationId:string;notes:number;operations:number}>
  erasedNoteIds(operationId:string,afterId?:string):Promise<{ids:string[];nextCursor:string|null}>
  listMemorySources(kind:'evidence'|'origin',after?:string):Promise<{sources:Array<{key:string;ref:EvidenceRef|Origin}>;nextCursor:string|null}>
  installErasureBarriers(keys:string[]):Promise<void>
  getOperationReceipt(operationId: string): Promise<OperationReceipt | null>
  getNoteV1(id: string): Promise<NoteV1 | null>
  listNoteHeads(afterId?: string): Promise<{ notes: Array<{ note: NoteV1; grounds: NoteSources }>; nextCursor: string | null }>
  getRevision(id: string, version: number): Promise<NoteRevision | null>
  getVersionSourceChanges(id: string, version: number, afterId?: string): Promise<VersionSourceChanges>
  linkNotes(from: string, to: string): Promise<void>
  getRelatedNotes(id: string, depth: 1 | 2): Promise<string[]>
  transaction(writes: Write[]): Promise<void>
}
