<script setup lang="ts">
import SpeechForm from '../../components/settings/SpeechForm.vue'
</script>

<template>
  <div class="speech">
    <h1 class="title">Speech</h1>
    <p class="subtitle">Choose how Aisling speaks out loud.</p>

    <SpeechForm />
  </div>
</template>

<style scoped>
.speech {
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
