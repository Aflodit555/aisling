<script setup lang="ts">
import { language, setLanguage, t, type Language } from '../../i18n'
import SettingsSelect from '../../components/settings/SettingsSelect.vue'
import { ref } from 'vue'
const error = ref('')
function changeLanguage(next: string) {
  error.value = ''
  try { setLanguage(next as Language) } catch { error.value = 'Could not save settings.' }
}
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('General') }}</h2>
    <div class="form">
      <div class="field">
        <span class="label">{{ t('Language') }}</span>
        <SettingsSelect :model-value="language" :options="[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]" :label="t('Language')" @update:model-value="changeLanguage" />
      </div>
    </div>
    <p v-if="error" class="error" role="status">{{ t(error) }}</p>
  </div>
</template>
