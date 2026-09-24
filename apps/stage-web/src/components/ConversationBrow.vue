<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { ConversationSession } from '../conversation/conversation-store'
import Icon from './Icon.vue'

const props = defineProps<{
  sessions: ConversationSession[]
  activeId: string
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'delete', id: string): void
}>()

const open = ref(false)
const root = ref<HTMLElement>()

function onDocumentClick(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node))
    open.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

const activeTitle = computed(() => (
  props.sessions.find(session => session.id === props.activeId)?.title ?? 'New conversation'
))

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString()
}
</script>

<template>
  <div ref="root" class="brow">
    <button type="button" class="trigger" :aria-expanded="open" @click="open = !open">
      <span class="title">{{ activeTitle }}</span>
      <Icon name="chevron" :size="16" />
    </button>

    <div v-if="open" class="pop menu">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="item"
        :class="{ active: session.id === activeId }"
        @click="emit('select', session.id); open = false"
      >
        <span class="item-title">{{ session.title }}</span>
        <span class="time">{{ formatTime(session.updatedAt) }}</span>
        <button
          type="button"
          class="delete"
          title="Delete conversation"
          aria-label="Delete conversation"
          @click.stop="emit('delete', session.id)"
        >
          <Icon name="trash" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brow { position: relative }
.trigger { display: flex; align-items: center; gap: .25rem; max-width: 100%; padding: .4rem .5rem; margin-left: -.5rem; border: none; border-radius: 4px; background: none; color: var(--muted); font-weight: 500; transition: color .15s }
/* The trigger sits flush with the dock's clipped top edge: draw the ring inside it. */
.trigger:focus-visible { outline-offset: -2px }
.trigger:hover, .trigger[aria-expanded="true"] { color: var(--fg) }
.trigger svg { flex: none }
.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; display: flex; flex-direction: column; max-height: min(60vh, 400px); overflow: hidden auto; padding: .25rem }
.item { display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; border-radius: 6px; cursor: pointer; transition: background .15s }
.item:hover { background: var(--hover) }
.item.active { background: var(--tonal) }
.item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.time { flex: none; color: var(--muted); font-size: .75rem; font-variant-numeric: tabular-nums }
.delete { flex: none; width: 1.75rem; height: 1.75rem; margin: -.25rem 0; display: flex; align-items: center; justify-content: center; padding: 0; border: none; border-radius: 4px; background: none; color: var(--muted); opacity: 0; transition: opacity .15s, background .15s, color .15s }
.item:hover .delete, .delete:focus-visible { opacity: 1 }
.delete:hover { color: var(--fg); background: var(--hover) }
</style>
