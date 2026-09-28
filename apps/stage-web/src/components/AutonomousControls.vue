<script setup lang="ts">
import { useSettingsStore } from '../stores/settings'
import { useStageStore } from '../stores/stage'

const stage = useStageStore()
const settings = useSettingsStore()
function onToggle(event: Event): void {
  void stage.setDesktopAwarenessEnabled((event.currentTarget as HTMLInputElement).checked)
}

function saveCooldown(event: Event): void {
  void settings.saveDesktopAwareness({
    ...settings.config.desktopAwareness,
    cooldownSeconds: Number((event.currentTarget as HTMLInputElement).value),
  })
}
</script>

<template>
  <section class="desktop-awareness">
    <div class="heading">
      <div>
        <h3>Desktop Awareness</h3>
        <p>Desktop-only. Sends current context to a lightweight semantic judge before Aisling may speak.</p>
      </div>
      <input
        type="checkbox"
        :checked="stage.autonomous.enabled"
        :disabled="!stage.desktopAvailable"
        aria-label="Desktop Awareness"
        @change="onToggle"
      >
    </div>
    <p class="bridge-status" :class="`is-${stage.desktopBridgeState}`">
      <span class="bridge-dot" aria-hidden="true" />
      {{ stage.autonomous.enabled ? 'ON' : 'OFF' }} · {{ stage.desktopBridgeState }}
    </p>
    <p v-if="!stage.desktopAvailable" class="unavailable-hint">
      Desktop Awareness is unavailable in browser-only mode.
    </p>
    <div class="form">
      <label class="field">
        <span class="label">Cooldown</span>
        <input
          type="range" min="10" max="300" step="5"
          :value="settings.config.desktopAwareness.cooldownSeconds"
          aria-label="Desktop Awareness cooldown"
          @input="saveCooldown"
        >
        <strong>{{ settings.config.desktopAwareness.cooldownSeconds }} s</strong>
      </label>
    </div>
    <p v-if="stage.autonomous.error" class="error" role="status">{{ stage.autonomous.error }}</p>
  </section>
</template>

<style scoped>
.desktop-awareness { margin-top: 2rem }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 2rem }
h3 { font-family: var(--display); font-size: 1rem; font-weight: 600 }
.heading p, .unavailable-hint { color: var(--muted); font-size: .85rem }
.heading input { margin: .2rem 1rem 0 0 }
.bridge-status { display: flex; align-items: center; gap: .5rem; margin-top: .75rem; color: var(--muted); font-size: .85rem }
.bridge-dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor }
.is-connected .bridge-dot { background: var(--link); border-color: var(--link) }
.form { margin-top: .75rem }
.form .field { grid-template-columns: 10rem minmax(0, 1fr) auto }
.form .field > strong { grid-column: 3; min-width: 3rem; text-align: right; font-weight: 500; font-variant-numeric: tabular-nums }
input[type="range"] { width: 100%; margin: 0 }
.error { margin-top: .75rem; color: var(--danger); font-size: .85rem; overflow-wrap: anywhere }
</style>
