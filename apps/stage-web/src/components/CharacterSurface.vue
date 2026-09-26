<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import { createEmotionLayer, GESTURE_MIN_STRENGTH, MAO_LOOKS } from '../live2d/emotion-look'
import { createIdleLife } from '../live2d/idle-life'
import type { ParameterSource } from '../live2d/parameter-controller'
import {
  CUBISM_CORE_URL,
  LIVE2D_MODEL_URL,
  MOUTH_OPEN_PARAMETER,
  PARAMETER_SOURCE_PRIORITY,
} from '../live2d/presentation'
import { mapMouthOpenness } from '../live2d/mouth-visual-mapping'
import type { Live2DRig } from '../live2d/rig'
import { createMouthController } from '../presentation/mouth-controller'
import { useEmotionStore } from '../stores/emotion'
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

const presentation = usePresentationStore()
const { transform } = storeToRefs(presentation)
const desktopTransform = { scale: 1.2, offsetX: 0, offsetY: 0 }
const speech = useSpeechStore()
const emotion = useEmotionStore()
const rendererState = ref<'loading' | 'ready' | 'error'>('loading')
const rendererError = ref('')
const driven = computed(() => props.active || props.speaking || props.searching || props.looking)

// Application-layer parameter sources, applied by the renderer right after the
// native motion update, lowest priority first (see parameter-controller).
const rig = shallowRef<Live2DRig>()
const pointer = shallowRef<{ x: number; y: number }>()
const mouthController = createMouthController()

// Head turn while Aisling is busy, eased and added on top of whatever moves below.
let manualAngle = 0
const manualSource: ParameterSource = {
  id: 'manual-pose',
  priority: PARAMETER_SOURCE_PRIORITY.manual,
  targets: new Set(['ParamAngleX']),
  sample: ({ readBase, dtMs }) => {
    const goal = driven.value && !rig.value?.isGesture() ? 12 : 0
    manualAngle += (goal - manualAngle) * (1 - Math.exp(-dtMs / 250))
    return new Map([['ParamAngleX', readBase('ParamAngleX') + manualAngle]])
  },
}

function createSpeechSource(mouth: string): ParameterSource {
  return {
    id: 'speech-mouth',
    priority: PARAMETER_SOURCE_PRIORITY.speech,
    targets: new Set([mouth]),
    sample: ({ readBase, dtMs }) => {
      const frame = mouthController.update({
        speaking: speech.speaking,
        level: speech.readLevel(),
        dtMs,
        baseMouth: readBase(mouth),
      })
      return frame.ownsMouth ? new Map([[mouth, mapMouthOpenness(frame.mouthOpen)]]) : undefined
    },
  }
}

const sources = computed<ParameterSource[]>(() => rig.value
  ? [
      manualSource,
      createIdleLife({
        eyeIds: rig.value.eyeBlinkIds,
        isGesture: rig.value.isGesture,
        pointer: () => pointer.value,
        priority: PARAMETER_SOURCE_PRIORITY.idle,
      }),
      createEmotionLayer({
        rig: rig.value,
        looks: MAO_LOOKS,
        weights: () => emotion.state.update(performance.now(), speech.speaking),
        priority: PARAMETER_SOURCE_PRIORITY.emotion,
      }),
      createSpeechSource(rig.value.lipSyncIds[0] ?? MOUTH_OPEN_PARAMETER),
    ]
  : [manualSource])

// A strongly entered emotion also plays its gesture once.
watch(() => emotion.entered, (entered) => {
  const gesture = entered && MAO_LOOKS[entered.emotion].gesture
  if (gesture && entered.strength >= GESTURE_MIN_STRENGTH)
    void rig.value?.playMotion(gesture, 'emotion')
})

function onReady(loaded: Live2DRig): void {
  rig.value = loaded
  rendererState.value = 'ready'
  emit('ready')
}

function onError(error: Error): void {
  rendererState.value = 'error'
  rendererError.value = error.message
  emit('error')
}

function interact(): void {
  // Speech owns only the mouth, so a touch can perform without cutting the voice.
  if (!props.active && !props.searching && !props.looking)
    void rig.value?.playRandomMotion()
}

function moveCharacter(delta: { x: number; y: number }): void {
  presentation.setTransform({
    ...transform.value,
    offsetX: transform.value.offsetX + delta.x,
    offsetY: transform.value.offsetY + delta.y,
  })
}

defineExpose({ interact })
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
        @pointer="pointer = $event"
        @tap="interact"
        @move="moveCharacter"
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
    <button v-if="rendererState === 'ready' && !desktop" class="btn drive-test" type="button" @click="interact">
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
