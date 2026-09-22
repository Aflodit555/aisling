<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterView } from 'vue-router'

import { useSettingsStore } from './stores/settings'
import { DESKTOP_POLL_MS } from './runtime/autonomous'
import { useStageStore } from './stores/stage'

const settings = useSettingsStore()
const stage = useStageStore()
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
  // Restore the saved provider config so the Stage is usable after a refresh.
  await settings.load()
  stage.refreshDesktopBridgeStatus()
  await stage.restoreDesktopAwareness()
  for (const event of interactionEvents)
    window.addEventListener(event, onInteraction, { capture: true, passive: true })
})

onUnmounted(() => {
  clearInterval(autonomousTimer)
  stopAwarenessWatch()
  void stage.setDesktopAwarenessEnabled(false, false)
  for (const event of interactionEvents)
    window.removeEventListener(event, onInteraction, true)
})
</script>

<template>
  <RouterView />
</template>
