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
    <label class="field">
      <span class="label">TypeSafe / Jev API Key</span>
      <input v-model="key" type="password" placeholder="sk-…" autocomplete="off" />
      <span class="hint">Used by the desktop semantic judge. Saved with your settings, never committed to git or logged.</span>
    </label>

    <div class="actions">
      <button
        type="button"
        class="secondary"
        :disabled="testState === 'connecting'"
        @click="test"
      >
        {{ testState === 'connecting' ? 'Connecting…' : 'Test Connection' }}
      </button>
      <button type="submit" class="primary">Save</button>
    </div>

    <p v-if="testMessage" class="status" :class="testState">{{ testMessage }}</p>
    <p v-if="saved" class="status saved">Saved.</p>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 440px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  color: #9d94b8;
}

input {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #161329;
  color: #e6e0f4;
  font: inherit;
  font-size: 14px;
}

input:focus {
  outline: none;
  border-color: rgba(167, 139, 250, 0.6);
}

.hint {
  font-size: 12px;
  color: #6f6889;
}

.actions {
  display: flex;
  gap: 10px;
}

button {
  padding: 9px 18px;
  border: none;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary {
  background: #6d5ac4;
  color: #fff;
}

.secondary {
  background: rgba(255, 255, 255, 0.06);
  color: #e6e0f4;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.status {
  margin: 0;
  font-size: 13px;
}

.status.connected {
  color: #a7e6b4;
}

.status.failed {
  color: #f6c2c2;
}

.status.connecting {
  color: #f0cf8a;
}

.status.saved {
  color: #a7e6b4;
}
</style>
