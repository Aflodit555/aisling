<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useStageStore } from '../stores/stage'

const stage = useStageStore()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(timer))
const cooldown = computed(() => Math.max(0, Math.ceil((stage.autonomous.cooldownUntil - now.value) / 1000)))

function onToggle(event: Event): void {
  stage.setAutonomousEnabled((event.currentTarget as HTMLInputElement).checked)
}
</script>

<template>
  <details class="autonomous-controls">
    <summary>Autonomous Speak · {{ stage.autonomous.enabled ? 'On' : 'Off' }}</summary>
    <p class="bridge-status" :class="`is-${stage.desktopBridgeState}`">
      <span class="bridge-dot" aria-hidden="true" />
      Desktop bridge: <strong>{{ stage.desktopBridgeState }}</strong>
    </p>
    <label class="control proactive-control" :class="{ disabled: !stage.desktopAvailable }">
      <span>Proactive speak</span>
      <input
        class="toggle"
        type="checkbox"
        :checked="stage.autonomous.enabled"
        :disabled="!stage.desktopAvailable"
        aria-label="Proactive speak"
        @change="onToggle"
      >
    </label>
    <label class="control">
      <span>Silence threshold (s)</span>
      <input type="number" min="10" max="600" step="1" :value="stage.autonomous.thresholdSeconds"
        @change="stage.setAutonomousThreshold(Number(($event.target as HTMLInputElement).value))">
    </label>
    <p v-if="!stage.desktopAvailable" class="unavailable-hint">
      Desktop activity unavailable — open Aisling Desktop to enable autonomous speaking.
    </p>
    <p v-else>Uses foreground app/title only. Keyboard or mouse activity resets silence.</p>
    <dl>
      <dt>app</dt><dd>{{ stage.autonomous.latestActivity.app || '—' }}</dd>
      <dt>title</dt><dd>{{ stage.autonomous.latestActivity.title || '—' }}</dd>
      <dt>silence</dt><dd>{{ stage.autonomous.silenceSeconds }}s</dd>
      <dt>cooldown</dt><dd>{{ cooldown }}s</dd>
    </dl>
    <p v-if="stage.autonomous.error" role="status">{{ stage.autonomous.error }}</p>
  </details>
</template>

<style scoped>
.autonomous-controls { flex: 0 0 auto; padding: 10px 12px; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; color: #9d94b8; font-size: 12px; }
summary { cursor: pointer; color: #cfc6ea; }
.control { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; }
.proactive-control { cursor: pointer; }
.proactive-control:hover { color: #cfc6ea; }
.proactive-control.disabled { cursor: not-allowed; opacity: 0.58; }
.bridge-status { display: flex; align-items: center; gap: 6px; margin: 10px 0 2px; }
.bridge-status strong { color: #cfc6ea; font-weight: 500; }
.bridge-dot { width: 7px; height: 7px; border-radius: 50%; background: #6f6889; }
.bridge-status.is-connected .bridge-dot { background: #69c89a; box-shadow: 0 0 8px rgba(105, 200, 154, 0.45); }
.bridge-status.is-unavailable .bridge-dot { background: #8b849f; }
.toggle { position: relative; flex: 0 0 auto; width: 36px; height: 20px; margin: 0; appearance: none; border: 1px solid #4b435f; border-radius: 999px; background: #211d32; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
.toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #a49bb8; transition: transform 120ms ease, background 120ms ease; }
.toggle:checked { border-color: #8f76e8; background: #6d5ac4; }
.toggle:checked::after { transform: translateX(16px); background: #fff; }
.toggle:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
.toggle:disabled { cursor: not-allowed; }
.unavailable-hint { color: #8f87ad; }
input[type="number"] { width: 64px; border: 1px solid #39314f; border-radius: 6px; padding: 4px; background: #161329; color: #e6e0f4; }
dl { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 4px; margin-bottom: 0; }
dd { margin: 0; overflow-wrap: anywhere; }
p { line-height: 1.5; }
</style>
