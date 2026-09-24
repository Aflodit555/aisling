<script setup lang="ts">
import { storeToRefs } from 'pinia'

import ModuleCard from '../../components/settings/ModuleCard.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { modules } = storeToRefs(settings)
</script>

<template>
  <div class="modules">
    <h2 class="page-title">Modules</h2>
    <p class="page-sub">What Aisling can do, and how each capability is wired.</p>

    <ul class="panel">
      <li v-for="(module, index) in modules" :key="module.kind" :style="{ '--i': index }">
        <ModuleCard :module="module" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.panel { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px }
</style>
