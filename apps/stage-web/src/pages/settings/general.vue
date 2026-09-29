<script setup lang="ts">
import { language, setLanguage, t, type Language } from '../../i18n'
import SettingsSelect from '../../components/settings/SettingsSelect.vue'
</script>

<template>
  <div>
    <h2 class="page-title">{{ t('General') }}</h2>
    <div class="form">
      <div class="field">
        <span class="label">{{ t('Language') }}</span>
        <SettingsSelect :model-value="language" :options="[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]" :label="t('Language')" @update:model-value="setLanguage($event as Language)" />
      </div>
    </div>
  </div>
</template>
