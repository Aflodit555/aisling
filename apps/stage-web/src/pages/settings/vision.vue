<script setup lang="ts">
import { t } from '../../i18n'
import VisionForm from '../../components/settings/VisionForm.vue'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
const settings = useSettingsStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Vision') }}</h2>
    <p class="page-sub">{{ t('Understand images and screenshots.') }}</p>
    <ModuleToggle label="Enable vision" :enabled="settings.config.vision.enabled" :disabled="settings.moduleBusy.vision" :status="settings.moduleError.vision" @change="settings.setModuleEnabled('vision', $event)" />

    <VisionForm />
  </div>
</template>
