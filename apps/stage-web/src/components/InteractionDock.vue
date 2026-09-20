<script setup lang="ts">
import type { ImageInput } from '@aisling/core'
import { ref } from 'vue'

import type { ConversationSession } from '../conversation/conversation-store'
import type { SelectedImage } from '../image/file'
import type { DisplayMessage } from '../stores/stage'

import Composer from './Composer.vue'
import AutonomousControls from './AutonomousControls.vue'
import ConversationBrow from './ConversationBrow.vue'
import ImageInputButton from './ImageInput.vue'
import MessageList from './MessageList.vue'
import MicButton from './MicButton.vue'

defineProps<{
  messages: DisplayMessage[]
  sending: boolean
  sessions: ConversationSession[]
  activeSessionId: string
}>()

const emit = defineEmits<{
  (event: 'send', text: string): void
  (event: 'speech', text: string): void
  (event: 'image', payload: { image: ImageInput; caption: string }): void
  (event: 'select-session', id: string): void
  (event: 'new-conversation'): void
  (event: 'delete-session', id: string): void
}>()

const selectedImage = ref<SelectedImage>()

function onSend(text: string): void {
  if (selectedImage.value) {
    const { previewUrl: _preview, ...image } = selectedImage.value
    emit('image', { image, caption: text })
    selectedImage.value = undefined
    return
  }
  emit('send', text)
}
</script>

<template>
  <aside class="dock">
    <ConversationBrow
      :sessions="sessions"
      :active-id="activeSessionId"
      @select="emit('select-session', $event)"
      @delete="emit('delete-session', $event)"
    />

    <MessageList :messages="messages" />

    <AutonomousControls />

    <div class="input-row">
      <ImageInputButton
        :image="selectedImage"
        @select="selectedImage = $event"
        @remove="selectedImage = undefined"
      />
      <MicButton @transcribed="emit('speech', $event)" />
      <button type="button" class="new-btn" title="New conversation" @click="emit('new-conversation')">＋</button>
      <Composer :disabled="sending" @send="onSend" />
    </div>
  </aside>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 0 auto;
  width: clamp(392px, 45vw, 500px);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 16px 20px 20px;
  background: rgba(13, 11, 22, 0.55);
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.new-btn {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c1930;
  color: #e6e0f4;
  font-size: 18px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
</style>
