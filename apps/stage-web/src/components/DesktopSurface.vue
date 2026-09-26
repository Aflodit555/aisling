<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useSpeechStore } from '../stores/speech'
import { useStageStore } from '../stores/stage'
import CharacterSurface from './CharacterSurface.vue'
import Icon from './Icon.vue'
import SpeechBubble from './SpeechBubble.vue'

const stage = useStageStore()
const { speaking, phase } = storeToRefs(useSpeechStore())
const entered = ref(false)
const inputVisible = ref(false)
const returnVisible = ref(false)
const bubble = ref('')
const draft = ref('')
const character = ref<InstanceType<typeof CharacterSurface>>()
let pressed: { id: number; x: number; y: number; moved: boolean } | undefined
let suppressClick = false
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let returnTimer: ReturnType<typeof setTimeout> | undefined
let returnHoverStartedAt = 0
let stopPointer: (() => void) | undefined

watch(() => stage.messages.at(-1), message => {
  bubble.value = message?.role === 'assistant' || message?.role === 'error' ? message.content.trim() : ''
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
  if (pressed?.moved) return
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

function onCharacterDown(event: PointerEvent): void {
  if (event.button !== 0 || pressed) return
  pressed = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
  suppressClick = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onCharacterMove(event: PointerEvent): void {
  if (!pressed || pressed.id !== event.pointerId || pressed.moved) return
  if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 6) {
    pressed.moved = true
    clearTimeout(hoverTimer)
    hoverTimer = undefined
    inputVisible.value = false
    window.aislingDesktop?.setDragging(true)
  }
}

function stopDrag(event?: Event): void {
  if (pressed && event instanceof PointerEvent) {
    if (event.pointerId !== pressed.id) return
    if (event.type === 'pointerup')
      pressed.moved ||= Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 6
  }
  const moved = pressed?.moved
  if (pressed)
    suppressClick = pressed.moved
  pressed = undefined
  window.aislingDesktop?.setDragging(false)
  if (moved)
    onPointer('character')
}

function onCharacterClick(): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  inputVisible.value = true
  character.value?.interact()
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

onMounted(() => {
  stopPointer = window.aislingDesktop?.onDesktopPointer(onPointer)
  window.addEventListener('blur', stopDrag)
})
onUnmounted(() => {
  stopDrag()
  window.removeEventListener('blur', stopDrag)
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
        ref="character"
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
    <div data-desktop-hit class="character-hit" @pointerdown="onCharacterDown" @pointermove="onCharacterMove" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @click="onCharacterClick" />
    <SpeechBubble :text="bubble" :pending="stage.sending || stage.visionProcessing" :searching="stage.searching" :speaking="phase === 'buffering' || speaking" />
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
.character-hit { position: absolute; left: 3%; width: 94%; top: 8%; bottom: 0; cursor: pointer; touch-action: none; clip-path: polygon(30% 0, 70% 0, 85% 15%, 75% 35%, 87% 60%, 85% 100%, 15% 100%, 13% 60%, 25% 35%, 15% 15%) }
/* Floats over an arbitrary desktop, so these keep a soft shadow the rest of the app never uses. */
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
@media (prefers-reduced-motion: reduce) { .character.entered { animation-duration: 1ms } }
</style>
