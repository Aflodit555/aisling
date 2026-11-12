import type { NoteV2, NoteV2Sources } from './memory-database/store'
export const projectionVersion: number
export function buildNoteEmbeddingText(note: NoteV2): string
export function discoverCandidates<T extends {note: NoteV2; grounds: NoteV2Sources}>(query: string, heads: T[],
  vectors?: Array<{noteId: string; noteVersion: number; score: number}>, focus?: NoteV2, complete?: boolean): {
    complete: boolean; candidates: Array<{head: T; score: number; channels: string[]}>
  }
