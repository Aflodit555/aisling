const { createHash } = require('node:crypto')
const { buildNoteEmbeddingText, projectionVersion } = require('./note-candidates.mjs')
const hash = text => createHash('sha256').update(text).digest('hex')
const nativePath = '/api/v1/services/embeddings/text-embedding/text-embedding'
const validVector = value => Array.isArray(value) && value.length === 1024 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e10)
  && value.some(n => n !== 0)

function resolveEmbeddingConfig(config, env = process.env) {
  const explicit = config?.memory?.embedding
  const sources = explicit?.credentialSource === 'dedicated' ? [{apiKey: explicit.apiKey,baseUrl: explicit.endpoint || 'https://dashscope.aliyuncs.com'}]
    : [config?.consciousness, config?.vision, config?.speech, ...(explicit?.endpoint ? [{ apiKey: env.DASHSCOPE_API_KEY, baseUrl: explicit.endpoint }] : [])]
  for (const source of sources) {
    try {
      const original = new URL(source?.baseUrl || source?.endpoint)
      if (original.protocol === 'wss:') original.protocol = 'https:'
      if (!/^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|[\w-]+\.(?:cn-beijing|ap-southeast-1|us-east-1)\.maas\.aliyuncs\.com)$/.test(original.hostname)) continue
      const url = new URL(explicit?.endpoint || original)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port
        || !/^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|[\w-]+\.(?:cn-beijing|ap-southeast-1|us-east-1)\.maas\.aliyuncs\.com)$/.test(url.hostname)
        || !(source?.apiKey || (explicit?.credentialSource !== 'dedicated' && env.DASHSCOPE_API_KEY))?.trim()) continue
      const endpoint = url.origin + nativePath, model = explicit?.model || 'qwen3.7-text-embedding'
      if (!/^[\w.-]{1,80}$/.test(model)) return
      return { endpoint, model, apiKey: (source.apiKey || env.DASHSCOPE_API_KEY).trim(), modelId: url.hostname + '/' + model }
    } catch { /* A non-DashScope provider must never receive this request or credential. */ }
  }
}

function embeddingIdentity(note, config) {
  return { noteId: note.id, noteVersion: note.version, modelId: config.modelId, dimension: 1024,
    projectionVersion, contentHash: hash(buildNoteEmbeddingText(note)) }
}

async function embed(config, texts, type, { fetchImpl = fetch, signal = undefined, timeoutMs = 12000 } = {}) {
  if (!['query', 'document'].includes(type) || !Array.isArray(texts) || !texts.length || texts.length > 20
    || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 6000)) throw new Error('embedding-input')
  const response = await fetchImpl(config.endpoint, { method: 'POST', redirect: 'error',
    headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input: { texts }, parameters: { dimension: 1024, text_type: type, output_type: 'dense' } }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw Object.assign(new Error('embedding-http-' + response.status), { retryable: response.status === 429 || response.status >= 500 })
  // Consume a bounded body without logging provider errors or credentials.
  const reader = response.body.getReader(), chunks = []; let bytes = 0
  try { for (;;) { const { done, value } = await reader.read(); if (done) break
    bytes += value.length; if (bytes > 1_000_000) throw new Error('embedding-response-limit'); chunks.push(value) } }
  finally { await reader.cancel().catch(() => {}) }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const rows = body.output?.embeddings
  if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error('embedding-output')
  const result = Array(texts.length), seen = new Set()
  for (const row of rows) {
    if (!Number.isInteger(row.text_index) || row.text_index < 0 || row.text_index >= texts.length || seen.has(row.text_index) || !validVector(row.embedding)) throw new Error('embedding-vector')
    seen.add(row.text_index); result[row.text_index] = row.embedding
  }
  return result
}

module.exports = { resolveEmbeddingConfig, embeddingIdentity, embed, validVector }
