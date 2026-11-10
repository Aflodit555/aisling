const { ddl: noteDdl, noteOperations, snapshotColumn } = require('./note-v1.cjs')
const {ddl:erasureDdl,erasureOperations}=require('./erasure.cjs')

function openLadybug(api, file, schema = 'p0', readOnly = false) {
  const snapshot = snapshotColumn(schema)
  const noteV2 = snapshot !== 'snapshot'
  const runtime = schema === 'note-v2-runtime'
  const versioned = schema !== 'p0'
  const db = readOnly ? new api.Database(file, 0, true, true) : new api.Database(file)
  const connection = new api.Connection(db)

  async function query(statement, params = undefined) {
    const result = params
      ? await connection.execute(await connection.prepare(statement), params)
      : await connection.query(statement)
    try { return await result.getAll() }
    finally { result.close() }
  }

  const graph = {
    async initialize() {
      const noteColumns = versioned ? snapshot + ' STRING' : 'content STRING, createdAt INT64'
      const tables = await query('CALL show_tables() RETURN name')
      if (tables.some(row => row.name === 'Note')) {
        const columns = await query("CALL table_info('Note') RETURN name")
        const expected = versioned ? ['id', snapshot] : ['content', 'createdAt', 'id']
        if (columns.map(row => row.name).sort().join(',') !== expected.join(','))
          throw new Error('Note database schema mismatch')
      } else if (noteV2 && tables.length) {
        throw new Error('Note database schema mismatch')
      }
      if (readOnly) {
        if (!['Note', 'NoteRevision', 'NoteOperation', 'Evidence', 'Origin', 'HAS_ORIGIN', 'HAS_EVIDENCE'].every(name => tables.some(row => row.name === name)))
          throw new Error('Incomplete legacy Note database')
        return
      }
      for (const ddl of [
        `CREATE NODE TABLE IF NOT EXISTS Note(id STRING PRIMARY KEY, ${noteColumns})`,
        'CREATE NODE TABLE IF NOT EXISTS Evidence(key STRING PRIMARY KEY, sessionId STRING, messageIndex INT64, digest STRING)',
        'CREATE REL TABLE IF NOT EXISTS HAS_EVIDENCE(FROM Note TO Evidence)',
        ...(runtime ? ['CREATE REL TABLE IF NOT EXISTS HAS_CONTEXT(FROM Note TO Evidence)'] : []),
        ...(!noteV2 ? [
          'CREATE NODE TABLE IF NOT EXISTS Origin(reflectionId STRING PRIMARY KEY)',
          'CREATE REL TABLE IF NOT EXISTS HAS_ORIGIN(FROM Note TO Origin)',
          'CREATE REL TABLE IF NOT EXISTS RELATED(FROM Note TO Note)',
        ] : []),
        ...(versioned ? [...noteDdl, ...erasureDdl] : []),
      ]) await query(ddl)
    },
    async insertNote({ id, content, createdAt }) {
      await query('CREATE (:Note {id: $id, content: $content, createdAt: $createdAt})', { id, content, createdAt })
    },
    async getNote(id) {
      const [row] = await query('MATCH (n:Note {id: $id}) RETURN n.id AS id, n.content AS content, n.createdAt AS createdAt', { id })
      return row && { ...row, createdAt: Number(row.createdAt) }
    },
    async addOrigin(noteId, { reflectionId }) {
      const matched = await query(`
        MATCH (n:Note {id: $noteId})
        MERGE (o:Origin {reflectionId: $reflectionId})
        MERGE (n)-[:HAS_ORIGIN]->(o)
        RETURN n.id
      `, { noteId, reflectionId })
      if (!matched.length) throw new Error('Origin Note does not exist')
    },
    getOrigins(noteId) {
      return query(`
        MATCH (:Note {id: $noteId})-[:HAS_ORIGIN]->(o:Origin)
        RETURN o.reflectionId AS reflectionId ${versioned ? 'ORDER BY o.reflectionId LIMIT 65' : ''}
      `, { noteId })
    },
    async addEvidence(noteId, { sessionId, messageIndex, digest }, relation = 'HAS_EVIDENCE') {
      const key = JSON.stringify([sessionId, messageIndex, digest])
      const matched = await query(`
        MATCH (n:Note {id: $noteId})
        MERGE (e:Evidence {key: $key, sessionId: $sessionId, messageIndex: $messageIndex, digest: $digest})
        MERGE (n)-[:${relation}]->(e)
        RETURN n.id
      `, { noteId, key, sessionId, messageIndex, digest })
      if (!matched.length) throw new Error('Evidence Note does not exist')
    },
    async getEvidence(noteId) {
      const rows = await query(`
        MATCH (:Note {id: $noteId})-[:HAS_EVIDENCE]->(e:Evidence)
        RETURN e.sessionId AS sessionId, e.messageIndex AS messageIndex, e.digest AS digest
      `, { noteId })
      return rows.map(row => ({ ...row, messageIndex: Number(row.messageIndex) }))
    },
    async relate(fromId, toId) {
      const matched = await query(`
        MATCH (source:Note {id: $fromId}), (target:Note {id: $toId})
        MERGE (source)-[:RELATED]->(target)
        RETURN target.id
      `, { fromId, toId })
      if (!matched.length) throw new Error('RELATED endpoint does not exist')
    },
    async outgoingOne(id) {
      const rows = await query(`
        MATCH (:Note {id: $id})-[:RELATED]->(target:Note)
        RETURN DISTINCT target.id AS id
      `, { id })
      return rows.map(row => row.id)
    },
    async outgoingTwo(id) {
      const rows = await query(`
        MATCH (:Note {id: $id})-[:RELATED]->(middle:Note)
        MATCH (middle)-[:RELATED]->(target:Note)
        RETURN DISTINCT target.id AS id
      `, { id })
      return rows.map(row => row.id)
    },
    async transaction(work) {
      await query('BEGIN TRANSACTION')
      try {
        const result = await work()
        await query('COMMIT')
        return result
      }
      catch (error) {
        try { await query('ROLLBACK') }
        catch (rollbackError) {
          // shortcut: 0.22.1 reports auto-rollback via this message, recheck on driver upgrades.
          if (!(rollbackError instanceof Error) || rollbackError.message !== 'No active transaction for ROLLBACK.')
            throw new AggregateError([error, rollbackError], 'Ladybug rollback failed')
        }
        throw error
      }
    },
    async close() {
      try { await connection.close() }
      finally { await db.close() }
    },
  }
  const erasure = erasureOperations(query, graph, noteV2, runtime)
  return { ...graph, ...noteOperations(query, graph, versioned ? erasure.assertWritable : undefined, schema), ...erasure }
}



module.exports = { openLadybug }
