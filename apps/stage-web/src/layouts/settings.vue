<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'

import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const { modules } = storeToRefs(useSettingsStore())
const pages = computed(() => modules.value.filter(module => router.hasRoute(`settings-${module.kind}`)))
</script>

<template>
  <div class="settings">
    <aside>
      <RouterLink to="/settings">Overview</RouterLink>
      <RouterLink v-for="module in pages" :key="module.kind" :to="`/settings/${module.kind}`">{{ module.name }}</RouterLink>
    </aside>
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
/* scroll-padding: focus and scrollIntoView stop below the pinned page title. */
.settings { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; scroll-padding-top: 3rem; display: grid; grid-template-columns: 13rem minmax(0, 40rem); gap: 2rem; align-content: start; padding: 0 1.5rem 1.5rem }
/* align-self start: a stretched grid item has no room to stick. */
aside { position: sticky; top: 0; align-self: start; display: flex; flex-direction: column; gap: .25rem }
/* Negative scroll-margin cancels the title padding: the pinned aside is always in view, so focusing a link must not scroll the form. */
aside a { scroll-margin-top: -3rem; display: flex; align-items: center; gap: .75rem; padding: .5rem 1rem; border-radius: 6px; font-weight: 500; color: var(--muted); white-space: nowrap; transition: background .15s, color .15s, transform .1s }
aside a:hover { color: var(--fg); background: var(--hover) }
aside a:active { transform: scale(.97) }
/* Inset ring: the aside touches the scroll box's top edge, which would clip an outer ring. */
aside a:focus-visible { outline-offset: -2px }
aside a.router-link-exact-active { color: var(--fg); background: var(--tonal) }
aside a::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; transition: background .15s }
aside a.router-link-exact-active::before { background: currentColor }
/* Page titles stay pinned while a long form scrolls under them, as in Epiphany's settings. */
.settings :deep(.page-title) { position: sticky; top: 0; z-index: 1; background: var(--bg); padding-bottom: .25rem }
</style>
