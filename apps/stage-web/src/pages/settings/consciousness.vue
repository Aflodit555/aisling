<script setup lang="ts">
import { t } from '../../i18n'
import ConsciousnessForm from '../../components/settings/ConsciousnessForm.vue'
</script>

<template>
  <div class="settings-module">
    <h2 class="page-title">{{ t('Consciousness') }}</h2>
    <p class="page-sub">{{ t('Choose which model service Aisling uses to think and reply.') }}</p>

    <ConsciousnessForm />
  </div>
</template>
