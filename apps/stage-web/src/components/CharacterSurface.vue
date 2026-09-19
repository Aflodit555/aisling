<script setup lang="ts">
defineProps<{
  name: string
  active: boolean
  speaking?: boolean
  searching?: boolean
  looking?: boolean
}>()
</script>

<template>
  <section class="surface">
    <div class="presence" :class="{ 'is-active': active || speaking || searching || looking }">
      <div class="halo" />
      <div class="avatar">{{ name.slice(0, 1) }}</div>
    </div>
    <h1 class="name">{{ name }}</h1>
    <p class="status">
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
  </section>
</template>

<style scoped>
.surface {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 48px 24px;
  min-width: 0;
}

.presence {
  position: relative;
  display: grid;
  place-items: center;
  width: 220px;
  height: 220px;
}

.halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 42%, rgba(167, 139, 250, 0.55), rgba(167, 139, 250, 0.08) 60%, transparent 72%);
  filter: blur(2px);
  transition: transform 0.6s ease, opacity 0.6s ease;
}

.presence.is-active .halo {
  transform: scale(1.12);
  animation: breathe 2.2s ease-in-out infinite;
}

.avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: linear-gradient(150deg, #1e1b2e, #2a2440);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  color: #e6e0f4;
  font-size: 52px;
  font-weight: 500;
  user-select: none;
}

.name {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #efeaf8;
}

.status {
  margin: 0;
  font-size: 14px;
  color: #9d94b8;
}

@keyframes breathe {
  0%, 100% {
    transform: scale(1.08);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.18);
    opacity: 1;
  }
}
</style>
