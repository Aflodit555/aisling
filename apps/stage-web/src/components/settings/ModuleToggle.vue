<script setup lang="ts">
import { t } from '../../i18n'
import { ref } from 'vue'

const props = defineProps<{ label: string, enabled: boolean, unavailable?: string, status?: string, disabled?: boolean }>()
const emit = defineEmits<{ change: [enabled: boolean] }>()
const attempted = ref(false)
function change(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.checked
  input.checked = props.enabled
  attempted.value = next
  if (next && props.unavailable && !props.enabled) return
  emit('change', next)
}
</script>

<template>
  <div class="module-toggle">
    <label class="toggle-line">
      <span>{{ t(label) }}</span>
      <input type="checkbox" role="switch" :checked="enabled" :disabled="disabled" @change="change">
    </label>
    <p v-if="status || (attempted && unavailable && !enabled)" class="toggle-note" role="status">{{ t(status || unavailable || '') }}</p>
  </div>
</template>
