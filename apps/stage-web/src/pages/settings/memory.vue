<script setup lang="ts">
import { t } from '../../i18n'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Memory') }}</h2>
    <p class="page-sub">{{ t('Recall earlier conversations when you ask about them.') }}</p>
    <ModuleToggle label="Enable cross-session recall" :enabled="settings.config.memory.enabled" @change="settings.setMemoryEnabled($event)" />
    <p>{{ t('Off by default. When enabled, relevant excerpts from older local conversations may be sent to your selected LLM Provider with your text messages. Your choice is saved on this device.') }}</p>
    <p>{{ t('Recall can miss details or make mistakes. Turning it off stops recall on new text turns; it does not erase conversation history or retract requests already sent.') }}</p>
  </div>
</template>
