const { uuid, version, validOperation } = require('./note-v1.cjs')

const VERSION = 1
const NOTE_V1_FILE = 'note-v1.lbdb'
const MAX_FRAME = 64 * 1024
const MAX_PENDING = 32
const decoder = new TextDecoder('utf-8', { fatal: true })

class ProtocolError extends Error {
  constructor(code, message, causeCode) {
    super(message)
    this.code = code
    if (causeCode) this.causeCode = causeCode
  }
}

async function* lines(stream) {
  let partial = Buffer.alloc(0)
  for await (const chunk of stream) {
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset)
      const end = newline === -1 ? chunk.length : newline
      const slice = chunk.subarray(offset, end)
      partial = partial && partial.length + slice.length <= MAX_FRAME
        ? Buffer.concat([partial, slice]) : null
      if (newline !== -1) {
        yield partial
        partial = Buffer.alloc(0)
      }
      offset = end + 1
    }
  }
}

function decode(line) {
  if (line === null) throw new ProtocolError('frame-too-large', 'Frame exceeds 64 KiB')
  try { return JSON.parse(decoder.decode(line)) }
  catch { throw new ProtocolError('invalid-json', 'Expected a UTF-8 JSON line') }
}

function encode(value) {
  const line = Buffer.from(JSON.stringify(value) + '\n')
  if (line.length > MAX_FRAME + 1) throw new ProtocolError('frame-too-large', 'Frame exceeds 64 KiB')
  return line
}

const id = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const record = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const note = value => record(value, ['id', 'content', 'createdAt']) && id(value.id) && integer(value.createdAt)
  && typeof value.content === 'string' && value.content.length <= 800 && !!value.content.trim()
const origin = value => record(value, ['reflectionId']) && id(value.reflectionId)
const evidence = value => record(value, ['sessionId', 'messageIndex', 'digest'])
  && id(value.sessionId) && integer(value.messageIndex)
  && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest)
const writes = new Set(['insertNote', 'addOrigin', 'addEvidence', 'relate'])
const mutates = operation => writes.has(operation) || operation === 'transaction' || operation === 'applyNoteOperation' || operation === 'eraseSources' || operation === 'installErasureBarriers'
const validators = {
  close: [], getNote: [id], getOrigins: [id], getEvidence: [id],
  outgoingOne: [id], outgoingTwo: [id], insertNote: [note], addOrigin: [id, origin],
  addEvidence: [id, evidence], relate: [id, id],
  transaction: [value => Array.isArray(value) && value.length > 0 && value.length <= 32
    && value.every(item => record(item, ['operation', 'payload']) && writes.has(item.operation)
      && validArgs(validators[item.operation], item.payload))],
}
const noteValidators = {
  eraseSources:[value=>require('./erasure.cjs').validErasure(value)],
  erasedNoteIds:[uuid,value=>value===''||uuid(value)],
  listMemorySources:[value=>['evidence','origin'].includes(value),value=>typeof value==='string'&&value.length<=1024],
  installErasureBarriers:[value=>Array.isArray(value)&&value.length<=32&&value.every(k=>typeof k==='string'&&/^(session|evidence|origin):[a-f0-9]{64}$/.test(k))],
  listNoteHeads: [value => value === '' || uuid(value)],
  close: [], applyNoteOperation: [validOperation], getNoteV1: [uuid], getOperationReceipt: [uuid],
  getRevision: [uuid, version], getVersionSourceChanges: [uuid, version, value => value === '' || uuid(value)],
}

function validArgs(checks, args) {
  return Array.isArray(args) && args.length === checks.length && checks.every((check, i) => check(args[i]))
}

function validateRequest(request, noteV1 = false) {
  if (!record(request, ['protocolVersion', 'requestId', 'operation', 'payload']) || !integer(request.requestId) || !request.requestId)
    throw new ProtocolError('invalid-request', 'Expected a positive integer request ID and request envelope')
  if (request.protocolVersion !== VERSION)
    throw new ProtocolError('protocol-version', 'Unsupported protocol version')
  const operations = noteV1 ? noteValidators : validators
  if (typeof request.operation !== 'string' || !Object.hasOwn(operations, request.operation))
    throw new ProtocolError('unknown-operation', 'Operation is not on the allowlist')
  if (!validArgs(operations[request.operation], request.payload))
    throw new ProtocolError('invalid-payload', 'Invalid operation arguments')
}

module.exports = { VERSION, NOTE_V1_FILE, MAX_FRAME, MAX_PENDING, ProtocolError, lines, decode, encode, mutates, validateRequest }
