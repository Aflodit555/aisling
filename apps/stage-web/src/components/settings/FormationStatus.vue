<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'
import type { FormationStatus } from '../../runtime/note-formation'

const props = defineProps<{ state: FormationStatus; busy: boolean }>()
defineEmits<{ retry: [id: string, attempt: number] }>()
const failed = computed(() => props.state.batches.filter(batch => batch.status === 'failed' || batch.status === 'retryable' || batch.failure))
const labels: Record<string, string> = {
  collecting: 'Collecting', pending: 'Queued', running: 'Running', retryable: 'Automatic retry queued', failed: 'Failed',
  settling: 'Confirming saved operations', completed: 'Completed', erased: 'Source erased', applied: 'Applied', rejected: 'Rejected',
  reviewRequired: 'Review required', skipped: 'Skipped', outcomeUnknown: 'Outcome unknown',
}
const reasons: Record<string, string> = {
  'not-failed': 'No retry needed.', 'formation-disabled': 'Enable Formation to retry.', 'source-changed': 'Original source is no longer valid.',
  'source-unavailable': 'Source verification is unavailable.', 'saved-operations': 'Saved operations must be confirmed first.',
  'attempt-limit': 'Attempt limit reached.',
}
const errors: Record<string, string> = {
  provider: 'Provider request failed', 'response-parse': 'Response could not be parsed', 'contract-invalid': 'Response contract invalid',
  'semantic-invalid': 'Semantic validation failed', 'source-invalid': 'Source validation failed', persistence: 'Storage operation failed',
  'authorization-rejected': 'Authorization rejected', 'review-required': 'Review required', interrupted: 'Processing interrupted', unknown: 'Unknown failure',
}
</script>

<template>
  <section class="formation-status" aria-labelledby="formation-status-title">
    <h3 id="formation-status-title" class="module-section-title">{{ t('Formation tasks') }}</h3>
    <p class="task-counts" role="status"><span v-for="(count, key) in state.counts" :key="key">{{ t(labels[key] ?? key) }} {{ count }}</span></p>
    <details v-if="state.batches.length">
      <summary>{{ t('Task details') }} · {{ t('Retained failures') }} {{ failed.length }}</summary>
      <p class="task-hint">{{ t('Completed means processing ended; check each operation result.') }}</p>
      <article v-for="batch in state.batches" :key="batch.id" :data-formation-batch="batch.id">
        <div class="task-line">
          <code :title="batch.id">{{ batch.id.slice(0, 8) }}</code>
          <span>{{ t(labels[batch.status] ?? batch.status) }} · {{ t('Attempts') }} {{ batch.attempts }}</span>
          <button v-if="['failed', 'retryable', 'settling'].includes(batch.status)" type="button" class="btn"
            :disabled="busy || !!batch.retryBlocked" @click="$emit('retry', batch.id, batch.attempts)">
            {{ t(batch.status === 'settling' ? 'Confirm saved result' : 'Retry task') }}
          </button>
        </div>
        <p>{{ t('Applied') }} {{ batch.applied }} · {{ t('Rejected') }} {{ batch.rejected }} · {{ t('Review required') }} {{ batch.reviewRequired }} · {{ t('Skipped') }} {{ batch.skipped }} · {{ t('Outcome unknown') }} {{ batch.outcomeUnknown }}</p>
        <p v-if="batch.failure" class="task-error">{{ t(errors[batch.failure.category] ?? 'Unknown failure') }} · <code>{{ batch.failure.code }}</code> · {{ batch.failure.phase }}</p>
        <p v-for="(issue, index) in batch.issues" :key="index">{{ t(errors[issue.category] ?? 'Unknown failure') }} · <code>{{ issue.code }}</code></p>
        <p v-if="batch.retryBlocked && batch.retryBlocked !== 'not-failed'">{{ t(reasons[batch.retryBlocked] ?? 'Task could not be queued.') }}</p>
        <details v-if="batch.history.some(entry => entry.failure || entry.settlementFailures?.length)">
          <summary>{{ t('Failure history') }}</summary>
          <p v-for="entry in batch.history.filter(entry => entry.failure || entry.settlementFailures?.length)" :key="entry.attempt">{{ t('Attempts') }} {{ entry.attempt }} · {{ [entry.failure, ...(entry.settlementFailures ?? [])].filter(Boolean).map(failure => `${failure?.code} (${failure?.phase})`).join(' · ') }}</p>
        </details>
      </article>
    </details>
  </section>
</template>

<style scoped>
.formation-status { margin-top: 1.5rem; color: var(--muted); font-size: .85rem }
.task-counts, .task-line { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .75rem }
.task-line .btn { margin-left: auto; font-size: inherit; padding: .2rem .6rem }
article { border-top: 1px solid var(--rule); padding-block: .6rem; overflow-wrap: anywhere }
article p, .task-hint { margin-block: .35rem }
.task-error { color: var(--danger) }
summary { cursor: pointer }
</style>
