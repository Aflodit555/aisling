import { describe, expect, it, vi } from 'vitest'

import { createParameterController, type CoreModelLike, type ParameterSource } from './parameter-controller'

interface TestCore extends CoreModelLike {
  params: Map<string, number>
  written: Map<string, number>
}

function makeCore(initial: Record<string, number> = {}): TestCore {
  const params = new Map(Object.entries(initial))
  const written = new Map<string, number>()
  return {
    params,
    written,
    getParameterValueById: id => params.get(id) ?? 0,
    setParameterValueById: (id, value) => {
      params.set(id, value)
      written.set(id, value)
    },
  }
}

function source(
  id: string,
  priority: number,
  targets: string[],
  sample: ParameterSource['sample'],
): ParameterSource {
  return { id, priority, targets: new Set(targets), sample }
}

describe('parameter controller', () => {
  it('applies claims in priority order with higher priority winning', () => {
    const controller = createParameterController()
    const low = source('low', 1, ['ParamA'], () => new Map([['ParamA', 0.3]]))
    const high = source('high', 2, ['ParamA'], () => new Map([['ParamA', 0.9]]))
    controller.setSources([high, low]) // intentionally unordered input
    const core = makeCore()

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamA')).toBe(0.9)
  })

  it('lets a source read the native base value for a cross-fade', () => {
    const controller = createParameterController()
    const speech = source('speech', 10, ['ParamMouthOpenY'], ({ readBase }) => {
      const base = readBase('ParamMouthOpenY')
      return new Map([['ParamMouthOpenY', base * 0.5]])
    })
    controller.setSources([speech])
    const core = makeCore({ ParamMouthOpenY: 0.8 })

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamMouthOpenY')).toBeCloseTo(0.4)
  })

  it('does not write a parameter when no source claims it', () => {
    const controller = createParameterController()
    const manual = source('manual', 10, ['ParamAngleX'], () => new Map([['ParamAngleX', 12]]))
    controller.setSources([manual])
    const core = makeCore({ ParamMouthOpenY: 0.5 })

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamMouthOpenY')).toBe(0.5)
    expect(core.getParameterValueById('ParamAngleX')).toBe(12)
  })

  it('keeps manual ParamAngleX independent of a mouth source', () => {
    const controller = createParameterController()
    const manual = source('manual', 10, ['ParamAngleX'], () => new Map([['ParamAngleX', 12]]))
    const speech = source('speech', 100, ['ParamMouthOpenY'], () => new Map([['ParamMouthOpenY', 0.7]]))
    controller.setSources([manual, speech])
    const core = makeCore()

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamAngleX')).toBe(12)
    expect(core.getParameterValueById('ParamMouthOpenY')).toBe(0.7)
  })

  it('does not write when a source returns undefined (ownership released)', () => {
    const controller = createParameterController()
    const speech = source('speech', 100, ['ParamMouthOpenY'], () => undefined)
    controller.setSources([speech])
    const core = makeCore({ ParamMouthOpenY: 0.5 })

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamMouthOpenY')).toBe(0.5)
  })

  it('writes each claimed parameter exactly once (single write point)', () => {
    const controller = createParameterController()
    const single = source('single', 1, ['ParamA', 'ParamB'], () => new Map([['ParamA', 1], ['ParamB', 2]]))
    controller.setSources([single])
    const core = makeCore()
    const spy = vi.spyOn(core, 'setParameterValueById')

    controller.apply(core, 16)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(core.getParameterValueById('ParamA')).toBe(1)
    expect(core.getParameterValueById('ParamB')).toBe(2)
  })

  it('composes layers: a higher source reads the value left by lower sources', () => {
    const controller = createParameterController()
    const idle = source('idle', 20, ['ParamAngleX'], ({ readBase }) => new Map([['ParamAngleX', readBase('ParamAngleX') + 3]]))
    const emotion = source('emotion', 30, ['ParamAngleX'], ({ readBase }) => new Map([['ParamAngleX', readBase('ParamAngleX') - 10]]))
    controller.setSources([emotion, idle])
    const core = makeCore({ ParamAngleX: 2 })
    const spy = vi.spyOn(core, 'setParameterValueById')

    controller.apply(core, 16)

    expect(core.getParameterValueById('ParamAngleX')).toBe(-5)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('restore puts back native values so additive layers do not stack across frames', () => {
    const controller = createParameterController()
    controller.setSources([source('idle', 20, ['ParamEyeBallX'], ({ readBase }) => new Map([['ParamEyeBallX', readBase('ParamEyeBallX') + 0.3]]))])
    // No motion writes ParamEyeBallX, so its value carries over between frames.
    const core = makeCore({ ParamEyeBallX: 0.1 })
    for (let frame = 0; frame < 5; frame++) {
      controller.restore(core)
      controller.apply(core, 16)
    }
    expect(core.getParameterValueById('ParamEyeBallX')).toBeCloseTo(0.4)
    controller.restore(core)
    expect(core.getParameterValueById('ParamEyeBallX')).toBeCloseTo(0.1)
  })
})
