const { createHash } = require('node:crypto')

const id = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
const version = value => integer(value) && value > 0
const record = (value, required, optional = []) => !!value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max
const list = (value, valid) => Array.isArray(value) && value.length <= 12 && value.every(valid)
const origin = value => record(value, ['reflectionId']) && id(value.reflectionId)
const evidence = value => record(value, ['sessionId', 'messageIndex', 'digest']) && id(value.sessionId)
  && integer(value.messageIndex) && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest)

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
}

function eventTime(value) {
  if (value === null) return true
  switch (value?.kind) {
    case 'date': return record(value, ['kind', 'date']) && date(value.date)
    case 'instant': return record(value, ['kind', 'epochMs']) && Number.isSafeInteger(value.epochMs) && Math.abs(value.epochMs) <= 8.64e15
    case 'date-range': return record(value, ['kind', 'start', 'end']) && date(value.start) && date(value.end) && value.start <= value.end
    default: return false
  }
}

const noteKinds = ['event', 'fact', 'pattern', 'preference', 'project-state', 'open-question']

function meaning(value, noteV2) {
  const required = ['content', 'subject', 'eventTime', 'basis']
  const optional = noteV2 ? ['uncertainty', 'tags'] : ['uncertainty', 'context', 'keywords', 'tags']
  if (noteV2) required.push('kind')
  return record(value, required, optional)
    && (!noteV2 || noteKinds.includes(value.kind) && (value.kind !== 'pattern' || text(value.uncertainty, 300)))
    && text(value.content, 800) && text(value.subject, 128) && eventTime(value.eventTime)
    && ['direct', 'inferred', 'mixed'].includes(value.basis)
    && (value.basis === 'direct' && !Object.hasOwn(value, 'uncertainty') || text(value.uncertainty, 300))
    && (!Object.hasOwn(value, 'context') || text(value.context, 800))
    && ['keywords', 'tags'].every(key => !Object.hasOwn(value, key) || list(value[key], item => text(item, 40)))
}

function needsMultipleSources(value) {
  return value.basis !== 'direct' || value.kind === 'pattern'
}

const MAX_CONTEXT_EVIDENCE = 64

function validateOperation(value, noteV2, runtime = false) {
  const common = ['action', 'operationId', 'id', 'reason', 'sources']
  const sources = value?.sources
  if (runtime) {
    common.push('contextEvidence')
    if (!Array.isArray(value?.contextEvidence) || value.contextEvidence.length > MAX_CONTEXT_EVIDENCE
      || !value.contextEvidence.every(evidence)) return false
  }
  if (!uuid(value?.operationId) || !uuid(value.id) || !text(value.reason, 300)
    || !record(sources, noteV2 ? ['evidence'] : ['origins', 'evidence'])
    || (!noteV2 && !list(sources.origins, origin)) || !list(sources.evidence, evidence)) return false
  const validMeaning = () => {
    if (!meaning(value.meaning, noteV2)) return false
    if (!noteV2) return true
    const positions = new Set(sources.evidence.map(ref => JSON.stringify([ref.sessionId, ref.messageIndex])))
    return positions.size >= (needsMultipleSources(value.meaning) ? 2 : 1)
  }
  if (value.action === 'ADD') return record(value, [...common, 'meaning']) && validMeaning()
  if (!version(value.expectedVersion)) return false
  common.push('expectedVersion')
  switch (value.action) {
    case 'UPDATE': return record(value, [...common, 'meaning']) && validMeaning()
    case 'NOOP': case 'RETRACT': return record(value, common)
    case 'SUPERSEDE': return record(value, [...common, 'newId', 'meaning', 'transition'])
      && uuid(value.newId) && validMeaning() && value.transition === 'explicit-same-scope-change'
    default: return false
  }
}

const validOperation = value => validateOperation(value, false)
const validNoteV2Operation = value => validateOperation(value, true)
const validRuntimeOperation = value => validateOperation(value, true, true)

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const originKey = ref => JSON.stringify(['origin', ref.reflectionId])
const evidenceKey = ref => JSON.stringify(['evidence', ref.sessionId, ref.messageIndex, ref.digest])
const sourceKeys = sources => [...(sources.origins ?? []).map(originKey), ...sources.evidence.map(evidenceKey)]
function orderedSet(items, key) {
  const byKey = new Map(items.map(item => [key(item), item]))
  return [...byKey.keys()].sort().map(key => byKey.get(key))
}
function normalize(command) {
  const { origins, evidence } = command.sources
  return { ...command,
    sources: { ...(origins && { origins: orderedSet(origins, originKey) }), evidence: orderedSet(evidence, evidenceKey) },
    ...(command.contextEvidence && { contextEvidence: orderedSet(command.contextEvidence, evidenceKey) }),
  }
}

function requireState(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code })
}

const revisionKey = (noteId, number) => JSON.stringify([noteId, number])
const meaningOf = ({ id, createdAt, status, version, ...value }) => value
const ddl = [
  'CREATE NODE TABLE IF NOT EXISTS NoteRevision(key STRING PRIMARY KEY, data STRING)',
  'CREATE NODE TABLE IF NOT EXISTS NoteOperation(operationId STRING PRIMARY KEY, data STRING, sourceNoteId STRING, sourceVersion INT64, sourceKeys STRING[])',
]

function snapshotColumn(schema) {
  if (schema === 'note-v2-runtime') return 'snapshot_v2_runtime'
  return schema === 'note-v2' ? 'snapshot_v2' : 'snapshot'
}

function noteOperations(query, graph, assertWritable, schema) {
  const snapshot = snapshotColumn(schema)
  const noteV2 = snapshot !== 'snapshot'
  async function read(statement, params) {
    const [row] = await query(statement, params)
    return row ? JSON.parse(row.data) : null
  }
  const getNote = id => read(`MATCH (n:Note {id: $id}) RETURN n.${snapshot} AS data`, { id })
  const getRevision = (noteId, number) => read('MATCH (r:NoteRevision {key: $key}) RETURN r.data AS data', { key: revisionKey(noteId, number) })
  const getOperationReceipt = operationId => read('MATCH (o:NoteOperation {operationId: $operationId}) RETURN o.data AS data', { operationId })

  async function getVersionSourceChanges(noteId, version, afterId) {
    const rows = await query(`MATCH (o:NoteOperation {sourceNoteId: $noteId, sourceVersion: $version})
      WHERE o.operationId > $afterId RETURN o.data AS data ORDER BY o.operationId LIMIT 5`, { noteId, version, afterId })
    const changes = rows.slice(0, 4).map(row => JSON.parse(row.data))
    return { changes, nextCursor: rows.length > 4 ? changes[3].operationId : null }
  }

  async function attach(id, sources) {
    for (const ref of (sources.origins ?? [])) await graph.addOrigin(id, ref)
    for (const ref of sources.evidence) await graph.addEvidence(id, ref)
  }

  async function addSupplement(noteId, version, sources) {
    const head = await getRevision(noteId, version)
    const keys = sourceKeys(sources)
    if (!keys.length) return null
    const seen = new Set(sourceKeys(head.grounds))
    const rows = await query(`UNWIND CAST($keys AS STRING[]) AS key
      MATCH (o:NoteOperation {sourceNoteId: $noteId, sourceVersion: $version})
      WHERE key IN o.sourceKeys RETURN DISTINCT key`, { noteId, version, keys })
    for (const { key } of rows) seen.add(key)
    const links = {
      ...(sources.origins && { origins: sources.origins.filter(ref => !seen.has(originKey(ref))) }),
      evidence: sources.evidence.filter(ref => !seen.has(evidenceKey(ref))),
    }
    if (!sourceKeys(links).length) return null
    await attach(noteId, links)
    return links
  }

  async function applyNoteOperation(input) {
    const command = normalize(input)
    const fingerprint = operationFingerprint(command)
    const { id, action, operationId, reason, sources } = command
    return graph.transaction(async () => {
      await assertWritable?.(command)
      const existing = await getOperationReceipt(operationId)
      if (existing) {
        requireState(existing.fingerprint === fingerprint, 'operation-id-conflict', 'Operation ID already used for a different request')
        return existing
      }
      const changedAt = Date.now()
      const affectedNotes = []
      let links = null
      async function save(note, successorId = undefined) {
        const { id: noteId, version } = note
        const data = JSON.stringify(note)
        if (version === 1) await query(`CREATE (:Note {id: $noteId, ${snapshot}: $data})`, { noteId, data })
        else await query(`MATCH (n:Note {id: $noteId}) SET n.${snapshot} = $data`, { noteId, data })
        const revision = { noteId, version, operationId, action, changedAt, reason, grounds: sources, snapshot: note, successorId }
        await query('CREATE (:NoteRevision {key: $key, data: $data})', { key: revisionKey(noteId, version), data: JSON.stringify(revision) })
        await attach(noteId, sources)
        affectedNotes.push({ id: noteId, version })
      }
      async function insert(noteId) {
        requireState(!await getNote(noteId), 'note-id-conflict', 'Note ID already exists')
        requireState(sources.evidence.length && (noteV2 || sources.origins.length), 'missing-grounds',
          noteV2 ? 'Creation requires Evidence' : 'Creation requires Origin and Evidence')
        await save({ ...command.meaning, id: noteId, createdAt: changedAt, version: 1, status: 'active' })
      }
      if (action === 'ADD') await insert(id)
      else {
        const current = await getNote(id)
        requireState(current, 'note-missing', 'Note does not exist')
        requireState(current.version === command.expectedVersion, 'stale-version', 'Expected version does not match current Note')
        requireState(current.status === 'active' || (current.status === 'superseded' && action === 'RETRACT'),
          'invalid-transition', 'Operation is not valid in the current state')
        const next = { ...current, version: current.version + 1 }
        if (action !== 'NOOP') requireState(version(next.version), 'version-limit', 'Note version is at its limit')
        switch (action) {
          case 'UPDATE':
            if (noteV2) requireState(current.subject === command.meaning.subject, 'subject-changed', 'Update must preserve the subject')
            requireState(sources.evidence.length, 'missing-grounds', 'Update requires Evidence')
            requireState(canonical(meaningOf(current)) !== canonical(command.meaning), 'no-semantic-change', 'Use NOOP for unchanged meaning')
            await save({ ...command.meaning, id, createdAt: current.createdAt, version: next.version, status: 'active' })
            break
          case 'NOOP':
            links = await addSupplement(id, current.version, sources)
            affectedNotes.push({ id, version: current.version })
            break
          case 'SUPERSEDE':
            requireState(current.subject === command.meaning.subject, 'transition-grounds', 'Replacement must have the same subject')
            await insert(command.newId)
            await save({ ...next, status: 'superseded' }, command.newId)
            break
          case 'RETRACT': await save({ ...next, status: 'retracted' }); break
        }
      }
      for (const { id: noteId } of affectedNotes)
        for (const ref of command.contextEvidence ?? []) await graph.addEvidence(noteId, ref, 'HAS_CONTEXT')
      const receipt = { operationId, fingerprint, action, changedAt, affectedNotes, ...(links ? { links } : {}) }
      await query(`CREATE (:NoteOperation {operationId: $operationId, data: $data,
        sourceNoteId: CAST($sourceNoteId AS STRING), sourceVersion: CAST($sourceVersion AS INT64), sourceKeys: CAST($sourceKeys AS STRING[])})`, {
        operationId, data: JSON.stringify(receipt), sourceNoteId: links ? id : null, sourceVersion: links ? command.expectedVersion : null,
        sourceKeys: links ? sourceKeys(links) : [],
      })
      return receipt
    })
  }
  async function listNoteHeads(afterId) {
    // A full v2 page of bounded Notes and references must fit the 64 KiB reply frame.
    const pageSize = noteV2 ? 4 : 8
    const rows = await query(`MATCH (n:Note) WHERE n.id > $afterId RETURN n.id AS id, n.${snapshot} AS data ORDER BY n.id LIMIT ${pageSize + 1}`, { afterId })
    const notes = []
    for (const row of rows.slice(0, pageSize)) {
      const note = JSON.parse(row.data)
      const revision = await getRevision(note.id, note.version)
      notes.push({ note, grounds: revision.grounds })
    }
    return { notes, nextCursor: rows.length > pageSize ? rows[pageSize - 1].id : null }
  }
  return { applyNoteOperation, [noteV2 ? 'getNoteV2' : 'getNoteV1']: getNote,
    getRevision, getOperationReceipt, getVersionSourceChanges, listNoteHeads }
}

const operationFingerprint = input => createHash('sha256').update(canonical(normalize(input))).digest('hex')
module.exports = { uuid, version, validOperation, validNoteV2Operation, validRuntimeOperation, MAX_CONTEXT_EVIDENCE, needsMultipleSources, ddl, noteOperations, snapshotColumn, operationFingerprint }
