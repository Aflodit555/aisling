<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="settings-shell">
    <header class="chrome">
      <RouterLink class="back" to="/">← Stage</RouterLink>
      <span class="brand">Settings</span>
    </header>
    <main class="body">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.settings-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.chrome {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.back {
  font-size: 13px;
  color: #8f87ad;
  text-decoration: none;
}

.back:hover {
  color: #cfc6ea;
}

.brand {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #cfc6ea;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 28px;
}
</style>
