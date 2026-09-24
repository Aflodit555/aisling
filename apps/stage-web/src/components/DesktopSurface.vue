<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useSpeechStore } from '../stores/speech'
import { useStageStore } from '../stores/stage'
import CharacterSurface from './CharacterSurface.vue'

const stage = useStageStore()
const { speaking } = storeToRefs(useSpeechStore())
const entered = ref(false)
const inputVisible = ref(false)
const returnVisible = ref(false)
const bubble = ref('')
const bubbleElement = ref<HTMLElement>()
const draft = ref('')
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let stopPointer: (() => void) | undefined

watch(() => stage.messages.at(-1), message => {
  if (message?.role === 'assistant' && message.content.trim())
    bubble.value = message.content.trim()
  else
    bubble.value = ''
  void nextTick(() => { if (bubbleElement.value) bubbleElement.value.scrollTop = bubbleElement.value.scrollHeight })
})

function onReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => { entered.value = true }))
}

function submit(): void {
  const text = draft.value.trim()
  if (!text || stage.sending) return
  stage.send(text)
  draft.value = ''
}

function onPointer(kind: 'character' | 'input' | 'ui' | 'none'): void {
  if (kind === 'character' || kind === 'input') {
    clearTimeout(leaveTimer)
    leaveTimer = undefined
    if (kind === 'character' && !inputVisible.value && !hoverTimer)
      hoverTimer = setTimeout(() => { inputVisible.value = true; hoverTimer = undefined }, 300)
  }
  else {
    clearTimeout(hoverTimer)
    hoverTimer = undefined
    if (!leaveTimer)
      leaveTimer = setTimeout(() => { inputVisible.value = false; leaveTimer = undefined }, 300)
  }
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  returnVisible.value = true
  inputVisible.value = false
}

function returnToStage(): void {
  void window.aislingDesktop?.returnToStage()
}

onMounted(() => { stopPointer = window.aislingDesktop?.onDesktopPointer(onPointer) })
onUnmounted(() => {
  stopPointer?.()
  clearTimeout(hoverTimer)
  clearTimeout(leaveTimer)
})
</script>

<template>
  <main class="desktop-surface" @contextmenu="onContextMenu">
    <div class="character" :class="{ entered }">
      <CharacterSurface
        :name="stage.characterName"
        :active="stage.sending"
        :speaking="speaking"
        :searching="stage.searching"
        :looking="stage.visionProcessing"
        desktop
        @ready="onReady"
        @error="entered = true"
      />
    </div>
    <div data-desktop-hit class="character-hit" @click="inputVisible = true" />
    <p v-if="bubble" ref="bubbleElement" data-desktop-hit class="bubble">{{ bubble }}</p>
    <form v-if="inputVisible" data-desktop-hit class="desktop-composer" @submit.prevent="submit">
      <input v-model="draft" aria-label="给 Aisling 发消息" placeholder="说点什么…" :disabled="stage.sending" @keydown.esc="inputVisible = false">
      <button type="submit" :disabled="!draft.trim() || stage.sending" aria-label="发送消息">↑</button>
    </form>
    <button v-if="returnVisible" data-desktop-hit class="return-button" type="button" @click="returnToStage">
      返回主窗口
    </button>
  </main>
</template>

<style scoped>
.desktop-surface { position: relative; width: 100%; height: 100%; overflow: hidden; background: transparent; }
.character { position: absolute; inset: 0; transform: translateY(100%); pointer-events: none; }
.character.entered { animation: rise 850ms both; }
.character-hit { position: absolute; left: 3%; width: 94%; top: 8%; bottom: 0; cursor: pointer; clip-path: polygon(30% 0, 70% 0, 85% 15%, 75% 35%, 87% 60%, 85% 100%, 15% 100%, 13% 60%, 25% 35%, 15% 15%); }
.bubble { position: absolute; top: 14px; left: 7%; width: max-content; max-width: 86%; max-height: 35%; overflow: auto; margin: 0; padding: 10px 15px; border-radius: 17px; background: #fff; color: #302a3a; font-size: 14px; line-height: 1.45; white-space: pre-wrap; box-shadow: 0 4px 18px #0003; overflow-wrap: anywhere; user-select: text; }
.desktop-composer { position: absolute; left: 50%; width: 67.5%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 5px 7px 5px 14px; border-radius: 999px; background: #fff; color: #24202d; box-shadow: 0 4px 18px #0004; }
.desktop-composer input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 14px; }
.desktop-composer button { width: 29px; height: 29px; border: 0; border-radius: 50%; background: #6754ac; color: #fff; cursor: pointer; }
.desktop-composer button:disabled { opacity: .45; cursor: default; }
.return-button { position: absolute; top: 120px; right: 28px; padding: 7px 11px; border: 1px solid #ffffffa6; border-radius: 999px; background: #2a243bd9; color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
@keyframes rise { 0% { transform: translateY(100%); } 72% { transform: translateY(-18px); } 100% { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .character.entered { animation-duration: 1ms; } }
</style>
