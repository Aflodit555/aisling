<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '../../i18n'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import MemoryMigration from '../../components/settings/MemoryMigration.vue'
import LegacyMemoryControls from '../../components/settings/LegacyMemoryControls.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const bridge = window.aislingDesktop?.noteReview
const legacy = !!window.aislingDesktop?.memoryOrganization
const migration = window.aislingDesktop?.memoryMigration
const migrationFrozen = ref(false)
type Status = Awaited<ReturnType<NonNullable<typeof bridge>['list']>>
const state = ref<Status>()
const busy = ref(false)
const feedback = ref('')
const error = ref(false)
let request = 0
let checking = false

async function refresh() {
  if (!bridge || !settings.config.memory.enabled || checking) return
  const ticket = ++request
  checking = true
  try {
    const snapshot = await bridge.list()
    if (ticket === request) { state.value = snapshot; error.value = false }
  } catch {
    if (ticket === request) { state.value = undefined; error.value = true }
  } finally { checking = false }
}

async function decide(key: string, approved: boolean) {
  if (!bridge || busy.value) return
  busy.value = true
  feedback.value = ''
  try {
    const result = await bridge.decide(key, approved)
    feedback.value = result === 'applied' ? 'Memory saved.' : result === 'rejected'
      ? (approved ? 'The proposal could no longer be applied.' : 'Proposal rejected.')
      : result === 'outcome-unknown' ? 'Waiting to confirm the saved result.'
        : result === 'cancelled' || result === 'busy' ? '' : 'The proposal could no longer be applied.'
  } catch { feedback.value = 'The proposal could no longer be applied.' }
  finally { busy.value = false; await refresh() }
}

const memory = computed(() => settings.config.memory)
const database = computed(() => state.value?.ready ? 'Ready' : error.value ? 'Memory database unavailable.' : 'Starting')

watch(() => memory.value.enabled, enabled => {
  if (enabled) void refresh()
  else { request++; state.value = undefined; error.value = false; feedback.value = '' }
})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (!bridge) return
  void refresh()
  timer = setInterval(() => { if (!busy.value) void refresh() }, 3000)
})
onUnmounted(() => { request++; clearInterval(timer) })

const actions: Record<string, string> = {
  ADD: 'Add memory', UPDATE: 'Revise memory', NOOP: 'Add evidence', SUPERSEDE: 'Replace memory', RETRACT: 'Retract memory',
}
const kinds: Record<string, string> = {
  event: 'Event', fact: 'Fact', pattern: 'Pattern', preference: 'Preference',
  'project-state': 'Project state', 'open-question': 'Open question',
}
const bases: Record<string, string> = { direct: 'Direct evidence', inferred: 'Inference', mixed: 'Mixed evidence' }
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Memory') }}</h2>
    <p class="page-sub">{{ t('Memory includes relevant excerpts from earlier conversations.') }}</p>
    <ModuleToggle label="Memory" :enabled="memory.enabled" @change="settings.setMemoryEnabled($event)" />
    <MemoryMigration v-if="migration" :bridge="migration" @frozen="migrationFrozen = $event" />
    <p v-else-if="legacy" class="memory-state" role="status">{{ t('This profile uses the previous memory format.') }}</p>
    <LegacyMemoryControls v-if="legacy && !migrationFrozen" />
    <template v-if="memory.enabled">
      <template v-if="bridge">
        <p v-if="!state?.ready" class="memory-state" role="status">{{ t(database) }}</p>
        <ModuleToggle label="Formation" :enabled="memory.formationEnabled === true"
          :disabled="!state?.ready && memory.formationEnabled !== true"
          :unavailable="state?.ready && !settings.activeChatProvider ? 'Configure the LLM first.' : ''"
          :status="!state?.ready ? '' : state.forming ? 'Running' : state.failed ? 'Processing failed'
            : 'Uses your model in the background to propose memories.'"
          @change="settings.setMemoryFormationEnabled($event)" />
        <ModuleToggle label="Recall" :enabled="memory.noteRecallEnabled === true"
          :disabled="!state?.ready && memory.noteRecallEnabled !== true"
          status="Uses approved memories when relevant." @change="settings.setNoteRecallEnabled($event)" />

        <section class="review" aria-labelledby="review-title">
          <h3 id="review-title" class="module-section-title">{{ t('Review proposals') }}<span v-if="state"> ({{ state.pending }})</span></h3>
          <p v-if="feedback" role="status">{{ t(feedback) }}</p>
          <p v-if="state?.pending === 0" class="memory-state">{{ t('No proposals to review.') }}</p>
          <article v-for="item in state?.items" :key="item.key">
            <h4>{{ t(actions[item.action] ?? 'Memory') }}</h4>
            <p>{{ item.content }}</p>
            <p class="memory-state">{{ t(kinds[item.kind] ?? 'Memory') }} · {{ t(bases[item.basis] ?? 'Direct evidence') }}</p>
            <p v-if="item.uncertainty"><strong>{{ t('Uncertainty') }}</strong> {{ item.uncertainty }}</p>
            <p v-if="item.target"><strong>{{ t('Existing memory') }}</strong> {{ item.target }}</p>
            <details>
              <summary>{{ t('Original evidence') }}</summary>
              <blockquote v-for="(quote, i) in item.quotes" :key="i">{{ quote }}</blockquote>
            </details>
            <p v-if="!item.approvable" class="memory-state">{{ t('This proposal cannot be approved because its identity or evidence could not be verified.') }}</p>
            <div class="review-actions">
              <button type="button" :disabled="busy" @click="decide(item.key, false)">{{ t('Reject') }}</button>
              <button v-if="item.approvable" type="button" :disabled="busy" @click="decide(item.key, true)">{{ t('Approve') }}</button>
            </div>
          </article>
        </section>
      </template>
      <p v-else-if="!legacy" class="memory-state">{{ t('Desktop database required.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.memory-state { color: var(--muted); }
.review { margin-top: 1.5rem; }
.review article { margin: .75rem 0; padding: .75rem 1rem; border: 1px solid var(--rule); border-radius: 4px; background: var(--surface); overflow-wrap: anywhere; }
.review h4 { margin: 0; }
.review p { margin: .45rem 0; }
.review blockquote { margin: .5rem 0; padding-inline-start: .75rem; border-inline-start: 2px solid var(--rule); white-space: pre-wrap; }
.review-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: .5rem; margin-top: .75rem; }
</style>
