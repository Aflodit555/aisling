import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EMOTIONS, type EmotionWeights } from '../presentation/emotion-state'
import { blendExpression, createEmotionLayer, MAO_LOOKS } from './emotion-look'
import { parseExpression, type Live2DRig } from './rig'

const MAO = resolve(__dirname, '../../public/live2d/mao')
const maoModel = JSON.parse(readFileSync(resolve(MAO, 'mao_pro.model3.json'), 'utf8'))

function maoRig(): Live2DRig {
  const expressions = new Map<string, ReturnType<typeof parseExpression>>()
  for (const { Name, File } of maoModel.FileReferences.Expressions)
    expressions.set(Name, parseExpression(JSON.parse(readFileSync(resolve(MAO, File), 'utf8'))))
  return { eyeBlinkIds: [], lipSyncIds: [], expressions, playMotion: async () => true, playRandomMotion: async () => true, isGesture: () => false }
}

const weights = (partial: Partial<EmotionWeights>): EmotionWeights =>
  ({ ...Object.fromEntries(EMOTIONS.map(e => [e, 0])), ...partial }) as EmotionWeights

function sample(rig: Live2DRig, w: EmotionWeights, base: Record<string, number>) {
  const layer = createEmotionLayer({ rig, looks: MAO_LOOKS, weights: () => w, priority: 30 })
  return layer.sample({ readBase: id => base[id] ?? 0, dtMs: 16 })
}

describe('emotion look (Mao)', () => {
  it('every emotion uses an expression and gesture that exist on Mao', () => {
    const names = new Set(maoModel.FileReferences.Expressions.map((e: { Name: string }) => e.Name))
    const motions = new Set(Object.values(maoModel.FileReferences.Motions).flat()
      .map((m: any) => m.File.split('/').pop().split('.')[0]))
    for (const look of Object.values(MAO_LOOKS)) {
      expect(names.has(look.expression)).toBe(true)
      if (look.gesture)
        expect(motions.has(look.gesture)).toBe(true)
    }
    // One distinct expression per emotion: no two categories render the same.
    expect(new Set(Object.values(MAO_LOOKS).map(l => l.expression)).size).toBe(EMOTIONS.length)
  })

  it('parses exp3 files and drops no-op entries', () => {
    const joy = maoRig().expressions.get('exp_02')!
    expect(joy).toEqual([
      { id: 'ParamEyeLOpen', value: 0, blend: 'Multiply' },
      { id: 'ParamEyeLSmile', value: 1, blend: 'Add' },
      { id: 'ParamEyeROpen', value: 0, blend: 'Multiply' },
      { id: 'ParamEyeRSmile', value: 1, blend: 'Add' },
    ])
  })

  it('blends Cubism expression rules at partial weight', () => {
    expect(blendExpression(1, { id: 'a', value: 0, blend: 'Multiply' }, 0.5)).toBeCloseTo(0.5)
    expect(blendExpression(0.2, { id: 'a', value: 1, blend: 'Add' }, 0.5)).toBeCloseTo(0.7)
    expect(blendExpression(0.2, { id: 'a', value: 1, blend: 'Overwrite' }, 0.5)).toBeCloseTo(0.6)
  })

  it('claims nothing at neutral', () => {
    expect(sample(maoRig(), weights({}), {})).toBeUndefined()
  })

  it('scales expression and pose with the weight, on top of the base', () => {
    const half = sample(maoRig(), weights({ sad: 0.5 }), { ParamMouthUp: 1, ParamAngleY: 2 })!
    expect(half.get('ParamMouthUp')).toBeCloseTo(0.5) // exp_05: MouthUp -1 at full weight
    expect(half.get('ParamAngleY')).toBeCloseTo(2 - 6)
    const joy = sample(maoRig(), weights({ joy: 1 }), { ParamEyeLOpen: 1 })!
    expect(joy.get('ParamEyeLOpen')).toBeCloseTo(0)
  })

  it('mixes two emotions during a cross-fade', () => {
    const mixed = sample(maoRig(), weights({ joy: 0.5, shy: 0.5 }), { ParamEyeLOpen: 1 })!
    expect(mixed.get('ParamEyeLOpen')).toBeCloseTo(0.5)
    expect(mixed.get('ParamCheek')).toBeCloseTo(0.5)
  })

  it('still applies the pose on a model without the expression', () => {
    const bare: Live2DRig = { ...maoRig(), expressions: new Map() }
    const out = sample(bare, weights({ angry: 1 }), {})!
    expect(out.get('ParamAngleX')).toBe(-14)
    expect(out.has('ParamMouthAngry')).toBe(false)
  })

  it('lets authored wink and pose perform, then restores the same emotion smoothly', () => {
    let gesture = false
    const rig = { ...maoRig(), isGesture: () => gesture }
    const layer = createEmotionLayer({ rig, looks: MAO_LOOKS, weights: () => weights({ joy: 1 }), priority: 30 })
    const sample = () => layer.sample({ readBase: id => id === 'ParamEyeROpen' ? 1 : 0, dtMs: 16 })
    expect(sample()!.get('ParamEyeROpen')).toBe(0)
    gesture = true
    for (let i = 0; i < 40; i++) sample()
    expect(sample()).toBeUndefined()
    gesture = false
    expect(sample()!.get('ParamEyeROpen')).toBeCloseTo(0.968)
    for (let i = 0; i < 40; i++) sample()
    expect(sample()!.get('ParamEyeROpen')).toBe(0)
  })
})
