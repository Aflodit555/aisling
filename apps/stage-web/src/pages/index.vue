<script setup lang="ts">
import type { ImageInput } from '@aisling/core'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'

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
    <header class="chrome">
      <span class="brand">Aisling</span>
      <nav class="nav">
        <RouterLink class="nav-link" to="/settings">Settings</RouterLink>
        <RouterLink class="nav-link muted" to="/devtools">Devtools</RouterLink>
      </nav>
    </header>

    <main class="body">
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
    </main>
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  box-sizing: border-box;
}

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.brand {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #cfc6ea;
}

.nav {
  display: flex;
  gap: 16px;
}

.nav-link {
  font-size: 12px;
  color: #8f87ad;
  text-decoration: none;
}

.nav-link:hover {
  color: #cfc6ea;
}

.nav-link.muted {
  color: #5f5878;
}

.body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
