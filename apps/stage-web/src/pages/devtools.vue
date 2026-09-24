<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useSettingsStore } from '../stores/settings'
import { useStageStore } from '../stores/stage'

const stage = useStageStore()
const settings = useSettingsStore()
const { events } = storeToRefs(stage)

const pipeline = ['Stimulus', 'Runtime', 'Character', 'Provider', 'Output']

const chatProviderId = computed(() => settings.activeChatProvider?.id ?? 'none')

const recentEvents = computed(() => [...events.value].slice(-30).reverse())
</script>

<template>
  <main class="devtools">
    <section>
      <h3>Pipeline</h3>
      <ol class="pipeline">
        <li v-for="(step, index) in pipeline" :key="step" :style="{ '--i': index }">
          <span class="step">{{ index + 1 }}</span>{{ step }}
        </li>
      </ol>
      <p class="note">
        Character: <strong>{{ stage.character.name }}</strong> ·
        chat provider: <code>{{ chatProviderId }}</code>
      </p>
    </section>

    <section>
      <h3>Recent events</h3>
      <ol class="events">
        <li v-for="(event, index) in recentEvents" :key="index">
          <code>{{ event.type }}</code>
          <span v-if="'turnId' in event" class="muted">{{ event.turnId }}</span>
        </li>
        <li v-if="recentEvents.length === 0" class="empty">
          No events yet — send a message on the Stage.
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped>
.devtools { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 0 1.5rem 1.5rem; display: grid; grid-template-columns: minmax(12rem, 1fr) minmax(20rem, 2fr); gap: 2rem; align-content: start }
h3 { font-size: .85rem; font-weight: 500; color: var(--muted); margin: 0 0 .5rem }
ol { list-style: none; margin: 0; padding: 0 }

.pipeline { display: flex; flex-direction: column; gap: 4px }
.pipeline li { display: flex; align-items: center; gap: .75rem; padding: .5rem 1rem; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; animation: rise .3s var(--ease) both; animation-delay: calc(var(--i, 0) * 25ms) }
.step { color: var(--muted); font: .75rem var(--mono); font-variant-numeric: tabular-nums }
.note { margin-top: .75rem; color: var(--muted); font-size: .85rem }
.note strong { color: var(--fg); font-weight: 500 }
.note code { font-family: var(--mono); color: var(--link) }

.events { font-size: .85rem }
.events li { display: flex; justify-content: space-between; gap: .75rem; padding: .4rem 0; border-bottom: 1px solid var(--rule) }
.events code, .events .muted { font-family: var(--mono) }
.events code { color: var(--fg) }
.events .muted { min-width: 0; color: var(--muted); overflow-wrap: anywhere; text-align: right }
.events .empty { padding: 0; border: none; color: var(--muted) }

@media (max-width: 40rem) { .devtools { grid-template-columns: minmax(0, 1fr) } }
</style>
