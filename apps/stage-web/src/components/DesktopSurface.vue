<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useSpeechStore } from '../stores/speech'
import { useStageStore } from '../stores/stage'
import CharacterSurface from './CharacterSurface.vue'
import Icon from './Icon.vue'

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
let returnTimer: ReturnType<typeof setTimeout> | undefined
let returnHoverStartedAt = 0
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
  scheduleReturnHide()
}

function hideReturnButton(): void {
  clearTimeout(returnTimer)
  returnTimer = undefined
  returnHoverStartedAt = 0
  returnVisible.value = false
}

function scheduleReturnHide(): void {
  clearTimeout(returnTimer)
  returnTimer = setTimeout(() => {
    if (returnHoverStartedAt && performance.now() - returnHoverStartedAt >= 300)
      scheduleReturnHide()
    else
      hideReturnButton()
  }, 3500)
}

function onReturnPointerEnter(): void {
  returnHoverStartedAt = performance.now()
}

function returnToStage(): void {
  void window.aislingDesktop?.returnToStage()
}

onMounted(() => { stopPointer = window.aislingDesktop?.onDesktopPointer(onPointer) })
onUnmounted(() => {
  stopPointer?.()
  clearTimeout(hoverTimer)
  clearTimeout(leaveTimer)
  clearTimeout(returnTimer)
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
    <form v-if="inputVisible" data-desktop-hit class="desktop-composer" @click="hideReturnButton" @submit.prevent="submit">
      <input v-model="draft" aria-label="给 Aisling 发消息" placeholder="说点什么…" :disabled="stage.sending" @keydown.esc="inputVisible = false">
      <button type="submit" :disabled="!draft.trim() || stage.sending" aria-label="发送消息"><Icon name="send" :size="16" /></button>
    </form>
    <Transition name="return-fade">
      <button v-if="returnVisible" data-desktop-hit class="return-button" type="button" @pointerenter="onReturnPointerEnter" @pointerleave="returnHoverStartedAt = 0" @click="returnToStage">
        back
      </button>
    </Transition>
  </main>
</template>

<style scoped>
.desktop-surface { position: relative; width: 100%; height: 100%; overflow: hidden; background: transparent }
.character { position: absolute; inset: 0; transform: translateY(100%); pointer-events: none }
.character.entered { animation: rise 850ms both }
.character-hit { position: absolute; left: 3%; width: 94%; top: 8%; bottom: 0; cursor: pointer; clip-path: polygon(30% 0, 70% 0, 85% 15%, 75% 35%, 87% 60%, 85% 100%, 15% 100%, 13% 60%, 25% 35%, 15% 15%) }
/* Floats over an arbitrary desktop, so these three keep a soft shadow the rest of the app never uses. */
.bubble { position: absolute; top: 14px; left: 7%; width: max-content; max-width: 86%; max-height: 35%; overflow: auto; padding: .5rem .9rem; border: 1px solid var(--rule); border-radius: 8px; background: var(--bg); color: var(--fg); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; box-shadow: 0 4px 18px rgb(0 0 0 / .18); animation: fade .2s var(--ease) }
.desktop-composer { position: absolute; left: 50%; width: 67.5%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: .5rem; padding: .25rem .3rem .25rem 1rem; border: 1px solid var(--rule); border-radius: 999px; background: var(--bg); color: var(--fg); box-shadow: 0 4px 18px rgb(0 0 0 / .18); transition: border-color .15s }
.desktop-composer:hover, .desktop-composer:focus-within { border-color: var(--muted) }
.desktop-composer input { flex: 1; min-width: 0; padding: .25rem 0; border: 0; outline: none; background: none; color: inherit; font: inherit }
.desktop-composer input::placeholder { color: var(--muted) }
.desktop-composer button { flex: none; width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--tonal); color: var(--fg); transition: background .15s, transform .1s }
.desktop-composer button:hover { background: var(--tonal-strong) }
.desktop-composer button:active { transform: scale(.94) }
.desktop-composer button:disabled { opacity: .45; cursor: default; transform: none; background: var(--tonal) }
.return-button { position: absolute; top: 120px; right: 28px; padding: .4rem .9rem; border: 1px solid var(--rule); border-radius: 999px; background: var(--bg); color: var(--fg); font-size: .85rem; box-shadow: 0 4px 18px rgb(0 0 0 / .18); transition: background .15s, transform .1s }
.return-button:hover { background: var(--tonal) }
.return-button:active { transform: scale(.97) }
.return-fade-leave-active { transition: opacity .5s; pointer-events: none }
.return-fade-leave-to { opacity: 0 }
@keyframes rise { 0% { transform: translateY(100%) } 72% { transform: translateY(-18px) } 100% { transform: translateY(0) } }
@keyframes fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .character.entered { animation-duration: 1ms } }
</style>
