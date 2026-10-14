export type InteractionPreference = 'quiet' | 'normal' | 'invited'

const COMMANDS: Record<InteractionPreference, readonly string[]> = {
  quiet: ['/quiet', '安静模式', '暂时别主动打扰我', '先别主动打扰我', '别主动打扰我', '暂时不要主动打扰我', '请不要主动打扰我', '暂时别主动说话', '先别主动说话', '不要主动说话'],
  normal: ['/normal', '恢复正常模式', '恢复正常交流', '恢复正常'],
  invited: ['/invited', '可以主动交流了', '可以主动说话了', '可以主动打扰我了', '允许主动交流'],
}

export const PREFERENCE_ACKNOWLEDGEMENTS: Record<InteractionPreference, string> = {
  quiet: '我先不主动说话，你找我时我照常回答。',
  normal: '恢复正常交流。',
  invited: '可以主动交流了，我会挑合适的时候开口。',
}

// Whole-message commands avoid treating quotations, questions or negations as permission.
export function recognizeInteractionPreference(text: string): InteractionPreference | undefined {
  const command = text.normalize('NFKC').trim().toLowerCase().replace(/[。.!！]+$/u, '').trim()
  return (Object.keys(COMMANDS) as InteractionPreference[]).find(preference => COMMANDS[preference].includes(command))
}
