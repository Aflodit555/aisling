<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  pending: boolean
  searching: boolean
  speaking: boolean
}>()

const element = ref<HTMLElement>()
const visible = ref(false)
const content = computed(() => props.searching ? 'searching' : props.text ? 'line' : props.pending ? 'thinking' : 'hidden')
let timer: ReturnType<typeof setTimeout> | undefined

watch([content, () => props.text], (_, __, onCleanup) => {
  const bubble = element.value
  if (bubble && !bubble.hidden) {
    // Hold the current size, including a transition in progress, before Vue changes the content.
    const { width, height } = getComputedStyle(bubble)
    Object.assign(bubble.style, { transition: 'none', width, height })
  }
  visible.value = content.value !== 'hidden'
  let cancelled = false
  onCleanup(() => { cancelled = true })
  void nextTick(() => {
    if (!bubble || cancelled) return
    void bubble.offsetWidth
    Object.assign(bubble.style, { transition: '', width: '', height: '' })
  })
}, { immediate: true })

watch([content, () => props.text, () => props.pending, () => props.speaking],
  ([kind, text, pending, speaking], previous) => {
    clearTimeout(timer)
    // Streaming and voice generation also hold the line until they finish.
    if (kind !== 'line' || pending || speaking) return
    const delay = previous[3] ? 1500 : 2000 + text.length * 150
    timer = setTimeout(() => { visible.value = false }, delay)
  }, { immediate: true })

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div ref="element" data-desktop-hit class="speech-bubble" :hidden="!visible" role="status" aria-live="polite" :aria-label="content === 'thinking' ? '正在思考' : undefined">
    <p v-if="content === 'searching'" class="doing">
      <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
      </svg>
      <span>正在搜索…</span>
    </p>
    <span v-else-if="content === 'line'" class="line">{{ text }}</span>
  </div>
</template>

<style scoped>
.speech-bubble {
  position: absolute;
  inset: 6px 0 auto;
  width: fit-content;
  height: fit-content;
  max-width: 85%;
  margin-inline: auto;
  padding: 7px 14px;
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 2px 10px rgb(0 0 0 / .18);
  font-size: 15px;
  line-height: 1.5;
  interpolate-size: allow-keywords;
  overflow: hidden;
  transition: opacity .2s var(--ease), translate .2s var(--ease), scale .2s var(--ease), display .2s allow-discrete,
    width .35s var(--ease), height .35s var(--ease);
  @starting-style { opacity: 0; translate: 0 6px; scale: .97; }
}
.speech-bubble[hidden] { display: none !important; opacity: 0; translate: 0 6px; scale: .97; }
.speech-bubble:empty { display: grid; place-items: center; width: 4.5em; height: calc(1lh + 16px); }
.speech-bubble:empty::before { content: ""; width: 4px; height: 4px; border-radius: 50%; background: currentColor; box-shadow: -9px 0 currentColor, 9px 0 currentColor; animation: waiting .8s ease-in-out infinite alternate; }
.line, .doing { width: max-content; max-width: calc(85vw - 30px); animation: appear .25s .2s var(--ease) both; }
.line { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
.doing { display: flex; align-items: center; gap: .5em; color: var(--muted); }
.doing > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.search-icon { flex: none; animation: look 1.6s ease-in-out infinite; }
@keyframes look { 25% { translate: 2px -1px; } 50% { translate: 0 -2px; } 75% { translate: -2px -1px; } }
@keyframes waiting { from { opacity: .25; } }
@keyframes appear { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .speech-bubble { transition-duration: 1ms; }
  .line, .doing { animation: none; }
  .speech-bubble:empty::before, .search-icon { animation: none; }
}
</style>
