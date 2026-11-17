<script setup lang="ts">
import { t } from '../../i18n'
import { computed, ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'

const settings = useSettingsStore()
const stage = useStageStore()
const { saved, flashSaved } = useSaveFlash()
const enableOnSave = computed(() => settings.activationRequested.desktopAwareness
  || (!settings.config.desktopAwareness.enabled && !settings.config.desktopAwareness.jevApiKey.trim()))

const key = ref(settings.config.desktopAwareness.jevApiKey)
const cooldown = ref(settings.config.desktopAwareness.cooldownSeconds)
const replyHistory = ref(settings.config.desktopAwareness.replyHistoryEnabled === true)
const situationEnabled = ref(settings.config.desktopAwareness.situationEnabled === true)
const dirty = computed(() => key.value.trim() !== settings.config.desktopAwareness.jevApiKey || cooldown.value !== settings.config.desktopAwareness.cooldownSeconds
  || replyHistory.value !== (settings.config.desktopAwareness.replyHistoryEnabled === true)
  || situationEnabled.value !== (settings.config.desktopAwareness.situationEnabled === true))
watch(() => settings.config.desktopAwareness.situationEnabled, next => { situationEnabled.value = next === true })
watch(() => settings.config.desktopAwareness.replyHistoryEnabled, next => { replyHistory.value = next === true })
watch(() => settings.config.desktopAwareness.jevApiKey, (next) => {
  key.value = next
})
watch(() => settings.config.desktopAwareness.cooldownSeconds, (next) => {
  cooldown.value = next
})

async function save(): Promise<void> {
  const enable = enableOnSave.value
  const issue = enable || stage.autonomous.enabled ? stage.desktopAwarenessIssue(key.value) : ''
  settings.moduleError.desktopAwareness = issue
  if (issue) return
  settings.activationRequested.desktopAwareness = enable
  settings.moduleBusy.desktopAwareness = true
  let starting = false
  try {
    await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: key.value.trim(), cooldownSeconds: cooldown.value,
      replyHistoryEnabled: replyHistory.value, situationEnabled: situationEnabled.value })
    if (enable) {
      starting = true
      await stage.setDesktopAwarenessEnabled(true)
      if (!stage.autonomous.enabled) { settings.moduleError.desktopAwareness = stage.autonomous.error || 'Could not start module.'; return }
      settings.activationRequested.desktopAwareness = false
    }
    flashSaved()
  } catch (error) {
    settings.moduleError.desktopAwareness = starting && !(error instanceof Error && error.message === 'Could not save settings.') ? 'Could not start module.' : 'Could not save settings.'
  } finally { settings.moduleBusy.desktopAwareness = false }
}

</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field long-label" style="--i: 0">
      <span class="label">{{ t('TypeSafe / Jev API Key') }}</span>
      <input v-model="key" type="password" placeholder="sk-…" autocomplete="off" />
    </label>

    <details class="advanced-settings">
      <summary>{{ t('Advanced settings') }}</summary>
      <div class="advanced-fields">
        <label class="field long-label">
          <span class="label">{{ t('Include recent reply in Jev judgment') }}</span>
          <input v-model="replyHistory" type="checkbox" :aria-label="t('Include recent reply in Jev judgment')" />
        </label>
        <label class="field long-label">
          <span class="label">{{ t('Short-term understanding (preview)') }}</span>
          <input v-model="situationEnabled" type="checkbox" :aria-label="t('Short-term understanding (preview)')" />
        </label>
        <label class="field long-label" style="--i: 1">
          <span class="label">{{ t('Autonomous reply interval') }}: {{ cooldown }} s</span>
          <input v-model.number="cooldown" type="range" min="10" max="300" step="5" :aria-label="t('Desktop Awareness cooldown')" />
        </label>
      </div>
    </details>

    <div class="actions">
      <button type="submit" class="btn primary" :disabled="settings.moduleBusy.desktopAwareness || (!dirty && !enableOnSave)">{{ t(enableOnSave ? 'Save & Enable' : 'Save') }}</button>
    </div>

    <p v-if="saved" class="status saved">{{ t('Saved.') }}</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
input[type="range"] { width: 100%; margin: 0 }
input[type="checkbox"] { width: auto }
</style>
