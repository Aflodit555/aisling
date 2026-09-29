<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  options: { value: string, label: string }[]
  label: string
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const picker = ref<HTMLDetailsElement>()
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? props.placeholder ?? '')

function choose(value: string): void {
  emit('update:modelValue', value)
  if (picker.value) picker.value.open = false
}

function closeOutside(event: PointerEvent): void {
  if (picker.value && !picker.value.contains(event.target as Node))
    picker.value.open = false
}

onMounted(() => document.addEventListener('pointerdown', closeOutside))
onUnmounted(() => document.removeEventListener('pointerdown', closeOutside))
</script>

<template>
  <details ref="picker" class="settings-picker" @keydown.esc="picker && (picker.open = false)">
    <summary :aria-label="`${label}: ${selected}`">{{ selected }}</summary>
    <div class="pop options">
      <button v-for="option in options" :key="option.value" type="button" :aria-current="modelValue === option.value ? 'true' : undefined" @click="choose(option.value)">{{ option.label }}</button>
    </div>
  </details>
</template>

<style scoped>
.settings-picker { position: relative; justify-self: start; min-width: 8rem; color: var(--muted) }
.settings-picker summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .4rem .25rem; cursor: pointer; list-style: none; white-space: nowrap }
.settings-picker summary::-webkit-details-marker { display: none }
.settings-picker summary::after { content: ''; width: .4rem; height: .4rem; flex: none; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-.15rem) rotate(45deg) }
.settings-picker summary:hover, .settings-picker[open] summary { color: var(--fg) }
.settings-picker .options { position: absolute; z-index: 2; top: calc(100% + .25rem); left: 0; min-width: 100%; padding: .2rem; border-radius: 4px }
.settings-picker .options button { display: block; width: 100%; padding: .4rem .6rem; border: 0; border-radius: 3px; background: none; color: var(--fg); font: inherit; text-align: left; white-space: nowrap; cursor: pointer }
.settings-picker .options button:hover, .settings-picker .options button:focus-visible { background: var(--hover) }
</style>
