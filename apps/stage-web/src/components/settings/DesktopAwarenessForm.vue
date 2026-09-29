<script setup lang="ts">
import { t } from '../../i18n'
import { computed, ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'

const settings = useSettingsStore()
const stage = useStageStore()
const { saved, flashSaved } = useSaveFlash()

const key = ref(settings.config.desktopAwareness.jevApiKey)
const cooldown = ref(settings.config.desktopAwareness.cooldownSeconds)
const dirty = computed(() => key.value.trim() !== settings.config.desktopAwareness.jevApiKey || cooldown.value !== settings.config.desktopAwareness.cooldownSeconds)
watch(() => settings.config.desktopAwareness.jevApiKey, (next) => {
  key.value = next
})
watch(() => settings.config.desktopAwareness.cooldownSeconds, (next) => {
  cooldown.value = next
})

async function save(): Promise<void> {
  await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: key.value.trim(), cooldownSeconds: cooldown.value })
  if (!key.value.trim() && stage.autonomous.enabled)
    await stage.setDesktopAwarenessEnabled(false)
  flashSaved()
}

</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field long-label" style="--i: 0">
      <span class="label">{{ t('TypeSafe / Jev API Key') }}</span>
      <input v-model="key" type="password" placeholder="sk-…" autocomplete="off" />
      <span class="hint">{{ t('Stored locally. Never committed to git.') }}</span>
    </label>

    <details class="advanced-settings">
      <summary>{{ t('Advanced settings') }}</summary>
      <div class="advanced-fields">
        <label class="field" style="--i: 1">
          <span class="label">{{ t('Cooldown') }}: {{ cooldown }} s</span>
          <input v-model.number="cooldown" type="range" min="10" max="300" step="5" :aria-label="t('Desktop Awareness cooldown')" />
        </label>
      </div>
    </details>

    <div class="actions">
      <button type="submit" class="btn primary" :disabled="!dirty">{{ t('Save') }}</button>
    </div>

    <p v-if="saved" class="status saved">{{ t('Saved.') }}</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
input[type="range"] { width: 100%; margin: 0 }
/* A wrapped label spans the hint row too, so the hint stays tucked under its input. */
.long-label > .label { grid-row: span 2; align-self: start; padding-top: calc(.4rem + 1px) }
</style>
