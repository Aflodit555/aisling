<script setup lang="ts">
import { t } from '../../i18n'
import { DEFAULT_OPENAI_BASE_URL, type ConsciousnessConfig } from '@aisling/core'
import { computed, reactive, ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { saved, flashSaved } = useSaveFlash()
const error = ref('')

const draft = reactive<ConsciousnessConfig>({ ...settings.config.consciousness })
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(settings.config.consciousness))

watch(() => settings.config.consciousness, (next) => {
  Object.assign(draft, next)
})

async function save(): Promise<void> {
  draft.temperature = Math.max(0, Math.min(2, Number(draft.temperature)))
  error.value = ''
  try { await settings.saveConsciousness({ ...draft }); flashSaved() }
  catch { error.value = 'Could not save settings.' }
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field" style="--i: 0">
      <span class="label">{{ t('Base URL') }}</span>
      <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
    </label>

    <label class="field" style="--i: 1">
      <span class="label">{{ t('API Key') }}</span>
      <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
    </label>

    <label class="field" style="--i: 2">
      <span class="label">{{ t('Model') }}</span>
      <input v-model="draft.model" type="text" placeholder="gpt-4o-mini" />
    </label>

    <label class="field" style="--i: 3">
      <span class="label">{{ t('Temperature') }}: {{ draft.temperature.toFixed(1) }}</span>
      <input v-model.number="draft.temperature" type="range" min="0" max="2" step="0.1" />
    </label>
    <div class="actions">
      <button type="submit" class="btn primary" :disabled="!dirty">{{ t('Save') }}</button>
    </div>

    <p v-if="saved" class="status saved">{{ t('Saved.') }}</p>
    <p v-if="error" class="status error" role="status">{{ t(error) }}</p>
  </form>
</template>

<style scoped>
input[type="range"] { width: 100%; margin: 0 }
.status { overflow-wrap: anywhere }
</style>
