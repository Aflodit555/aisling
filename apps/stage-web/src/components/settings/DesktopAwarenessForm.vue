<script setup lang="ts">
import { ref, watch } from 'vue'

import { useSaveFlash } from '../../composables/use-save-flash'
import { useSettingsStore } from '../../stores/settings'
import { useStageStore } from '../../stores/stage'

const settings = useSettingsStore()
const stage = useStageStore()
const { saved, flashSaved } = useSaveFlash()

const key = ref(settings.config.desktopAwareness.jevApiKey)
watch(() => settings.config.desktopAwareness.jevApiKey, (next) => {
  key.value = next
})

const testState = ref<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
const testMessage = ref('')

async function save(): Promise<void> {
  await settings.saveDesktopAwareness({ ...settings.config.desktopAwareness, jevApiKey: key.value.trim() })
  flashSaved()
}

async function test(): Promise<void> {
  testState.value = 'connecting'
  testMessage.value = ''
  const result = await stage.testDesktopAwareness(key.value.trim())
  testState.value = result.ok ? 'connected' : 'failed'
  testMessage.value = result.ok ? 'Connected.' : result.message
}
</script>

<template>
  <form class="form" @submit.prevent="save">
    <label class="field long-label" style="--i: 0">
      <span class="label">TypeSafe / Jev API Key</span>
      <input v-model="key" type="password" placeholder="sk-…" autocomplete="off" />
      <span class="hint">Used by the desktop semantic judge and to read Aisling's emotion from each reply. Saved with your settings, never committed to git or logged.</span>
    </label>

    <div class="actions">
      <button
        type="button"
        class="btn"
        :disabled="testState === 'connecting'"
        @click="test"
      >
        {{ testState === 'connecting' ? 'Connecting…' : 'Test Connection' }}
      </button>
      <button type="submit" class="btn primary">Save</button>
    </div>

    <p v-if="testMessage" class="status" :class="testState">{{ testMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
.status { overflow-wrap: anywhere }
/* A wrapped label spans the hint row too, so the hint stays tucked under its input. */
.long-label > .label { grid-row: span 2; align-self: start; padding-top: calc(.4rem + 1px) }
</style>
