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
  <article class="card">
    <div class="head">
      <h2 class="name">{{ module.name }}</h2>
      <StatusBadge :status="module.status" />
    </div>
    <p class="category">{{ module.category }}</p>
    <p class="description">{{ module.description }}</p>

    <div class="foot">
      <RouterLink v-if="configurable" class="configure" :to="link">Configure</RouterLink>
      <span v-else class="muted">No provider yet</span>
      <span v-if="module.providerId" class="provider">via {{ module.providerId }}</span>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(13, 11, 22, 0.55);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.name {
  margin: 0;
  font-size: 17px;
  font-weight: 500;
  color: #efeaf8;
}

.category {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #6f6889;
}

.description {
  margin: 0;
  font-size: 14px;
  color: #9d94b8;
  line-height: 1.5;
}

.foot {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 4px;
}

.configure {
  font-size: 13px;
  color: #c9b8f2;
  text-decoration: none;
}

.configure:hover {
  color: #e6e0f4;
}

.muted {
  font-size: 13px;
  color: #5f5878;
}

.provider {
  font-size: 12px;
  color: #6f6889;
}
</style>
