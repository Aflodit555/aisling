<script setup lang="ts">
import type { ImageInput } from '@aisling/core'
import { storeToRefs } from 'pinia'

import { createHearingStimulus } from '../adapter/hearing'
import CharacterSurface from '../components/CharacterSurface.vue'
import InteractionDock from '../components/InteractionDock.vue'
import { useSpeechStore } from '../stores/speech'
import { useStageStore } from '../stores/stage'

const stage = useStageStore()
const speech = useSpeechStore()
const { activeSessionId, characterName, messages, searching, sending, sessions, visionProcessing } = storeToRefs(stage)
const { speaking } = storeToRefs(speech)

function onSpeech(text: string): void {
  stage.sendStimulus(createHearingStimulus(text))
}

function onImage(payload: { image: ImageInput; caption: string }): void {
  void stage.sendImage(payload.image, payload.caption)
}
</script>

<template>
  <div class="stage">
    <CharacterSurface
      :name="characterName"
      :active="sending"
      :speaking="speaking"
      :searching="searching"
      :looking="visionProcessing"
    />
    <InteractionDock
      :messages="messages"
      :sending="sending"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      @send="stage.send"
      @speech="onSpeech"
      @image="onImage"
      @select-session="stage.switchSession"
      @new-conversation="stage.newConversation"
      @delete-session="stage.deleteSession"
    />
  </div>
</template>

<style scoped>
.stage { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden }
</style>
