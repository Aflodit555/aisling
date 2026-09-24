<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { toggleTheme } from '../theme'

const route = useRoute()
const title = computed(() => {
  if (route.path.startsWith('/settings'))
    return 'Settings'
  if (route.path.startsWith('/devtools'))
    return 'Devtools'
  return 'Stage'
})
</script>

<template>
  <header class="app-header">
    <h1>{{ title }}</h1>
    <nav>
      <RouterLink to="/">Stage</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
      <RouterLink to="/devtools">Devtools</RouterLink>
    </nav>
    <button type="button" class="icon-btn theme-toggle" aria-label="Toggle theme" title="Toggle theme" @click="toggleTheme" />
  </header>
</template>

<style scoped>
.app-header { display: flex; align-items: center; flex: none; height: 56px; padding: 0 1.5rem }
/* Whole-pixel line box: a fractional baseline gets re-snapped when the page fades and the title jumps. */
h1 { font-size: 1.5rem; font-weight: 700; line-height: 24px }
nav { display: flex; gap: .25rem; margin-left: auto }
nav a { display: flex; align-items: center; padding: .5rem 1rem; border-radius: 6px; font-weight: 500; color: var(--muted); transition: background .15s, color .15s, transform .1s }
nav a:hover { color: var(--fg); background: var(--hover) }
nav a:active { transform: scale(.97) }
nav a.router-link-active { color: var(--fg); background: var(--tonal) }
.theme-toggle { margin-left: .75rem; width: 2.25rem; height: 2.25rem }
.theme-toggle::before { content: ''; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--fg); background: var(--toggle-fill); transition: background .15s }
.theme-toggle:hover::before { background: var(--toggle-preview) }
</style>
