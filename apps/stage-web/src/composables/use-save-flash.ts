import { ref } from 'vue'

/** A short-lived "Saved." state, distinct from Test feedback. */
export function useSaveFlash(): { saved: ReturnType<typeof ref<boolean>>; flashSaved: () => void } {
  const saved = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function flashSaved(): void {
    saved.value = true
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      saved.value = false
    }, 2000)
  }

  return { saved, flashSaved }
}
