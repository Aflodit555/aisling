<script setup lang="ts">
import ConsciousnessForm from '../../components/settings/ConsciousnessForm.vue'
import AutonomousControls from '../../components/AutonomousControls.vue'
</script>

<template>
  <div class="consciousness">
    <h1 class="title">Consciousness</h1>
    <p class="subtitle">Choose which model service Aisling uses to think and reply.</p>

    <ConsciousnessForm />
    <AutonomousControls />
  </div>
</template>

<style scoped>
.consciousness {
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
