const { createHash } = require('node:crypto')

const messageDigest = message => createHash('sha256').update(JSON.stringify(message)).digest('hex')

function readConversationSessions(data) {
  const { sessions } = JSON.parse(data['aisling.conversations.v1'] || '{"sessions":[]}')
  if (!Array.isArray(sessions)) throw new Error('conversation-invalid')
  return sessions
}

function sourceMessageLookup(data) {
  const sessions = new Map()
  for (const session of readConversationSessions(data))
    sessions.set(session.id, sessions.has(session.id) ? null : session)

  return ref => {
    const messages = sessions.get(ref.sessionId)?.messages
    const message = Array.isArray(messages) ? messages[ref.messageIndex] : undefined
    if (message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
      && !message.noteDerived && !message.toolCalls?.length && !message.toolCallId
      && messageDigest(message) === ref.digest) return message
  }
}

const sourceLookup = data => {
  const lookup = sourceMessageLookup(data)
  return ref => !!lookup(ref)
}

function currentSources(refs, data) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(sourceLookup(data))
}

module.exports = { messageDigest, readConversationSessions, sourceMessageLookup, sourceLookup, currentSources }
