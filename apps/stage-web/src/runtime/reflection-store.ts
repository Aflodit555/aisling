export const REFLECTION_KINDS = ['event', 'fact', 'pattern', 'preference', 'project-state', 'open-question'] as const
export type ReflectionKind = typeof REFLECTION_KINDS[number]
export interface SourceRef { sessionId: string; messageIndex: number; digest: string }
export interface Reflection {
  version: 1
  id: string
  content: string
  kind: ReflectionKind
  basis: 'direct' | 'inferred' | 'mixed'
  tags: string[]
  sourceRefs: SourceRef[]
  relatedReflectionIds: string[]
  createdAt: number
  uncertainty?: string
}
export interface FormationBatch {
  id: string
  sessionId: string
  sourceRefs: SourceRef[]
  units: number
  status: 'collecting' | 'pending' | 'completed' | 'failed'
  attempts: number
  error?: string
  reflectionIds: string[]
}
export interface ReflectionState {
  version: 1
  reflections: Reflection[]
  progress: Array<{ sessionId: string; nextIndex: number }>
  batches: FormationBatch[]
}
export interface ReflectionStorage {
  read(): { ok: boolean; value?: string | null }
  write(value: string): boolean
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
export const validSourceRef = (ref: SourceRef) => !!ref && id(ref.sessionId) && integer(ref.messageIndex) && /^[a-f0-9]{64}$/.test(ref.digest)
export function reflectionValidationField(r: Reflection): string | undefined {
  if (!r || r.version !== 1) return 'version'
  if (!id(r.id)) return 'id'
  if (typeof r.content !== 'string' || !r.content.trim() || r.content.length > 800) return 'content'
  if (!REFLECTION_KINDS.includes(r.kind)) return 'kind'
  if (!['direct', 'inferred', 'mixed'].includes(r.basis)) return 'basis'
  if (!Array.isArray(r.tags) || r.tags.length < 1 || r.tags.length > 6 || !r.tags.every(t => typeof t === 'string' && !!t.trim() && t.length <= 40)) return 'tags'
  if (!Array.isArray(r.sourceRefs) || r.sourceRefs.length < 1 || r.sourceRefs.length > 12 || !r.sourceRefs.every(validSourceRef)) return 'sourceRefs'
  if (!Array.isArray(r.relatedReflectionIds) || r.relatedReflectionIds.length > 3 || !r.relatedReflectionIds.every(id)) return 'relatedReflectionIds'
  if (!integer(r.createdAt)) return 'createdAt'
  if ((r.uncertainty !== undefined && (typeof r.uncertainty !== 'string' || !r.uncertainty.trim() || r.uncertainty.length > 300))
    || (r.basis !== 'direct' && !r.uncertainty)) return 'uncertainty'
}
export const validReflection = (r: Reflection): boolean => reflectionValidationField(r) === undefined
function validate(state: ReflectionState): void {
  if (!state || state.version !== 1 || !Array.isArray(state.reflections) || !state.reflections.every(validReflection)
    || new Set(state.reflections.map(r => r.id)).size !== state.reflections.length
    || state.reflections.some(r => r.relatedReflectionIds.some(link => link === r.id || !state.reflections.some(old => old.id === link)))
    || !Array.isArray(state.progress) || state.progress.some(p => !id(p.sessionId) || !integer(p.nextIndex))
    || new Set(state.progress.map(p => p.sessionId)).size !== state.progress.length
    || !Array.isArray(state.batches) || new Set(state.batches.map(b => b.id)).size !== state.batches.length
    || state.batches.some(b => !id(b.id) || !id(b.sessionId) || !Array.isArray(b.sourceRefs) || b.sourceRefs.length < 1 || b.sourceRefs.length > 12
      || !b.sourceRefs.every(validSourceRef) || !integer(b.units) || b.units < 1 || !integer(b.attempts)
      || !['collecting', 'pending', 'completed', 'failed'].includes(b.status) || !Array.isArray(b.reflectionIds)
      || b.reflectionIds.some(ref => !state.reflections.some(r => r.id === ref))
      || (b.error !== undefined && !['provider-error', 'invalid-output', 'source-changed', 'input-limit', 'storage-error'].includes(b.error))))
    throw new Error('reflection-store-invalid')
}
export function createReflectionStore(storage: ReflectionStorage) {
  // shortcut: one renderer owns the file; add locking before supporting concurrent writers.
  function read(): ReflectionState {
    const result = storage.read()
    if (!result.ok) throw new Error('reflection-store-read')
    if (result.value == null) return { version: 1, reflections: [], progress: [], batches: [] }
    let state: ReflectionState
    try { state = JSON.parse(result.value) as ReflectionState }
    catch { throw new Error('reflection-store-invalid') }
    validate(state)
    return state
  }
  function update(change: (state: ReflectionState) => void): void {
    const state = read()
    change(state)
    validate(state)
    const serialized = JSON.stringify(state)
    if (new TextEncoder().encode(serialized).length > 2_000_000) throw new Error('reflection-store-limit')
    if (storage.write(serialized) !== true) throw new Error('reflection-store-write')
  }
  return { read, update }
}
