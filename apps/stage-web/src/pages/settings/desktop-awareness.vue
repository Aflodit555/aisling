<script setup lang="ts">
import AutonomousControls from '../../components/AutonomousControls.vue'
import DesktopAwarenessForm from '../../components/settings/DesktopAwarenessForm.vue'
</script>

<template>
  <div class="desktop-awareness-page">
    <h1 class="title">Desktop Awareness</h1>
    <p class="subtitle">Configure how Aisling observes the desktop and decides whether something is worth commenting on.</p>

    <DesktopAwarenessForm />
    <AutonomousControls />
  </div>
</template>

<style scoped>
.desktop-awareness-page {
  max-width: 560px;
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
</style>
