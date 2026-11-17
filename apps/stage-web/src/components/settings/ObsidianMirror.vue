<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { t } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import ModuleToggle from './ModuleToggle.vue'
import Icon from '../Icon.vue'

const settings = useSettingsStore()
const bridge = window.aislingDesktop?.obsidianMirror
const config = computed(() => settings.config.memory.obsidianMirror ?? { enabled: false, vault: 'D:\\Archive\\Aisling Archive' })
const vault = ref(config.value.vault)
const error = ref('')
const busy = ref(false)
let saving: Promise<void> = Promise.resolve()
watch(() => config.value.vault, value => { vault.value = value })
function save(enabled = config.value.enabled) {
  if (busy.value) return saving
  busy.value = true
  error.value = ''
  saving = (async () => {
    try { error.value = (await settings.saveObsidianMirror({ enabled, vault: vault.value }))?.error ?? '' }
    catch { error.value = 'Could not save settings.' }
    finally { busy.value = false }
  })()
  return saving
}
async function open() {
  await save()
  try { error.value = (await bridge?.open())?.error ?? 'Desktop database required.' }
  catch { error.value = 'Could not open Obsidian. Check the vault and installation.' }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  const refresh = async () => {
    if (busy.value || !bridge || !config.value.enabled) return
    try { error.value = (await bridge.status()).error }
    catch { error.value = 'Memory database unavailable.' }
  }
  void refresh()
  timer = setInterval(refresh, 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="obsidian-row module-toggle" :class="{ invalid: error }" :title="t(error)">
    <label for="obsidian-vault">{{ t('Obsidian mirror') }}</label>
    <input id="obsidian-vault" v-model="vault" type="text" :title="error ? t(error) : vault" :aria-label="t('Obsidian vault path')"
      :aria-invalid="!!error" :disabled="busy" spellcheck="false" @change="save()" @keydown.enter.prevent="save()">
    <button type="button" class="icon-btn obsidian-open" :aria-label="t('Open in Obsidian')" :title="t('Open in Obsidian')" :disabled="!bridge" @click="open">
      <Icon name="external" :size="17" />
    </button>
    <ModuleToggle :label="'Sync Obsidian'" :enabled="config.enabled" :disabled="busy || !bridge" @change="save($event)" />
    <span class="mirror-announcement" role="status">{{ t(error) }}</span>
  </div>
</template>

<style scoped>
.obsidian-row { display: flex; align-items: center; gap: 16px; min-width: 0; }
.obsidian-row > label { flex: none; white-space: nowrap; }
.obsidian-row > input { flex: 1; min-width: 0; width: 0; height: 30px; padding: 0 8px; font: inherit; color: var(--fg); background: var(--field); border: 1px solid var(--rule); border-radius: 4px; text-overflow: ellipsis; }
.obsidian-row > input:focus { outline: 1px solid var(--link); text-overflow: clip; }
.obsidian-row.invalid > input { border-color: var(--danger); }
.obsidian-row :deep(.module-toggle) { flex: none; padding: 0; margin: 0; border: 0; background: transparent; height: auto; }
.obsidian-row :deep(.toggle-line) { display: flex; }
.obsidian-row :deep(.toggle-line > span), .mirror-announcement { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.obsidian-open { width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; }
.obsidian-open:hover { background: var(--hover); color: var(--fg); }
.obsidian-open:focus-visible { outline: 2px solid var(--link); }
@media (max-width: 480px) { .obsidian-row { gap: 9px; padding-inline: 10px; } }
</style>
