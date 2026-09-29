<script setup lang="ts">
defineProps<{
  name: 'image' | 'plus' | 'trash' | 'chevron' | 'send' | 'close' | 'character'
  size?: number
}>()
</script>

<template>
  <svg
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'image'">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
    </template>
    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />
    <path v-else-if="name === 'trash'" d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path v-else-if="name === 'chevron'" d="M6 9l6 6 6-6" />
    <path v-else-if="name === 'send'" d="M12 19V5M5 12l7-7 7 7" />
    <path v-else-if="name === 'close'" d="M18 6L6 18M6 6l12 12" />
    <template v-else-if="name === 'character'">
      <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" /><circle cx="12" cy="9" r="3" /><path d="M7.5 18c.5-3 2-4.5 4.5-4.5s4 1.5 4.5 4.5" />
    </template>
  </svg>
</template>
