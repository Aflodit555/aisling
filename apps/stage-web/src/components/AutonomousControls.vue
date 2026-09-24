<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useStageStore } from '../stores/stage'
import { SHOULD_INTERRUPT_THRESHOLD } from '../runtime/autonomous'

const stage = useStageStore()
const settings = useSettingsStore()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(timer))
const cooldown = computed(() => stage.autonomous.cooldownStartedAt === null
  ? 0
  : Math.max(0, Math.ceil((stage.autonomous.cooldownStartedAt + settings.config.desktopAwareness.cooldownSeconds * 1000 - now.value) / 1000)))
const score = (value?: number) => value === undefined ? '—' : value.toFixed(2)

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
    <h3 class="debug-title">Debug</h3>
    <dl v-if="stage.desktopAvailable">
      <dt>App</dt><dd>{{ stage.autonomous.latestContext?.focus.app || '—' }}</dd>
      <dt>Title</dt><dd>{{ stage.autonomous.latestContext?.focus.title || '—' }}</dd>
      <dt>should_interrupt</dt><dd>{{ score(stage.autonomous.scores?.shouldInterrupt) }} / ≥ {{ SHOULD_INTERRUPT_THRESHOLD }}</dd>
      <dt>Last trigger</dt><dd>{{ stage.autonomous.lastTrigger || '—' }}</dd>
      <dt>Judge latency</dt><dd>{{ stage.autonomous.judgeLatencyMs === null ? '—' : `${stage.autonomous.judgeLatencyMs} ms` }}</dd>
      <dt>Cooldown</dt><dd>{{ cooldown }}s remaining / {{ settings.config.desktopAwareness.cooldownSeconds }}s</dd>
    </dl>
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
.debug-title { margin: 1.5rem 0 .5rem; color: var(--muted); font-family: inherit; font-size: .85rem; font-weight: 500 }
dl { display: grid; grid-template-columns: 10rem minmax(0, 1fr); font-family: var(--mono); font-size: .85rem }
dt, dd { padding: .4rem 0 }
dt { color: var(--muted); padding-right: 1rem }
dd { overflow-wrap: anywhere }
:is(dt, dd):nth-child(n+3) { border-top: 1px solid var(--rule) }
.error { margin-top: .75rem; color: var(--danger); font-size: .85rem; overflow-wrap: anywhere }
</style>
