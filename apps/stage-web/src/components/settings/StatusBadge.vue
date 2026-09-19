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
.badge {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  letter-spacing: 0.02em;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.is-ready {
  color: #a7e6b4;
  background: rgba(74, 222, 128, 0.1);
  border-color: rgba(74, 222, 128, 0.25);
}

.is-not-configured {
  color: #f0cf8a;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.25);
}

.is-not-available {
  color: #8f87ad;
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}
</style>
