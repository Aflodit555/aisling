<script setup lang="ts">
import { t } from '../../i18n'
import DesktopAwarenessForm from '../../components/settings/DesktopAwarenessForm.vue'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'
const settings = useSettingsStore()
const stage = useStageStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Desktop Awareness') }}</h2>
    <p class="page-sub">{{ t('Observe desktop activity and react when appropriate.') }}</p>
    <ModuleToggle label="Enable desktop awareness" :enabled="settings.config.desktopAwareness.enabled && stage.autonomous.enabled" :unavailable="!stage.desktopAvailable ? 'Desktop Awareness is available in the Electron app only.' : !settings.config.desktopAwareness.jevApiKey.trim() ? 'Configure the API key before enabling.' : !settings.activeChatProvider ? 'Configure Consciousness before enabling.' : undefined" :status="stage.desktopBridgeState === 'connected' ? 'Desktop bridge connected.' : undefined" @change="stage.setDesktopAwarenessEnabled($event)" />
    <DesktopAwarenessForm />
  </div>
</template>
