<script setup lang="ts">
import type { CapabilityStatus } from '@aisling/core'
import { computed } from 'vue'

const props = defineProps<{ status: CapabilityStatus }>()

const label = computed(() => {
  if (props.status === 'ready')
    return 'Ready'
  if (props.status === 'not-configured')
    return 'Not configured'
  return 'Not available yet'
})
</script>

<template>
  <span class="badge" :class="`is-${status}`">{{ label }}</span>
</template>

<style scoped>
.badge { display: inline-flex; align-items: center; gap: .4rem; font-size: .85rem; color: var(--muted); white-space: nowrap }
.badge::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor }
.is-ready { color: var(--fg) }
.is-ready::before { background: currentColor }
.is-not-available { opacity: .6 }
</style>
