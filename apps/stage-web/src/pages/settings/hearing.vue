<script setup lang="ts">
import HearingForm from '../../components/settings/HearingForm.vue'
</script>

<template>
  <div class="hearing">
    <h1 class="title">Hearing</h1>
    <p class="subtitle">Choose how Aisling listens to you.</p>

    <HearingForm />
  </div>
</template>

<style scoped>
.hearing {
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
