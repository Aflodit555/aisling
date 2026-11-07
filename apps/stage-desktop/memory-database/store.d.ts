export interface Note {
  id: string
  content: string
  createdAt: number
}

export interface Origin { reflectionId: string }
export interface EvidenceRef { sessionId: string; messageIndex: number; digest: string }

export type EventTime = null | { kind: 'date'; date: string } | { kind: 'instant'; epochMs: number }
  | { kind: 'date-range'; start: string; end: string }
export type NoteMeaning = { content: string; subject: string; eventTime: EventTime; context?: string; keywords?: string[]; tags?: string[] }
  & ({ basis: 'direct'; uncertainty?: string } | { basis: 'mixed' | 'inferred'; uncertainty: string })
export type NoteV1 = NoteMeaning & { id: string; createdAt: number; status: 'active' | 'superseded' | 'retracted'; version: number }
export interface NoteSources { origins: Origin[]; evidence: EvidenceRef[] }
type ExistingNote = { expectedVersion: number }
export type NoteOperation = { operationId: string; id: string; reason: string; sources: NoteSources } & (
  | { action: 'ADD'; meaning: NoteMeaning }
  | (ExistingNote & { action: 'UPDATE'; meaning: NoteMeaning })
  | (ExistingNote & { action: 'NOOP' | 'RETRACT' })
  | (ExistingNote & { action: 'SUPERSEDE'; newId: string; meaning: NoteMeaning; transition: 'explicit-same-scope-change' })
)
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
