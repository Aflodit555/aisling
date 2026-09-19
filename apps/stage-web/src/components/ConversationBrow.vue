<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { ConversationSession } from '../conversation/conversation-store'

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
    <button type="button" class="trigger" @click="open = !open">
      <span class="title">{{ activeTitle }}</span>
      <span class="caret">▾</span>
    </button>

    <div v-if="open" class="popover">
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
          @click.stop="emit('delete', session.id)"
        >
          🗑
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brow {
  position: relative;
}

.trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: transparent;
  color: #9d94b8;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.trigger:hover {
  color: #cfc6ea;
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.caret {
  font-size: 11px;
}

.popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  max-height: min(60vh, 400px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: #161329;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.item.active {
  background: rgba(167, 139, 250, 0.12);
}

.item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e6e0f4;
  font-size: 13px;
}

.time {
  font-size: 11px;
  color: #6f6889;
}

.delete {
  border: none;
  background: transparent;
  color: #6f6889;
  font-size: 13px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.item:hover .delete {
  opacity: 1;
}

.delete:hover {
  color: #f6c2c2;
}
</style>
