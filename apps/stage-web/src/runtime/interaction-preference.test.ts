import { describe, expect, it } from 'vitest'
import { recognizeInteractionPreference } from './interaction-preference'

describe('explicit interaction preference commands', () => {
  it.each([
    ['暂时别主动打扰我', 'quiet'],
    [' 请不要主动打扰我。 ', 'quiet'],
    ['/QUIET!', 'quiet'],
    ['恢复正常交流', 'normal'],
    ['/normal', 'normal'],
    ['可以主动交流了！', 'invited'],
    ['/invited', 'invited'],
  ] as const)('recognizes the complete command %s', (text, expected) => {
    expect(recognizeInteractionPreference(text)).toBe(expected)
  })

  it.each([
    '你好', '谢谢', '安静', '不要进入安静模式', '我不是说暂时别主动打扰我',
    '请解释“暂时别主动打扰我”是什么意思', '翻译：暂时别主动打扰我',
    '他说：暂时别主动打扰我', '暂时别主动打扰我，但是帮我解释一下这段代码',
    '可以主动交流了吗？', '恢复正常交流吗？', '',
  ])('does not infer intent from keywords or quoted/ambiguous text: %s', (text) => {
    expect(recognizeInteractionPreference(text)).toBeUndefined()
  })
})
