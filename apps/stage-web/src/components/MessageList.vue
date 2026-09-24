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
.messages { display: flex; flex: 1; flex-direction: column; gap: 1rem; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: .25rem 0 }
.empty { margin: auto; color: var(--muted) }
.message { display: flex; flex-direction: column; align-items: flex-start; gap: .25rem; max-width: 100%; animation: rise .3s var(--ease) both }
.message.is-user { align-items: flex-end }
.role { font-size: .75rem; font-weight: 500; color: var(--muted) }
.content { padding: .5rem .9rem; border-radius: 8px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--rule) }
.is-user .content { background: var(--tonal); border-color: transparent }
.is-error .content { background: color-mix(in srgb, var(--danger) 12%, var(--bg)); border-color: transparent; color: var(--danger) }
</style>
