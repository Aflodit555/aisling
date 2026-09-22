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
        <h2>Desktop Awareness</h2>
        <p>Desktop-only. Sends current context to a lightweight semantic judge before Aisling may speak.</p>
      </div>
      <input
        class="toggle"
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
    <div class="awareness-settings">
      <label>
        <span>Cooldown</span>
        <strong>{{ settings.config.desktopAwareness.cooldownSeconds }} s</strong>
        <input
          type="range" min="10" max="300" step="5"
          :value="settings.config.desktopAwareness.cooldownSeconds"
          aria-label="Desktop Awareness cooldown"
          @input="saveCooldown"
        >
      </label>
    </div>
    <h3>Debug</h3>
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
.desktop-awareness { max-width: 440px; margin-top: 26px; padding-top: 22px; border-top: 1px solid rgba(255, 255, 255, 0.08); color: #9d94b8; font-size: 13px; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
h2 { margin: 0; color: #efeaf8; font-size: 16px; font-weight: 500; }
p { margin: 6px 0; line-height: 1.5; }
.bridge-status { display: flex; align-items: center; gap: 6px; margin-top: 14px; color: #cfc6ea; }
.bridge-dot { width: 7px; height: 7px; border-radius: 50%; background: #6f6889; }
.bridge-status.is-connected .bridge-dot { background: #69c89a; box-shadow: 0 0 8px rgba(105, 200, 154, 0.45); }
.toggle { position: relative; flex: 0 0 auto; width: 36px; height: 20px; margin: 1px 0 0; appearance: none; border: 1px solid #4b435f; border-radius: 999px; background: #211d32; cursor: pointer; }
.toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #a49bb8; transition: transform 120ms ease; }
.toggle:checked { border-color: #8f76e8; background: #6d5ac4; }
.toggle:checked::after { transform: translateX(16px); background: #fff; }
.toggle:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
.toggle:disabled { cursor: not-allowed; opacity: 0.5; }
.unavailable-hint { color: #8f87ad; }
.awareness-settings { display: grid; gap: 14px; margin: 18px 0; }
.awareness-settings label { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; }
.awareness-settings strong { color: #cfc6ea; font-weight: 500; }
.awareness-settings input { grid-column: 1 / -1; width: 100%; margin: 0; }
h3 { margin: 18px 0 10px; color: #cfc6ea; font-size: 13px; font-weight: 500; }
dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 5px 10px; margin: 14px 0 0; }
dt { color: #736b8d; }
dd { margin: 0; color: #cfc6ea; overflow-wrap: anywhere; }
.error { color: #f6c2c2; }
</style>
