const speakers=require('./memory-subjects.json')
const colorScope = /颜色|色彩|色系|色调|[红橙黄绿蓝紫粉棕黑白灰]色|\bcolou?rs?\b/iu

function reportedColor(message) {
  if (message.role !== 'user' || typeof message.content !== 'string' || message.toolCalls?.length || message.toolCallId) return
  const match = /^我最喜欢的颜色是([红橙黄绿蓝紫粉棕黑白灰]色)[。.]?$/u.exec(message.content.trim())
  if (match) return { content: `用户自述最喜欢的颜色是${match[1]}。`, tags: ['颜色偏好', match[1]] }
}

function verifiedColorPreference(item, reflection, messages) {
  const draft = item.draft
  const preference = messages.length === 1 ? reportedColor(messages[0]) : undefined
  if (preference && reflection?.kind === 'preference' && reflection.basis === 'direct' && reflection.content === preference.content
    && draft?.content === preference.content && draft.subject === speakers.user.subject && draft.basis === 'direct'
    && draft.eventTime === null && draft.uncertainty === undefined && draft.context === undefined && draft.keywords === undefined)
    return preference
}
/** Qualification describes an attributed utterance, never the truth of its quoted proposition. */
function speakerQualification(item,reflection,messages){
 if(!item.draft||!reflection||reflection.basis!=='direct'||reflection.kind!=='event'||messages.length!==1)return 'source-category-review'
 const message=messages[0],speaker=speakers[message.role]
 if(!speaker||typeof message.content!=='string'||message.toolCalls?.length||message.toolCallId)return 'source-category-review'
 if(item.draft.subject!==speaker.subject)return 'subject-needs-review'
 if(item.draft.content!==speaker.prefix+message.content||reflection.content!==item.draft.content)return 'utterance-scope-review'
 if(item.draft.eventTime!==null||item.draft.basis!=='direct'||item.draft.uncertainty!==undefined||item.draft.context!==undefined||item.draft.keywords!==undefined
  ||item.draft.tags?.some(tag=>!message.content.includes(tag)))return 'time-or-inference-review'
 return null
}
module.exports={speakerQualification, verifiedColorPreference, reportedColor, colorScope}
