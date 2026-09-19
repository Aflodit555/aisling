<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'

import { useSettingsStore } from './stores/settings'

const settings = useSettingsStore()

onMounted(() => {
  // Restore the saved provider config so the Stage is usable after a refresh.
  void settings.load()
})
</script>

<template>
  <RouterView />
</template>
