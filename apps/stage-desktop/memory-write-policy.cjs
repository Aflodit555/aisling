const speakers=require('./memory-subjects.json')
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
module.exports={speakerQualification}
