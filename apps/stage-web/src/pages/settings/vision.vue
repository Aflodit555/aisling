<script setup lang="ts">
import VisionForm from '../../components/settings/VisionForm.vue'
</script>

<template>
  <div class="vision">
    <h1 class="title">Vision</h1>
    <p class="subtitle">Choose how Aisling sees images.</p>

    <VisionForm />
  </div>
</template>

<style scoped>
.vision {
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
