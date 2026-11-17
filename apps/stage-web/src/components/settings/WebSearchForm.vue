<script setup lang="ts">
import { t } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import { computed, ref, watch } from 'vue'
import SettingsSelect from './SettingsSelect.vue'
import { useSaveFlash } from '../../composables/use-save-flash'

const settings = useSettingsStore()

const provider = ref(settings.config.webSearch.providerType)
const { saved, flashSaved } = useSaveFlash()
watch(() => settings.config.webSearch.providerType, next => { provider.value = next })
const dirty = computed(() => provider.value !== settings.config.webSearch.providerType)
async function save() {
  if (await settings.saveWebSearch({ providerType: provider.value }, settings.saveAndEnable.webSearch || settings.config.webSearch.enabled)) flashSaved()
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <div class="field">
      <span class="label">{{ t('Provider') }}</span>
      <SettingsSelect :model-value="provider" :options="[{ value: 'duckduckgo', label: 'DuckDuckGo Lite' }]" :label="t('Provider')" :placeholder="t('Select provider')" @update:model-value="provider = 'duckduckgo'" />
    </div>
    <div class="actions"><button type="submit" class="btn primary" :disabled="settings.moduleBusy.webSearch || (!dirty && !settings.saveAndEnable.webSearch)">{{ t(settings.saveAndEnable.webSearch ? 'Save & Enable' : 'Save') }}</button></div>
    <p v-if="saved" class="status saved">{{ t('Saved.') }}</p>
  </form>
</template>
