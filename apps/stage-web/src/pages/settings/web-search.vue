<script setup lang="ts">
import WebSearchForm from '../../components/settings/WebSearchForm.vue'
</script>

<template>
  <div class="web-search">
    <h1 class="title">Web Search</h1>
    <p class="subtitle">Give Aisling a tool for looking up current information.</p>

    <WebSearchForm />
  </div>
</template>

<style scoped>
.web-search {
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
