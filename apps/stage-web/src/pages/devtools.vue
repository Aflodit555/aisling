<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

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
  <div class="devtools">
    <header class="chrome">
      <span class="brand">Aisling · Devtools</span>
      <RouterLink class="nav-link" to="/">Back to Stage</RouterLink>
    </header>

    <main class="content">
      <section class="panel">
        <h2>Pipeline</h2>
        <ol class="pipeline">
          <li v-for="(step, index) in pipeline" :key="step">
            <span>{{ step }}</span>
            <span v-if="index < pipeline.length - 1" class="arrow">↓</span>
          </li>
        </ol>
        <p class="note">
          Character: <strong>{{ stage.character.name }}</strong> ·
          chat provider: <code>{{ chatProviderId }}</code>
        </p>
      </section>

      <section class="panel">
        <h2>Recent events</h2>
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
  </div>
</template>

<style scoped>
.devtools {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 52px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.brand {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #cfc6ea;
}

.nav-link {
  font-size: 12px;
  color: #6f6889;
  text-decoration: none;
}

.nav-link:hover {
  color: #9d94b8;
}

.content {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(320px, 2fr);
  gap: 16px;
  padding: 20px;
  overflow: auto;
}

.panel {
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background: rgba(13, 11, 22, 0.55);
}

.panel h2 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8f87ad;
}

.pipeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pipeline li {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  color: #e6e0f4;
}

.arrow {
  color: #6f6889;
}

.note {
  margin: 14px 0 0;
  font-size: 13px;
  color: #9d94b8;
}

.note code {
  color: #c9b8f2;
}

.events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.events li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #c9b8f2;
}

.events .muted {
  color: #6f6889;
}

.empty {
  color: #6f6889;
  font-family: inherit;
}
</style>
