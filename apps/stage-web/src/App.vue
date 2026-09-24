<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView } from 'vue-router'

import { useSettingsStore } from './stores/settings'
import { DESKTOP_POLL_MS } from './runtime/autonomous'
import { useStageStore } from './stores/stage'
import DesktopSurface from './components/DesktopSurface.vue'

const settings = useSettingsStore()
const stage = useStageStore()
const mode = ref<'stage' | 'desktop'>('stage')
let stopModeListener: (() => void) | undefined
watch(mode, next => document.body.classList.toggle('desktop-mode', next === 'desktop'), { immediate: true })
let autonomousTimer: ReturnType<typeof setInterval> | undefined
const stopAwarenessWatch = watch(() => stage.autonomous.enabled, (enabled) => {
  clearInterval(autonomousTimer)
  autonomousTimer = enabled ? setInterval(() => void stage.tickAutonomous(), DESKTOP_POLL_MS) : undefined
}, { flush: 'sync' })
const interactionEvents = ['pointerdown', 'keydown', 'input', 'wheel'] as const
function onInteraction(event: Event): void {
  if (event.isTrusted)
    stage.noteHumanInteraction()
}

onMounted(async () => {
  if (window.aislingDesktop?.getMode) {
    stopModeListener = window.aislingDesktop.onModeChange(next => { mode.value = next })
    mode.value = await window.aislingDesktop.getMode()
  }
  // Restore the saved provider config so the Stage is usable after a refresh.
  await settings.load()
  stage.refreshDesktopBridgeStatus()
  await stage.restoreDesktopAwareness()
  for (const event of interactionEvents)
    window.addEventListener(event, onInteraction, { capture: true, passive: true })
})

onUnmounted(() => {
  document.body.classList.remove('desktop-mode')
  stopModeListener?.()
  clearInterval(autonomousTimer)
  stopAwarenessWatch()
  void stage.setDesktopAwarenessEnabled(false, false)
  for (const event of interactionEvents)
    window.removeEventListener(event, onInteraction, true)
})
</script>

<template>
  <DesktopSurface v-if="mode === 'desktop'" />
  <RouterView v-else />
</template>
