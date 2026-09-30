<script setup lang="ts">
import { t } from '../i18n'
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
let thinkingTimer: ReturnType<typeof setTimeout> | undefined
const thinkingCycle = ref(0)

watch(content, kind => {
  clearTimeout(thinkingTimer)
  if (kind !== 'thinking') return
  const replay = () => {
    if (content.value !== 'thinking') return
    thinkingCycle.value++
    thinkingTimer = setTimeout(replay, 1500)
  }
  thinkingTimer = setTimeout(replay, 1500)
}, { immediate: true })

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

onUnmounted(() => {
  clearTimeout(timer)
  clearTimeout(thinkingTimer)
})
</script>

<template>
  <div ref="element" data-desktop-hit class="speech-bubble" :class="{ 'is-thinking': content === 'thinking' }" :hidden="!visible" role="status" aria-live="polite" :aria-label="content === 'thinking' ? t('Thinking') : undefined">
    <p v-if="content === 'searching'" class="doing">
      <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
      </svg>
      <span>{{ t('Searching…') }}</span>
    </p>
    <span v-else-if="content === 'line'" class="line">{{ text }}</span>
    <span v-else-if="content === 'thinking'" :key="thinkingCycle" class="dots" aria-hidden="true">
      <span v-for="dot in 3" :key="dot" class="dots__dot"><span class="dots__dot-inner" /></span>
    </span>
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
.speech-bubble.is-thinking { display: grid; place-items: center; width: 4.5em; height: calc(1lh + 16px); }
.dots { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(3, auto); justify-content: center; align-content: center; gap: 4px; }
.dots__dot { --size: 4px; position: relative; width: var(--size); height: var(--size); }
.dots__dot:nth-child(1) { --delay: 0s; --y: -150%; --x: calc(var(--size) * 2); }
.dots__dot:nth-child(2) { --delay: .15s; --y: -250%; --x: calc(var(--size) * 2); }
.dots__dot:nth-child(3) { --delay: .3s; --y: -300%; --x: calc(var(--size) * -4); }
.dots__dot-inner { position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform-origin: center bottom; animation: scale1 .6s ease-in-out calc(0s + var(--delay, 0s)) both; }
.dots__dot-inner::after { content: ""; display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 50%; background-color: var(--muted); transform-origin: center bottom; animation: jump .6s ease-in-out calc(.2s + var(--delay, 0s)) both, scale2 .2s ease-out calc(.8s + var(--delay, 0s)) forwards; }
.line, .doing { width: max-content; max-width: min(calc(85vw - 30px), var(--bubble-content-width, 85vw)); animation: appear .25s .2s var(--ease) both; }
.line { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
.doing { display: flex; align-items: center; gap: .5em; color: var(--muted); }
.doing > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.search-icon { flex: none; animation: look 1.6s ease-in-out infinite; }
@keyframes look { 25% { translate: 2px -1px; } 50% { translate: 0 -2px; } 75% { translate: -2px -1px; } }
@keyframes scale1 {
  from { transform: scale(1, 1); }
  20% { transform: scale(1.2, 0.7); }
  60% { transform: scale(0.8, 1.2); }
  to { transform: scale(1, 1); }
}
@keyframes scale2 {
  from, to { transform: scale(1, 1); }
  50% { transform: scale(1.2, 0.7); }
}
@keyframes jump {
  from { left: 0; }
  to { left: var(--x); }
  from, to { transform: translateY(0); }
  50% { transform: translateY(var(--y)); }
}
@keyframes appear { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .speech-bubble { transition-duration: 1ms; }
  .line, .doing { animation: none; }
  .dots__dot-inner, .dots__dot-inner::after, .search-icon { animation: none; }
}
</style>
