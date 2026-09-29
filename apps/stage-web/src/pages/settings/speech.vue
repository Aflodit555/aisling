<script setup lang="ts">
import { t } from '../../i18n'
import SpeechForm from '../../components/settings/SpeechForm.vue'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
const settings = useSettingsStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Speech') }}</h2>
    <p class="page-sub">{{ t('Choose Aisling’s voice.') }}</p>
    <h3 class="module-section-title">{{ t('Voice output') }}</h3>
    <ModuleToggle label="Enable voice output" :enabled="settings.config.speech.enabled" :unavailable="settings.speechReady ? undefined : settings.config.speech.providerType === 'browser' ? 'System speech is unavailable here.' : 'Save a working provider configuration before enabling.'" @change="settings.setModuleEnabled('speech', $event)" />

    <SpeechForm />
  </div>
</template>
