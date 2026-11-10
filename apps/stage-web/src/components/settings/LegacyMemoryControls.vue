<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'
import ModuleToggle from './ModuleToggle.vue'

const settings = useSettingsStore()
const stage = useStageStore()
const memory = computed(() => settings.config.memory)

async function setFormation(enabled: boolean) {
  if (!enabled && memory.value.organizationEnabled) await settings.setMemoryOrganizationEnabled(false)
  await settings.setMemoryFormationEnabled(enabled)
}
</script>

<template>
  <p v-if="stage.organizationStatus.reason === 'erasure-failed'" role="alert">
    {{ t('Memory cleanup failed. Derived memories remain blocked until cleanup succeeds.') }}
  </p>
  <template v-if="memory.enabled">
    <ModuleToggle label="Formation" :enabled="memory.organizationEnabled || memory.formationEnabled === true"
      :status="stage.formationStatus.running ? 'Running' : 'Uses your model in the background.'" @change="setFormation($event)" />
    <ModuleToggle label="Recall" :enabled="memory.noteRecallEnabled === true"
      status="Controls saved notes in this profile." @change="settings.setNoteRecallEnabled($event)" />
  </template>
</template>
