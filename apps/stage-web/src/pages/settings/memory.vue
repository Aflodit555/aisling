<script setup lang="ts">
import { t } from '../../i18n'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Memory') }}</h2>
    <p class="page-sub">{{ t('Recall relevant information from previous conversations.') }}</p>
    <ModuleToggle label="Memory" :enabled="settings.config.memory.enabled" @change="settings.setMemoryEnabled($event)" />
    <template v-if="settings.config.memory.enabled">
      <ModuleToggle label="Reflection Formation" :enabled="settings.config.memory.formationEnabled === true" @change="settings.setMemoryFormationEnabled($event)" />
      <p>{{ t('Form structured reflections from new interactions in the background. May make additional LLM requests.') }}</p>
    </template>
  </div>
</template>
