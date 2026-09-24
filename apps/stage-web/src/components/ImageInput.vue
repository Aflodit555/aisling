<script setup lang="ts">
import { ref } from 'vue'

import { readImageFile, validateImageFile, type SelectedImage } from '../image/file'
import Icon from './Icon.vue'

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
    <div v-if="image" class="preview">
      <img :src="image.previewUrl" alt="attachment" />
      <button type="button" class="remove" title="Remove image" aria-label="Remove image" @click="emit('remove')">
        <Icon name="close" :size="12" />
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <button type="button" class="icon-btn" title="Attach an image" aria-label="Attach an image" @click="pick">
      <Icon name="image" />
    </button>
  </div>
</template>

<style scoped>
/* Column that grows upward from the button: the row keeps its bottom line and the message list gives up the height.
   Width stays one button wide; the preview and error overflow into the empty space above the other round buttons. */
.image-input { display: flex; flex-direction: column; align-items: flex-start; gap: .5rem; flex: none; width: 2.5rem }
.preview { position: relative; width: max-content; animation: rise .2s var(--ease) }
.preview img { display: block; max-width: 160px; max-height: 120px; border: 1px solid var(--rule); border-radius: 6px }
.remove { position: absolute; top: -.5rem; right: -.5rem; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--rule); border-radius: 50%; background: var(--bg); color: var(--fg); transition: background .15s, transform .1s }
.remove:hover { background: var(--tonal) }
.remove:active { transform: scale(.94) }
.error { width: max-content; max-width: 20rem; font-size: .75rem; color: var(--danger) }
</style>
