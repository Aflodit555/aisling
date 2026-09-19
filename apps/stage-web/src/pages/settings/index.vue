<script setup lang="ts">
import { storeToRefs } from 'pinia'

import ModuleCard from '../../components/settings/ModuleCard.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { modules } = storeToRefs(settings)
</script>

<template>
  <div class="modules">
    <h1 class="title">Modules</h1>
    <p class="subtitle">What Aisling can do, and how each capability is wired.</p>

    <div class="grid">
      <ModuleCard v-for="module in modules" :key="module.kind" :module="module" />
    </div>
  </div>
</template>

<style scoped>
.modules {
  max-width: 720px;
}

.title {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  color: #efeaf8;
}

.subtitle {
  margin: 6px 0 22px;
  font-size: 14px;
  color: #9d94b8;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
</style>
