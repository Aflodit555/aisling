const groups = {
  'response-parse': ['invalid-json'],
  'contract-invalid': ['input-limit', 'output-limit', 'invalid-proposal', 'proposal-shape', 'proposal-fields', 'proposal-related', 'proposal-undecided', 'proposal-target', 'draft-fields', 'draft-uncertainty', 'invalid-history', 'invalid-delivery', 'invalid-retry', 'invalid-organization-allowance', 'formation-not-prepared', 'unexpected-tools'],
  'semantic-invalid': ['draft-subject', 'draft-state', 'draft-date', 'draft-assistant-scope', 'draft-date-not-in-quote', 'draft-content', 'semantic-shape', 'semantic-target', 'semantic-fragment', 'semantic-relations', 'semantic-relation', 'semantic-endpoint'],
  'source-invalid': ['source-changed', 'invalid-evidence', 'erased', 'erasure-pending', 'erase-journal-invalid', 'draft-sources', 'draft-quote', 'draft-current-source', 'draft-subject-evidence', 'draft-insufficient-evidence', 'insufficient-evidence', 'semantic-sources', 'semantic-quote', 'semantic-current-source', 'semantic-target-source', 'semantic-endpoint-source'],
  'provider': ['provider-error', 'provider-network', 'provider-temporary', 'provider-rejected', 'timeout'],
  'persistence': ['persistence-failure', 'formation-job-limit', 'worker-unavailable', 'worker-stopped', 'worker-closing', 'worker-resources-locked', 'spawn-failed', 'pipe-error', 'startup-timeout', 'startup-error', 'shutdown-timeout', 'request-timeout', 'queue-full', 'protocol-version', 'unexpected-runtime', 'unexpected-schema', 'unexpected-response', 'invalid-response', 'invalid-request', 'invalid-payload', 'unknown-operation', 'frame-too-large', 'outcome-unknown', 'database-error', 'receipt-conflict', 'operation-id-conflict', 'stale-worker-resources'],
  'authorization-rejected': ['stale-version', 'note-missing', 'subject-changed', 'subject-unconfirmed', 'invalid-transition', 'no-semantic-change', 'user-rejected'],
  'review-required': ['review-required', 'index-incomplete', 'context-limit'],
  interrupted: ['interrupted', 'cancelled', 'stale-formation-attempt', 'stale-organization-attempt', 'formation-closing'],
  unknown: ['unknown-failure'],
}
const categories = new Map(Object.entries(groups).flatMap(([category, codes]) => codes.map(code => [code, category])))
const phases = ['source', 'prepare', 'provider', 'parse', 'submit', 'settle', 'interrupted', 'unknown']

/** Only allowlisted codes cross IPC or enter the job journal; never retain exception text. */
export function formationFailure(value, phase = 'unknown') {
  if (!phases.includes(phase)) phase = 'unknown'
  const candidate = typeof value === 'string' ? value : value?.code ?? value?.message
  const code = typeof candidate === 'string' ? candidate.match(/(?:^|Error: )([a-z][a-z0-9-]*)$/)?.[1] : undefined
  let safe = categories.has(code) ? code : value instanceof SyntaxError ? 'invalid-json'
    : ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ENOENT'].includes(value?.code) ? 'persistence-failure'
      : phase === 'settle' ? 'database-error' : 'unknown-failure'
  if (phase === 'provider' && typeof value?.status === 'number') {
    safe = value.status === 0 ? 'provider-network'
      : value.status === 408 || value.status === 429 || value.status >= 500 ? 'provider-temporary' : 'provider-rejected'
  }
  return { code: safe, category: categories.get(safe), phase }
}

export function validFormationFailure(value) {
  return value && Object.keys(value).sort().join(',') === 'category,code,phase'
    && categories.get(value.code) === value.category && phases.includes(value.phase)
}

export const automaticFormationRetry = failure => failure.phase === 'provider'
  && ['provider-network', 'provider-temporary', 'timeout'].includes(failure.code)
