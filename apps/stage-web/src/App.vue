<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'

import { useSettingsStore } from './stores/settings'
import { useStageStore } from './stores/stage'

const settings = useSettingsStore()
const stage = useStageStore()
let autonomousTimer: ReturnType<typeof setInterval> | undefined
const interactionEvents = ['pointerdown', 'keydown', 'input', 'wheel'] as const
function onInteraction(event: Event): void {
  if (event.isTrusted)
    stage.noteHumanInteraction()
}

onMounted(() => {
  // Restore the saved provider config so the Stage is usable after a refresh.
  void settings.load()
  stage.refreshDesktopBridgeStatus()
  autonomousTimer = setInterval(() => {
    stage.refreshDesktopBridgeStatus()
    void stage.tickAutonomous()
  }, 1000)
  for (const event of interactionEvents)
    window.addEventListener(event, onInteraction, { capture: true, passive: true })
})

onUnmounted(() => {
  clearInterval(autonomousTimer)
  stage.setAutonomousEnabled(false)
  for (const event of interactionEvents)
    window.removeEventListener(event, onInteraction, true)
})
</script>

<template>
  <RouterView />
</template>
