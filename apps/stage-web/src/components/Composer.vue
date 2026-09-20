<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'send', text: string): void
}>()

const draft = ref('')

function submit(): void {
  const text = draft.value.trim()
  if (!text || props.disabled)
    return

  emit('send', text)
  draft.value = ''
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      v-model="draft"
      rows="1"
      placeholder="Say something to Aisling…"
      :disabled="disabled"
      @keydown.enter.exact.prevent="submit"
    />
    <button type="submit" :disabled="disabled || !draft.trim()">Send</button>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

textarea {
  resize: none;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  height: 44px;
  min-height: 44px;
  max-height: 44px;
  overflow-y: auto;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #161329;
  color: #e6e0f4;
  font: inherit;
  font-size: 15px;
  line-height: 22px;
}

textarea:focus {
  outline: none;
  border-color: rgba(167, 139, 250, 0.6);
}

button {
  align-self: flex-end;
  padding: 9px 20px;
  border: none;
  border-radius: 10px;
  background: #6d5ac4;
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
