<script setup lang="ts">
import { t } from '../../i18n'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'
import { computed } from 'vue'

const settings = useSettingsStore()
const stage=useStageStore()
const unavailable=computed(()=>!window.aislingDesktop?.memoryOrganization?'Desktop database required.':!settings.activeChatProvider?'Configure the LLM first.':'')
const status=computed(()=>!settings.config.memory.organizationEnabled?'Disabled':!stage.organizationStatus.ready?
  (stage.organizationStatus.reason==='starting'?'Starting':'Processing failed'):
  ['provider-error','invalid-output','source-changed','storage-error','storage-or-input-error'].includes(stage.formationStatus.lastEvent)?'Processing failed':
  stage.formationStatus.running?'Running':stage.organizationStatus.pending?'Review candidates available':'Write limited')
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Memory') }}</h2>
    <p class="page-sub">{{ t('Recall relevant information from previous conversations.') }}</p>
    <ModuleToggle label="Memory" :enabled="settings.config.memory.enabled" @change="settings.setMemoryEnabled($event)" />
    <p v-if="stage.organizationStatus.reason === 'erasure-failed'">{{ t('Memory cleanup failed. Derived memories remain blocked until cleanup succeeds.') }}</p>
    <template v-if="settings.config.memory.enabled">
      <ModuleToggle label="Reflection Formation" :enabled="settings.config.memory.formationEnabled === true" @change="settings.setMemoryFormationEnabled($event)" />
      <p>{{ t('Form structured reflections from new interactions in the background. May make additional LLM requests.') }}</p>
      <ModuleToggle label="Memory Organization" :enabled="settings.config.memory.organizationEnabled === true" :unavailable="unavailable" :status="status" @change="settings.setMemoryOrganizationEnabled($event)" />
      <p>{{ t('Organize memories in the background with one call instead of Reflection Formation. High-risk changes require review.') }}</p>
      <p>{{ t('Eligible new memories and evidence may be saved automatically; changes, replacements and retractions still require review.') }}</p>
    </template>
  </div>
</template>
