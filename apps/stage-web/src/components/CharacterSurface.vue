<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ParameterSource } from '../live2d/parameter-controller'
import {
  CUBISM_CORE_URL,
  LIVE2D_MODEL_URL,
  MOUTH_OPEN_PARAMETER,
  PARAMETER_SOURCE_PRIORITY,
} from '../live2d/presentation'
import { mapMouthOpenness } from '../live2d/mouth-visual-mapping'
import { createMouthController } from '../presentation/mouth-controller'
import { usePresentationStore } from '../stores/presentation'
import { useSpeechStore } from '../stores/speech'
import Live2DRenderer from './Live2DRenderer.vue'

const props = defineProps<{
  name: string
  active: boolean
  speaking?: boolean
  searching?: boolean
  looking?: boolean
  desktop?: boolean
}>()
const emit = defineEmits<{ ready: []; error: [] }>()

const { transform } = storeToRefs(usePresentationStore())
const desktopTransform = { scale: 1.2, offsetX: 0, offsetY: 0 }
const speech = useSpeechStore()
const rendererState = ref<'loading' | 'ready' | 'error'>('loading')
const rendererError = ref('')
const driven = computed(() => props.active || props.speaking || props.searching || props.looking)

// Application-layer parameter sources. The renderer owns a ParameterController
// and applies these above the native model value after each model.update().
const angle = ref(0)
const mouthController = createMouthController()

const manualSource: ParameterSource = {
  id: 'manual-pose',
  priority: PARAMETER_SOURCE_PRIORITY.manual,
  targets: new Set(['ParamAngleX']),
  sample: () => new Map([['ParamAngleX', angle.value]]),
}

const speechSource: ParameterSource = {
  id: 'speech-mouth',
  priority: PARAMETER_SOURCE_PRIORITY.speech,
  targets: new Set([MOUTH_OPEN_PARAMETER]),
  sample: ({ readBase, dtMs }) => {
    const level = speech.readLevel()
    const frame = mouthController.update({
      speaking: speech.speaking,
      level,
      dtMs,
      baseMouth: readBase(MOUTH_OPEN_PARAMETER),
    })
    return frame.ownsMouth
      ? new Map([[MOUTH_OPEN_PARAMETER, mapMouthOpenness(frame.mouthOpen)]])
      : undefined
  },
}

const sources: ParameterSource[] = [manualSource, speechSource]
let testTimer: ReturnType<typeof setTimeout> | undefined

function applyPresentationState(): void {
  angle.value = driven.value ? 12 : 0
}

function onReady(): void {
  rendererState.value = 'ready'
  applyPresentationState()
  emit('ready')
}

function onError(error: Error): void {
  rendererState.value = 'error'
  rendererError.value = error.message
  emit('error')
}

function testMovement(): void {
  clearTimeout(testTimer)
  angle.value = -24
  testTimer = setTimeout(applyPresentationState, 700)
}

watch(driven, applyPresentationState)
onBeforeUnmount(() => clearTimeout(testTimer))
</script>

<template>
  <section class="surface" :class="{ desktop }">
    <div class="presence" :class="{ 'is-active': driven, 'is-error': rendererState === 'error' }">
      <Live2DRenderer
        v-if="rendererState !== 'error'"
        :model-src="LIVE2D_MODEL_URL"
        :cubism-core-src="CUBISM_CORE_URL"
        :transform="desktop ? desktopTransform : transform"
        :desktop="desktop"
        :sources="sources"
        @ready="onReady"
        @error="onError"
      />
      <template v-else>
        <div class="halo" />
        <div class="avatar">{{ name.slice(0, 1) }}</div>
      </template>
      <p v-if="rendererState === 'loading'" class="renderer-state">Loading character…</p>
    </div>
    <h2 v-if="!desktop" class="name">{{ name }}</h2>
    <p v-if="!desktop" class="status">
      {{ looking
        ? `${name} is looking…`
        : searching
          ? `${name} is searching…`
          : speaking
            ? `${name} is speaking…`
            : active
              ? `${name} is thinking…`
              : `${name} is here.` }}
    </p>
    <button v-if="rendererState === 'ready' && !desktop" class="btn drive-test" type="button" @click="testMovement">
      Test movement
    </button>
    <p v-else-if="rendererState === 'error' && !desktop" class="renderer-error" :title="rendererError">
      Live2D unavailable · using fallback
    </p>
  </section>
</template>

<style scoped>
.surface { position: relative; display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: .25rem; min-width: 0; padding: 0 1.5rem 1.5rem }

.surface.desktop { width: 100%; height: 100%; padding: 0; overflow: visible; }
.surface.desktop .presence { width: 100%; height: 100%; min-height: 0; }
.surface.desktop .presence.is-error { width: 100%; height: 100%; }
.surface.desktop .renderer-state { display: none; }

.presence { position: relative; display: grid; place-items: center; width: min(100%, 520px); height: min(64vh, 600px); min-height: 280px }
.presence.is-error { width: 220px; height: 220px; min-height: 220px }
.halo { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--link) 40%, transparent), transparent 70%); transition: transform .6s var(--ease), opacity .6s var(--ease) }
.presence.is-active .halo { transform: scale(1.12); animation: breathe 2.2s ease-in-out infinite }
.avatar { position: relative; display: grid; place-items: center; width: 120px; height: 120px; border-radius: 50%; background: var(--surface); border: 1px solid var(--rule); font: 600 3.25rem var(--display); user-select: none }

.name { margin-top: 1rem; font-size: 1.5rem; font-weight: 700 }
.status, .renderer-state, .renderer-error { color: var(--muted) }
.renderer-state { position: absolute; font-size: .85rem }
.renderer-error { margin-top: .75rem; font-size: .85rem }
.drive-test { margin-top: .75rem }

@keyframes breathe { 0%, 100% { transform: scale(1.06); opacity: .85 } 50% { transform: scale(1.14); opacity: 1 } }
</style>
