<script setup lang="ts">
import { t } from '../../i18n'
import WebSearchForm from '../../components/settings/WebSearchForm.vue'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
const settings = useSettingsStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Web Search') }}</h2>
    <p class="page-sub">{{ t('Look up current information when needed.') }}</p>
    <ModuleToggle label="Enable web search" :enabled="settings.config.webSearch.enabled" :disabled="settings.moduleBusy.webSearch" :status="settings.moduleError.webSearch" @change="settings.setModuleEnabled('webSearch', $event)" />

    <WebSearchForm />
  </div>
</template>
