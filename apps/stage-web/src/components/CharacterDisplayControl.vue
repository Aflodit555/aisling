<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { CHARACTER_DISPLAY_LIMITS, type CharacterDisplayTransform } from '../live2d/presentation'
import { usePresentationStore } from '../stores/presentation'

const presentation = usePresentationStore()
const { transform } = storeToRefs(presentation)
const root = ref<HTMLElement>()
const open = ref(false)

function setValue(key: keyof CharacterDisplayTransform, event: Event): void {
  presentation.setTransform({ ...transform.value, [key]: Number((event.target as HTMLInputElement).value) })
}

function onPointerDown(event: PointerEvent): void {
  if (open.value && !root.value?.contains(event.target as Node))
    open.value = false
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape')
    open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div ref="root" class="character-control">
    <button
      type="button"
      class="trigger"
      title="Character display"
      aria-label="Character display"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
        <circle cx="12" cy="9" r="3" />
        <path d="M7.5 18c.5-3 2-4.5 4.5-4.5s4 1.5 4.5 4.5" />
      </svg>
    </button>

    <section v-if="open" class="popover" aria-label="Character display controls">
      <header>Character</header>

      <label>
        <span>Size</span>
        <input
          type="range"
          :min="CHARACTER_DISPLAY_LIMITS.scale.min"
          :max="CHARACTER_DISPLAY_LIMITS.scale.max"
          :step="CHARACTER_DISPLAY_LIMITS.scale.step"
          :value="transform.scale"
          @input="setValue('scale', $event)"
        />
        <output>{{ transform.scale.toFixed(2) }}</output>
      </label>
      <label>
        <span>Horizontal</span>
        <input
          type="range"
          :min="CHARACTER_DISPLAY_LIMITS.offset.min"
          :max="CHARACTER_DISPLAY_LIMITS.offset.max"
          :step="CHARACTER_DISPLAY_LIMITS.offset.step"
          :value="transform.offsetX"
          @input="setValue('offsetX', $event)"
        />
        <output>{{ transform.offsetX }}</output>
      </label>
      <label>
        <span>Vertical</span>
        <input
          type="range"
          :min="CHARACTER_DISPLAY_LIMITS.offset.min"
          :max="CHARACTER_DISPLAY_LIMITS.offset.max"
          :step="CHARACTER_DISPLAY_LIMITS.offset.step"
          :value="transform.offsetY"
          @input="setValue('offsetY', $event)"
        />
        <output>{{ transform.offsetY }}</output>
      </label>

      <button type="button" class="reset" @click="presentation.resetTransform()">Reset</button>
    </section>
  </div>
</template>

<style scoped>
.character-control {
  position: relative;
  flex: 0 0 auto;
}

.trigger {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  background: #1c1930;
  color: #e6e0f4;
  font-size: 20px;
  cursor: pointer;
}

.trigger:hover,
.trigger[aria-expanded="true"] {
  border-color: rgba(167, 139, 250, 0.55);
  color: #c9b8f2;
}

.trigger svg {
  width: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.popover {
  position: absolute;
  z-index: 10;
  right: 0;
  bottom: calc(100% + 10px);
  width: 270px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: rgba(22, 19, 41, 0.98);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
}

header {
  margin-bottom: 12px;
  color: #efeaf8;
  font-size: 13px;
  font-weight: 600;
}

label {
  display: grid;
  grid-template-columns: 70px 1fr 34px;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  color: #a9a0c3;
  font-size: 11px;
}

input {
  width: 100%;
  accent-color: #806bd7;
}

output {
  color: #cbc3df;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.reset {
  margin-top: 10px;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #aaa1c3;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.reset:hover {
  color: #e6e0f4;
}
</style>
