<script setup lang="ts">
import type { CapabilityModule } from '@aisling/core'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ module: CapabilityModule }>()

const link = computed(() => {
  if (props.module.kind === 'consciousness')
    return '/settings/consciousness'
  if (props.module.kind === 'speech')
    return '/settings/speech'
  if (props.module.kind === 'hearing')
    return '/settings/hearing'
  if (props.module.kind === 'vision')
    return '/settings/vision'
  if (props.module.kind === 'web-search')
    return '/settings/web-search'
  if (props.module.kind === 'desktop-awareness')
    return '/settings/desktop-awareness'
  return ''
})

const configurable = computed(() => link.value !== '')
</script>

<template>
  <component :is="configurable ? RouterLink : 'div'" class="module" :to="configurable ? link : undefined">
    <div class="text">
      <div><h3 class="name">{{ module.name }}</h3><span class="category">{{ module.category }}</span></div>
      <p class="description">{{ module.description }}</p>
    </div>
    <div class="meta">
      <StatusBadge :status="module.status" />
      <span v-if="module.providerId" class="provider">via {{ module.providerId }}</span>
    </div>
  </component>
</template>

<style scoped>
.module { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; min-height: 3.25rem; padding: .75rem 1rem .75rem 1.25rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; animation: rise .3s var(--ease) both; animation-delay: calc(var(--i, 0) * 25ms); transition: background .15s }
a.module:hover { background: var(--hover) }
.text { min-width: 0 }
.name { display: inline; font-size: 1em; font-weight: 500 }
.category { margin-left: .5rem; color: var(--muted); font-size: .75rem }
.description { color: var(--muted); font-size: .85rem }
.meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: .1rem }
.provider { color: var(--muted); font-size: .85rem }
</style>
