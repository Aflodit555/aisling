<script setup lang="ts">
import { t } from '../i18n'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useSpeechStore } from '../stores/speech'
import { useStageStore } from '../stores/stage'
import { DESKTOP_ENTRANCE_OVERSHOOT, fitDesktopCharacter } from '../live2d/presentation'
import { usePresentationStore } from '../stores/presentation'
import CharacterSurface from './CharacterSurface.vue'
import Icon from './Icon.vue'
import SpeechBubble from './SpeechBubble.vue'

const stage = useStageStore()
const presentation = usePresentationStore()
const composerStyle = ref({ left: '50%', width: '320px' })
const bubbleStyle = ref<Record<string, string>>({})
const speechBubble = ref<InstanceType<typeof SpeechBubble>>()

function visibleDesktopArea() {
  const display = window.screen as Screen & { availLeft?: number; availTop?: number }
  const screenLeft = display.availLeft ?? 0
  const screenTop = display.availTop ?? 0
  return {
    left: Math.max(0, screenLeft - window.screenX) + 12,
    right: Math.min(innerWidth, screenLeft + screen.availWidth - window.screenX) - 12,
    top: Math.max(0, screenTop - window.screenY) + 8,
    bottom: Math.min(innerHeight, screenTop + screen.availHeight - window.screenY) - 8,
  }
}

function positionComposer(): void {
  const { left, right } = visibleDesktopArea()
  const width = Math.min(320, Math.max(0, right - left))
  const clamp = (x: number, size: number) => Math.max(left, Math.min(right - size, x))
  composerStyle.value = { left: `${clamp(innerWidth / 2 - width / 2, width) + width / 2}px`, width: `${width}px` }
  positionBubble()
}

function positionBubble(): void {
  const layout = presentation.stageLayout
  const element = speechBubble.value?.$el as HTMLElement | undefined
  if (!layout || !element) return
  const { left, right, top, bottom } = visibleDesktopArea()
  const width = Math.max(0, Math.min(innerWidth * .85, right - left))
  const contentWidth = Math.max(0, width - 30)
  const fitted = fitDesktopCharacter({ width: innerWidth, height: innerHeight }, layout, presentation.transform)
  const headTop = fitted.y + layout.body.y * fitted.scale
  const bubbleWidth = element.offsetWidth
  const bubbleHeight = element.offsetHeight
  const x = Math.max(left + bubbleWidth / 2, Math.min(right - bubbleWidth / 2, innerWidth / 2))
  const y = Math.max(top, Math.min(bottom - bubbleHeight, headTop - bubbleHeight - 12))
  bubbleStyle.value = {
    left: `${x - bubbleWidth / 2}px`, top: `${y}px`, right: 'auto', margin: '0',
    maxWidth: `${contentWidth}px`, maxHeight: `${Math.max(0, bottom - top - 16)}px`,
    '--bubble-content-width': `${contentWidth}px`,
  }
}
const { speaking, phase } = storeToRefs(useSpeechStore())
const entered = ref(false)
const inputVisible = ref(false)
const bubble = ref('')
const draft = ref('')
const character = ref<InstanceType<typeof CharacterSurface>>()
let pressed: { id: number; x: number; y: number; moved: boolean } | undefined
let suppressClick = false
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let stopPointer: (() => void) | undefined
let bubbleObserver: ResizeObserver | undefined

watch(() => [presentation.stageLayout, presentation.transform], positionBubble, { flush: 'post' })

watch(() => stage.messages.at(-1), message => {
  bubble.value = message?.role === 'assistant' || message?.role === 'error' ? message.content.trim() : ''
})

function onReady(): void {
  positionComposer()
  requestAnimationFrame(() => requestAnimationFrame(() => { entered.value = true }))
}

function submit(): void {
  const text = draft.value.trim()
  if (!text || stage.sending) return
  stage.send(text)
  draft.value = ''
}

function onPointer(kind: 'character' | 'input' | 'ui' | 'none'): void {
  positionComposer()
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
  if (event.target instanceof Element && event.target.closest('.desktop-composer')) return
  event.preventDefault()
  window.aislingDesktop?.openDesktopMenu()
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
  positionComposer()
  inputVisible.value = true
  character.value?.interact()
}

onMounted(() => {
  const element = speechBubble.value?.$el as HTMLElement | undefined
  if (element) {
    bubbleObserver = new ResizeObserver(positionBubble)
    bubbleObserver.observe(element)
  }
  stopPointer = window.aislingDesktop?.onDesktopPointer(onPointer)
  window.addEventListener('blur', stopDrag)
  window.addEventListener('move', positionComposer)
  window.addEventListener('resize', positionComposer)
})
onUnmounted(() => {
  bubbleObserver?.disconnect()
  stopDrag()
  window.removeEventListener('blur', stopDrag)
  window.removeEventListener('move', positionComposer)
  window.removeEventListener('resize', positionComposer)
  stopPointer?.()
  clearTimeout(hoverTimer)
  clearTimeout(leaveTimer)
})
</script>

<template>
  <main class="desktop-surface" @contextmenu="onContextMenu">
    <div class="character" :class="{ entered }" :style="{ '--entrance-overshoot': `${DESKTOP_ENTRANCE_OVERSHOOT}px` }">
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
    <SpeechBubble ref="speechBubble" :style="bubbleStyle" :text="bubble" :pending="stage.sending || stage.visionProcessing" :searching="stage.searching" :speaking="phase === 'buffering' || speaking" />
    <form v-if="inputVisible" data-desktop-hit class="desktop-composer" :style="composerStyle" @submit.prevent="submit">
      <input v-model="draft" :aria-label="t('Message Aisling')" :placeholder="t('Say something…')" :disabled="stage.sending" @keydown.esc="inputVisible = false">
      <button type="submit" :disabled="!draft.trim() || stage.sending" :aria-label="t('Send message')"><Icon name="send" :size="16" /></button>
    </form>
  </main>
</template>

<style scoped>
.desktop-surface { position: relative; width: 100%; height: 100%; overflow: hidden; background: transparent }
.character { position: absolute; inset: 0; transform: translateY(100%); pointer-events: none }
.character.entered { animation: rise 850ms both }
.character-hit { position: absolute; left: 3%; width: 94%; top: 8%; bottom: 0; cursor: pointer; touch-action: none; clip-path: polygon(30% 0, 70% 0, 85% 15%, 75% 35%, 87% 60%, 85% 100%, 15% 100%, 13% 60%, 25% 35%, 15% 15%) }
/* Floats over an arbitrary desktop, so these keep a soft shadow the rest of the app never uses. */
.desktop-composer { position: absolute; left: 50%; width: 320px; box-sizing: border-box; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: .5rem; padding: .25rem .3rem .25rem 1rem; border: 1px solid var(--rule); border-radius: 999px; background: var(--bg); color: var(--fg); box-shadow: 0 4px 18px rgb(0 0 0 / .18); transition: border-color .15s }
.desktop-composer:hover, .desktop-composer:focus-within { border-color: var(--muted) }
.desktop-composer input { flex: 1; min-width: 0; padding: .25rem 0; border: 0; outline: none; background: none; color: inherit; font: inherit }
.desktop-composer input::placeholder { color: var(--muted) }
.desktop-composer button { flex: none; width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--tonal); color: var(--fg); transition: background .15s, transform .1s }
.desktop-composer button:hover { background: var(--tonal-strong) }
.desktop-composer button:active { transform: scale(.94) }
.desktop-composer button:disabled { opacity: .45; cursor: default; transform: none; background: var(--tonal) }
@keyframes rise { 0% { transform: translateY(100%) } 72% { transform: translateY(calc(-1 * var(--entrance-overshoot))) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .character.entered { animation-duration: 1ms } }
</style>
