<script setup lang="ts">
import { t } from '../../i18n'

defineProps<{ label: string, enabled: boolean, unavailable?: string, status?: string }>()
const emit = defineEmits<{ change: [enabled: boolean] }>()
</script>

<template>
  <div class="module-toggle">
    <label class="toggle-line">
      <span>{{ t(label) }}</span>
      <input type="checkbox" role="switch" :checked="enabled" :disabled="Boolean(unavailable) && !enabled" @change="emit('change', ($event.target as HTMLInputElement).checked)">
    </label>
    <p v-if="unavailable && !enabled" class="toggle-note">{{ t(unavailable) }}</p>
    <p v-else-if="status" class="toggle-note">{{ t(status) }}</p>
  </div>
</template>
