export function safeText(text: string): boolean
export function terms(text: string): string[]
export function rankNoteHeads<T extends { note: { id: string; content: string; subject: string; tags?: string[] } }>(query: string, heads: T[]): T[]
