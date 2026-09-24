<script setup lang="ts">
import AutonomousControls from '../../components/AutonomousControls.vue'
import DesktopAwarenessForm from '../../components/settings/DesktopAwarenessForm.vue'
</script>

<template>
  <div class="desktop-awareness-page">
    <h2 class="page-title">Desktop Awareness</h2>
    <p class="page-sub">Configure how Aisling observes the desktop and decides whether something is worth commenting on.</p>

    <DesktopAwarenessForm />
    <AutonomousControls />
  </div>
</template>
