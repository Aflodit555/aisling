import { it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import cases from './semantic-quality-cases.json'
import { sourceRef, withNoteHistory, withRelatedHistory, type FormationEvidence } from './formation-evidence'
import { formationInput, parseNoteBatch, type NoteFormationContext } from '../../../stage-desktop/note-formation-contract.mjs'
import { organizationInput, parseSemanticRelations, semanticRelationPlan } from '../../../stage-desktop/note-semantic-contract.mjs'
import speakers from '../../../stage-desktop/memory-subjects.json'
import { buildChatProvider, formationEnableThinking } from './provider-factory'
import type { ConversationSession } from '../conversation/conversation-store'

const { authorizeOrganization } = createRequire(import.meta.url)('../../../stage-desktop/note-organization-v2.mjs')

// Explicit opt-in only: synthetic inputs, real credentials read once, no database or settings writes.
it.runIf(process.env.SEMANTIC_LIVE === '1')('runs one bounded synthetic Provider comparison, never retries or tunes against results', async () => {
  const output = process.env.SEMANTIC_LIVE_RESULT!, configFile = process.env.SEMANTIC_LIVE_CONFIG!
  expect(path.isAbsolute(output) && path.isAbsolute(configFile)).toBe(true)
  expect(fs.existsSync(output)).toBe(false)
  const baseline = await import(/* @vite-ignore */ pathToFileURL(process.env.SEMANTIC_BASELINE_CONTRACT!).href)
  const config = JSON.parse(JSON.parse(fs.readFileSync(configFile, 'utf8'))['aisling.config.v1']).consciousness
  const origin = new URL(config.baseUrl).origin
  expect(new URL(origin).protocol).toBe('https:')
  const provider = buildChatProvider(config)!
  expect(provider).toBeDefined()
  const rows: any[] = [], counts = { formation: 0, organization: 0 }
  const persist = () => fs.writeFileSync(output, JSON.stringify({ model: config.model, temperature: .2, maxOutputTokens: 1500,
    enableThinking: formationEnableThinking(config) ?? 'provider-default', counts, rows }, null, 2))
  const fetchOriginal = globalThis.fetch
  let phase: keyof typeof counts = 'formation'
  vi.stubGlobal('fetch', async (url: any, init: any) => {
    expect(new URL(String(url)).origin).toBe(origin)
    expect(counts[phase]).toBeLessThan(phase === 'formation' ? 8 : 2)
    counts[phase]++; persist()
    return fetchOriginal(url, { ...init, redirect: 'error' })
  })
  const make = (id: string, texts: string[]): ConversationSession => ({ id, title: '', createdAt: 0, updatedAt: 0,
    messages: texts.map(content => ({ role: 'user', content })) })
  async function contextFor(id: string, revised: boolean) {
    const item = cases.find(c => c.id === id)!
    const active = make('active', [...(item.previous ?? []), item.current]), past = make('past', item.history ?? [])
    const at = active.messages.length - 1, message = active.messages[at]!
    const current = [{ ref: await sourceRef(active.id, at, message), message }]
    const context = (sources: FormationEvidence[]): NoteFormationContext => ({ speakers, notes: [], candidatesComplete: true,
      evidence: sources.map(e => ({ ...e, message: e.message as never, scope: e.scope === 'related-history' ? 'history' : 'current' })) })
    const selected = await (revised ? withNoteHistory : withRelatedHistory)(active.id, current, () => [active, past], e => {
      (revised ? formationInput : baseline.formationInput)(context(e))
    })
    return context(selected)
  }
  const call = async (id: string, variant: string, context: NoteFormationContext, messages: any[]) => {
    const start = performance.now(), row: any = { id, variant, inputBytes: new TextEncoder().encode(JSON.stringify(messages)).length }
    rows.push(row)
    try {
      const result = await provider.complete({ messages, temperature: .2, maxOutputTokens: 1500,
        enableThinking: formationEnableThinking(config), signal: AbortSignal.timeout(45000) })
      row.ms = performance.now() - start; row.usage = result.usage; row.text = result.text
      const lookup = (ref: any) => context.evidence.find(e => JSON.stringify(e.ref) === JSON.stringify(ref))?.message
      try {
        if (phase === 'formation') {
          const items = parseNoteBatch(result.text, context)
          row.items = items.map(i => ({ action: i.proposal?.action, error: i.error,
            authorized: i.proposal ? authorizeOrganization(i.proposal, { heads: [], complete: true, lookup }) : false }))
          row.contract = items.every(i => !!i.proposal)
        } else {
          const relations = parseSemanticRelations(result.text, context)
          row.contract = true
          row.relations = relations.map(r => ({ type: r.type, plan: !!semanticRelationPlan(r.type, r.scope,
            { note: r.from, grounds: { evidence: context.noteGrounds![r.from.id]! } },
            { note: r.to, grounds: { evidence: context.noteGrounds![r.to.id]! } }, r.sources, lookup, r.reason) }))
        }
      } catch (error: any) { row.contract = false; row.error = error.message }
      persist()
    } catch (error: any) {
      row.error = { name: error.name, status: error.status }; persist()
      throw new Error('Controlled Provider experiment stopped; inspect bounded local results without retrying')
    }
  }
  try {
    for (const id of ['failed-adjustment', 'unresolved-pronoun', 'raw-only', 'hypothetical']) {
      for (const revised of [false, true]) {
        const context = await contextFor(id, revised)
        await call(id, revised ? 'p3' : 'p2', context, (revised ? formationInput : baseline.formationInput)(context).messages)
      }
    }
    phase = 'organization'
    for (const id of ['real-association', 'false-association']) {
      const item = cases.find(c => c.id === id)!, originals = [item.history![0]!, item.current]
      const session = make('organization', originals)
      const refs = await Promise.all(session.messages.map((m, i) => sourceRef(session.id, i, m)))
      const notes = originals.map((content, i) => ({ id: 'synthetic-note-' + i, version: 1, status: 'active', content,
        subject: 'profile-user', kind: 'fact', basis: 'direct', eventTime: null, createdAt: 1 })) as NoteFormationContext['notes']
      const context: NoteFormationContext = { mode: 'organization', speakers, notes,
        noteGrounds: Object.fromEntries(notes.map((n, i) => [n.id, [refs[i]!]])),
        evidence: session.messages.map((m, i) => ({ ref: refs[i]!, message: m as never, scope: 'history' })) }
      await call(id, 'unchanged-organization', context, organizationInput(context).messages)
    }
    expect(counts).toEqual({ formation: 8, organization: 2 })
  } finally { vi.unstubAllGlobals() }
}, 520000)
