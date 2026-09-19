<script setup lang="ts">
import { ref } from 'vue'

import { readImageFile, validateImageFile, type SelectedImage } from '../image/file'

defineProps<{ image: SelectedImage | undefined }>()

const emit = defineEmits<{
  (event: 'select', image: SelectedImage): void
  (event: 'remove'): void
}>()

const input = ref<HTMLInputElement>()
const error = ref('')

function pick(): void {
  input.value?.click()
}

async function onChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file)
    return

  const invalid = validateImageFile(file)
  if (invalid) {
    error.value = invalid
    return
  }
  error.value = ''
  emit('select', await readImageFile(file))
}
</script>

<template>
  <div class="image-input">
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onChange" />
    <button type="button" class="btn" title="Attach an image" @click="pick">🖼️</button>

    <div v-if="image" class="preview">
      <img :src="image.previewUrl" alt="attachment" />
      <button type="button" class="remove" title="Remove image" @click="emit('remove')">×</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.image-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c1930;
  color: #e6e0f4;
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.preview {
  position: relative;
  display: inline-block;
  width: fit-content;
}

.preview img {
  max-width: 160px;
  max-height: 120px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.remove {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: #6d5ac4;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.error {
  margin: 0;
  font-size: 12px;
  color: #f6c2c2;
}
</style>
