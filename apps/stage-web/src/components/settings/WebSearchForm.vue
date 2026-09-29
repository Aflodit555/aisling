<script setup lang="ts">
import { t } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()

function selectProvider(): void {
  void settings.saveWebSearch({ providerType: 'duckduckgo' })
}
</script>

<template>
  <div class="form">
    <div class="field">
      <span class="label">{{ t('Provider') }}</span>
      <button v-if="settings.config.webSearch.providerType === 'none'" type="button" class="btn provider-choice" @click="selectProvider">{{ t('Use DuckDuckGo Lite') }}</button>
      <span v-else>DuckDuckGo Lite</span>
      <span class="hint">{{ t('No API key required.') }}</span>
    </div>
  </div>
</template>

<style scoped>
.provider-choice { justify-self: start }
</style>
