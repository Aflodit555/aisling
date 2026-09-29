<script setup lang="ts">
import { t } from '../../i18n'
import { DEFAULT_OPENAI_BASE_URL, DEFAULT_VISION_MODEL, type VisionConfig } from '@aisling/core'
import { computed, reactive, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import SettingsSelect from './SettingsSelect.vue'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const { saved, flashSaved } = useSaveFlash()

const manual = (config: VisionConfig): Omit<VisionConfig, 'enabled'> => ({ providerType: config.providerType, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model })
const draft = reactive(manual(settings.config.vision))
watch(() => manual(settings.config.vision), (next) => {
  Object.assign(draft, next)
})
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(manual(settings.config.vision)))

const isOpenAI = computed(() => draft.providerType === 'openai-compatible')
async function save(): Promise<void> {
  await settings.saveVision({ ...draft })
  flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <div class="field" style="--i: 0">
      <span class="label">{{ t('Provider') }}</span>
      <SettingsSelect :model-value="draft.providerType" :options="[{ value: 'openai-compatible', label: t('OpenAI-compatible multimodal') }]" :label="t('Provider')" :placeholder="t('Select provider')" @update:model-value="draft.providerType = $event as VisionConfig['providerType']" />
    </div>

    <template v-if="isOpenAI">
      <label class="field" style="--i: 1">
        <span class="label">{{ t('Base URL') }}</span>
        <input v-model="draft.baseUrl" type="text" :placeholder="DEFAULT_OPENAI_BASE_URL" />
      </label>

      <label class="field" style="--i: 2">
        <span class="label">{{ t('API Key') }}</span>
        <input v-model="draft.apiKey" type="password" placeholder="sk-…" autocomplete="off" />
        <span class="hint">{{ t('Stored locally. Never committed to git.') }}</span>
      </label>

      <label class="field" style="--i: 3">
        <span class="label">{{ t('Model') }}</span>
        <input v-model="draft.model" type="text" :placeholder="DEFAULT_VISION_MODEL" />
      </label>
    </template>

    <div class="actions">
      <button type="submit" class="btn primary" :disabled="!dirty">{{ t('Save') }}</button>
    </div>

    <p v-if="saved" class="status saved">{{ t('Saved.') }}</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
</style>
