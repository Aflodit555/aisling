<script setup lang="ts">
import { t } from '../../i18n'
import DesktopAwarenessForm from '../../components/settings/DesktopAwarenessForm.vue'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'
const settings = useSettingsStore()
const stage = useStageStore()
async function toggle(enabled: boolean) {
  settings.activationRequested.desktopAwareness = enabled
  settings.moduleError.desktopAwareness = ''
  settings.moduleBusy.desktopAwareness = true
  try {
    await stage.setDesktopAwarenessEnabled(enabled)
    if (stage.autonomous.enabled === enabled) settings.activationRequested.desktopAwareness = false
    else settings.moduleError.desktopAwareness = stage.autonomous.error || 'Could not start module.'
  } catch (error) {
    settings.moduleError.desktopAwareness = error instanceof Error && error.message === 'Could not save settings.' ? error.message : 'Could not start module.'
  } finally { settings.moduleBusy.desktopAwareness = false }
}
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Desktop Awareness') }}</h2>
    <p class="page-sub">{{ t('Observe desktop activity and react when appropriate.') }}</p>
    <ModuleToggle label="Enable desktop awareness" :enabled="stage.autonomous.enabled" :disabled="settings.moduleBusy.desktopAwareness" :status="settings.moduleError.desktopAwareness" @change="toggle" />
    <DesktopAwarenessForm />
  </div>
</template>
