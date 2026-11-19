<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'
import type { FormationStatus } from '../../runtime/note-formation'

const props = defineProps<{ state: FormationStatus; busy: boolean }>()
defineEmits<{ retry: [id: string, attempt: number] }>()
// Main determines source validity and consent; historical/blocked failures are not current alerts.
const recoverable = computed(() => props.state.batches.filter(batch => ['failed', 'settling'].includes(batch.status) && !batch.retryBlocked))
const reasons: Record<string, string> = {
  provider: 'Provider request failed', interrupted: 'Processing interrupted', persistence: 'Storage operation failed',
}
</script>

<template>
  <details v-if="recoverable.length" class="formation-recovery">
    <summary>{{ t('Resume interrupted work') }}</summary>
    <div v-for="batch in recoverable" :key="batch.id" class="recovery-row" :data-formation-batch="batch.id">
      <span>{{ t(batch.status === 'settling' ? 'Check saved result' : reasons[batch.failure?.category ?? ''] ?? 'Memory could not be saved.') }}</span>
      <button type="button" class="btn" :disabled="busy" @click="$emit('retry', batch.id, batch.attempts)">
        {{ t(batch.status === 'settling' ? 'Check saved result' : 'Try again') }}
      </button>
    </div>
  </details>
</template>

<style scoped>
.formation-recovery { margin-top: 1rem; color: var(--muted); font-size: .85rem; }
summary { cursor: pointer; }
.recovery-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 42px; border-top: 1px solid var(--rule); padding-block: .35rem; }
.recovery-row:first-of-type { margin-top: .5rem; }
.recovery-row .btn { flex: none; }
</style>
