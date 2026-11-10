<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '../../i18n'

type Bridge = NonNullable<NonNullable<Window['aislingDesktop']>['memoryMigration']>
const props = defineProps<{ bridge: Bridge }>()
const emit = defineEmits<{ frozen: [value: boolean] }>()
const state = ref<MemoryMigrationStatus>()
const inventory = ref<Awaited<ReturnType<Bridge['preflight']>>>()
const working = ref(false)
const unavailable = ref(false)
const decisionFailed = ref(false)
const resumable = computed(() => state.value?.total !== undefined && state.value.phase !== 'committed')
watch(() => state.value?.busy === true || state.value?.phase === 'committed' || resumable.value, value => emit('frozen', value))

async function refresh() {
  try { state.value = await props.bridge.status() }
  catch { unavailable.value = true }
}

async function preflight() {
  working.value = true
  unavailable.value = false
  decisionFailed.value = false
  inventory.value = undefined
  try { inventory.value = await props.bridge.preflight() }
  catch { unavailable.value = true }
  finally { working.value = false }
}

async function exclude(key: string) {
  const version = inventory.value?.version
  if (!version) return
  working.value = true
  decisionFailed.value = false
  try {
    if (await props.bridge.exclude(key, version) === 'excluded') await preflight()
  } catch {
    inventory.value = undefined
    decisionFailed.value = true
  } finally { working.value = false }
}

async function execute() {
  working.value = true
  unavailable.value = false
  try {
    state.value = await props.bridge.execute()
    if (state.value.phase === 'blocked') inventory.value = undefined
  } catch { unavailable.value = true }
  finally { working.value = false }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refresh()
  timer = setInterval(() => { if (working.value || resumable.value) void refresh() }, 1000)
})
onUnmounted(() => clearInterval(timer))

const reasons: Record<string, string> = {
  'cleanup-pending': 'A source deletion is still being processed.',
  'source-missing': 'An original message is missing.',
  'source-changed': 'An original message no longer matches.',
  'source-blocked': 'A source was previously deleted.',
  'identity-uncertain': 'The subject could not be confirmed.',
  'insufficient-support': 'There is insufficient original support.',
  'unproven-history': 'An operation or revision could not be verified.',
  'unproven-context': 'The original inputs to a memory could not be verified.',
  'unproven-kind': 'The memory type could not be verified.',
  'unproven-time': 'The recorded event time could not be verified.',
  'invalid-meaning': 'A memory does not meet the current format.',
  'unsupported-history': 'A previous proposal still requires attention.',
  'disposition-changed': 'A record kept in history has changed and needs verification.',
}
const categories = [
  { title: 'Source integrity', codes: ['source-missing', 'source-changed', 'source-blocked'] },
  { title: 'Memory eligibility', codes: ['identity-uncertain', 'insufficient-support', 'unproven-kind', 'unproven-time', 'invalid-meaning'] },
  { title: 'Historical dependencies', codes: ['unproven-history', 'unproven-context', 'disposition-changed'] },
  { title: 'Pending operations', codes: ['cleanup-pending', 'unsupported-history'] },
]
const issues = computed(() => categories.map(({ title, codes }) => ({
  title, reasons: inventory.value?.reasons.filter(reason => codes.includes(reason.code)) ?? [],
})).filter(group => group.reasons.length))
</script>

<template>
  <section class="migration" aria-labelledby="migration-title">
    <h3 id="migration-title" class="module-section-title">{{ t('Memory upgrade') }}</h3>
    <p>{{ t('This profile uses the previous memory format.') }}</p>
    <p v-if="decisionFailed" role="alert">{{ t('The record changed or could not be verified. Check previous memories again.') }}</p>
    <p v-if="unavailable" role="alert">{{ t('Could not inspect previous memories. You can retry the check.') }}</p>
    <p v-else-if="state?.phase === 'committed'" role="status">{{ t('Memory upgrade verified. Restarting…') }}</p>
    <p v-else-if="state?.phase === 'blocked'" role="alert">
      {{ t(resumable ? 'The upgrade paused. Writes remain paused until verification succeeds.' : 'The upgrade stopped. Check your memories again before retrying.') }}
    </p>
    <p v-else-if="state?.phase === 'validating' || state?.phase === 'validated'" role="status">{{ t('Verifying saved memories…') }}</p>
    <p v-else-if="resumable" role="status">{{ t('The upgrade can resume. Memory writes are paused.') }}</p>
    <p v-if="state?.total !== undefined && state.phase !== 'committed'" role="status">
      {{ t('Memories saved for verification') }} {{ state.done }} / {{ state.total }}
    </p>
    <template v-if="inventory">
      <dl class="inventory">
        <dt>{{ t('Existing notes ready') }}</dt><dd>{{ inventory.notes }}</dd>
        <dt>{{ t('Other memories ready') }}</dt><dd>{{ inventory.reflections }}</dd>
        <dt>{{ t('Confirmed duplicates') }}</dt><dd>{{ inventory.duplicates }}</dd>
        <dt>{{ t('Require review') }}</dt><dd>{{ inventory.review + inventory.historyIssues }}</dd>
        <dt>{{ t('Unavailable memories') }}</dt><dd>{{ inventory.unavailable }}</dd>
        <dt v-if="inventory.excluded">{{ t('Kept in history only') }}</dt><dd v-if="inventory.excluded">{{ inventory.excluded }}</dd>
        <dt>{{ t('Historical records checked') }}</dt><dd>{{ inventory.history + inventory.revisions + inventory.receipts }}</dd>
      </dl>
      <p v-if="!inventory.canMigrate" role="status">{{ t('Resolve these issues before upgrading.') }}</p>
      <div v-for="group in issues" :key="group.title" class="issue-group">
        <strong>{{ t(group.title) }}</strong>
        <ul>
          <li v-for="issue in group.reasons" :key="issue.code">
            {{ t(reasons[issue.code] ?? 'Some previous records require attention.') }} ({{ issue.count }})
          </li>
        </ul>
      </div>
      <article v-for="item in inventory.choices" :key="item.key" class="disposition">
        <p>{{ item.label }}</p>
        <p class="issue-caption">{{ t(reasons[item.code] ?? 'Some previous records require attention.') }}</p>
        <button type="button" :disabled="working || state?.busy || resumable" @click="exclude(item.key)">{{ t('Keep in history only') }}</button>
      </article>
    </template>
    <div class="migration-actions">
      <button type="button" :disabled="working || state?.busy || state?.phase === 'committed'" @click="preflight">
        {{ t('Check previous memories') }}
      </button>
      <button v-if="(inventory?.canMigrate || resumable) && state?.phase !== 'committed'" type="button"
        :disabled="working || state?.busy" @click="execute">{{ t(resumable ? 'Resume upgrade' : 'Review and upgrade') }}</button>
    </div>
  </section>
</template>

<style scoped>
.migration { margin: .75rem 0; padding: .75rem 1rem; border: 1px solid var(--rule); border-radius: 4px; background: var(--surface); }
.migration p { margin: .45rem 0; }
.inventory { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .3rem .6rem; }
.inventory dd { margin: 0; }
.issue-group ul { margin: .25rem 0 .5rem; padding-inline-start: 1.2rem; }
.disposition { padding: .55rem 0; border-top: 1px solid var(--rule); overflow-wrap: anywhere; }
.issue-caption { color: var(--muted); }
.migration-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .75rem; }
</style>
