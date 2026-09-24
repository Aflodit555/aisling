<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { CHARACTER_DISPLAY_LIMITS, type CharacterDisplayTransform } from '../live2d/presentation'
import { usePresentationStore } from '../stores/presentation'
import Icon from './Icon.vue'

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
      class="icon-btn"
      title="Character display"
      aria-label="Character display"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon name="character" :size="20" />
    </button>

    <section v-if="open" class="pop panel" aria-label="Character display controls">
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

      <button type="button" class="btn reset" @click="presentation.resetTransform()">Reset</button>
    </section>
  </div>
</template>

<style scoped>
.character-control { position: relative; flex: none }
.panel { position: absolute; z-index: 10; left: 0; bottom: calc(100% + .5rem); width: 17rem; padding: .75rem 1rem; display: flex; flex-direction: column; gap: .25rem }
header { margin-bottom: .25rem; font-size: .85rem; font-weight: 500 }
label { display: grid; grid-template-columns: 5rem minmax(0, 1fr) 2.5rem; align-items: center; gap: .5rem; min-height: 2rem; color: var(--muted); font-size: .85rem }
input { width: 100%; margin: 0 }
output { color: var(--fg); text-align: right; font-variant-numeric: tabular-nums }
.reset { align-self: flex-start; margin-top: .5rem }
</style>
