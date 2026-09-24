<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import type { DisplayMessage } from '../stores/stage'

const props = defineProps<{
  messages: DisplayMessage[]
}>()

const container = ref<HTMLElement>()

watch(
  [
    () => props.messages,
    () => props.messages.length,
    () => props.messages.at(-1)?.content,
  ],
  async () => {
    await nextTick()
    container.value?.scrollTo({
      top: container.value.scrollHeight,
      behavior: 'auto',
    })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="container" class="messages">
    <p v-if="messages.length === 0" class="empty">Aisling is waiting. Say hello.</p>
    <div
      v-for="(message, index) in messages"
      :key="index"
      class="message"
      :class="`is-${message.role}`"
    >
      <span class="role">
        {{ message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Aisling' : 'Error' }}
      </span>
      <p class="content">{{ message.content }}</p>
    </div>
  </div>
</template>

<style scoped>
.messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 2px;
  min-height: 0;
  min-width: 0;
}

.empty {
  margin: auto;
  color: #9d94b8;
  font-size: 14px;
}

.message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.message.is-user {
  align-items: flex-end;
}

.message.is-assistant {
  align-items: flex-start;
}

.message.is-error {
  align-items: flex-start;
}

.role {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8f87ad;
}

.content {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #1c1930;
  color: #e6e0f4;
}

.message.is-user .content {
  background: #372e5e;
  color: #f0ecfa;
}

.message.is-error .content {
  background: rgba(244, 113, 113, 0.12);
  color: #f6c2c2;
}
</style>
