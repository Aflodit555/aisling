<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '../../i18n'
import ModuleToggle from '../../components/settings/ModuleToggle.vue'
import EmbeddingForm from '../../components/settings/EmbeddingForm.vue'
import ObsidianMirror from '../../components/settings/ObsidianMirror.vue'
import FormationRecovery from '../../components/settings/FormationRecovery.vue'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'
import { formationFailure } from '../../../../stage-desktop/note-formation-errors.mjs'

const settings = useSettingsStore()
const stage = useStageStore()
const bridge = window.aislingDesktop?.noteReview
const mirror = window.aislingDesktop?.obsidianMirror
type Status = Awaited<ReturnType<NonNullable<typeof bridge>['list']>>
const state = ref<Status>()
const busy = ref(false)
const feedback = ref('')
const error = ref(false)
const visibleReviews = ref(2)
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

async function retry(id: string, attempt: number) {
  if (!bridge || busy.value) return
  busy.value = true
  feedback.value = ''
  try {
    const result = await bridge.retry(id, attempt)
    if (result === 'queued') stage.wakeFormation()
    feedback.value = result === 'queued' ? 'Memory will be processed again.'
      : result === 'completed' ? 'Saved result checked.' : 'Could not resume memory processing.'
  } catch (error) {
    feedback.value = formationFailure(error).code === 'formation-job-limit'
      ? 'Memory processing is unavailable; existing records were kept.' : 'Could not resume memory processing.'
  }
  finally { busy.value = false; await refresh() }
}

const memory = computed(() => settings.config.memory)
const database = computed(() => error.value || state.value?.unavailable ? 'Memory is temporarily unavailable.' : 'Starting')
const proposals = computed(() => state.value?.items.slice(0, visibleReviews.value) ?? [])
watch(() => state.value?.pending, pending => { if (!pending) visibleReviews.value = 2 })

watch(() => memory.value.enabled, enabled => {
  if (enabled) void refresh()
  else { request++; state.value = undefined; error.value = false; feedback.value = ''; visibleReviews.value = 2 }
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
    <ObsidianMirror v-if="mirror" />
    <template v-if="memory.enabled">
      <template v-if="bridge">
        <p v-if="!state?.ready" class="memory-state" role="status">{{ t(database) }}</p>
        <ModuleToggle label="Formation" :enabled="memory.formationEnabled === true"
          :disabled="!state?.ready && memory.formationEnabled !== true"
          :unavailable="state?.ready && !settings.activeChatProvider ? 'Configure the LLM first.' : ''"
          @change="settings.setMemoryFormationEnabled($event)" />
        <ModuleToggle label="Recall" :enabled="memory.noteRecallEnabled === true"
          :disabled="!state?.ready && memory.noteRecallEnabled !== true"
          @change="settings.setNoteRecallEnabled($event)" />

        <EmbeddingForm />

        <p v-if="feedback" class="memory-state" role="status">{{ t(feedback) }}</p>
        <FormationRecovery v-if="state?.formation" :state="state.formation" :busy="busy" @retry="retry" />

        <section v-if="state?.pending" class="review" aria-labelledby="review-title">
          <h3 id="review-title" class="module-section-title">{{ t('Review proposals') }}<span v-if="state"> ({{ state.pending }})</span></h3>
          <article v-for="item in proposals" :key="item.key" :data-review-key="item.key">
            <div class="review-summary">
              <div class="review-description">
                <h4>{{ t(actions[item.action] ?? 'Memory') }}</h4>
                <p class="review-preview">{{ item.content }}</p>
              </div>
              <div class="review-actions">
                <button type="button" class="btn" :disabled="busy" @click="decide(item.key, false)">{{ t('Reject') }}</button>
                <button v-if="item.approvable" type="button" class="btn primary" :disabled="busy" @click="decide(item.key, true)">{{ t('Approve') }}</button>
              </div>
            </div>
            <details class="review-evidence">
              <summary>{{ t('Original evidence') }}</summary>
              <p>{{ item.content }}</p>
              <p class="memory-state">{{ t(kinds[item.kind] ?? 'Memory') }} · {{ t(bases[item.basis] ?? 'Direct evidence') }}</p>
              <p v-if="item.uncertainty"><strong>{{ t('Uncertainty') }}</strong> {{ item.uncertainty }}</p>
              <p v-if="item.target"><strong>{{ t('Existing memory') }}</strong> {{ item.target }}</p>
              <blockquote v-for="(quote, i) in item.quotes" :key="i">{{ quote }}</blockquote>
            </details>
            <p v-if="!item.approvable" class="memory-state">{{ t('This proposal cannot be approved because its identity or evidence could not be verified.') }}</p>
          </article>
          <button v-if="proposals.length < state.items.length" type="button" class="btn review-more"
            @click="visibleReviews += 2">{{ t('Show more proposals') }}</button>
        </section>
      </template>
      <p v-else class="memory-state">{{ t('Desktop database required.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.memory-state { color: var(--muted); }
.review { margin-top: 1.5rem; }
.review article { margin: .75rem 0; padding: .75rem 1rem; border: 1px solid var(--rule); border-radius: 4px; background: var(--surface); overflow-wrap: anywhere; }
.review h4 { margin: 0; font: inherit; color: var(--muted); font-size: .85rem; }
.review p { margin: .45rem 0; }
.review-summary { display: flex; align-items: center; gap: 1rem; }
.review-description { flex: 1; min-width: 0; }
.review-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.review-evidence { color: var(--muted); font-size: .85rem; }
.review-evidence[open] { color: var(--fg); }
.review-evidence p, .review blockquote { white-space: pre-wrap; }
.review summary { cursor: pointer; }
.review blockquote { margin: .5rem 0; padding-inline-start: .75rem; border-inline-start: 2px solid var(--rule); white-space: pre-wrap; }
.review-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: .5rem; }
.review-actions .btn { min-height: 42px; }
@media (max-width: 600px) { .review-summary { flex-wrap: wrap; } .review-actions { margin-left: auto; } }
</style>
