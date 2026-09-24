import { resolvePersistentStorage } from './storage/desktop-storage'

const THEME_KEY = 'aisling.theme'

/** Restores a manual light/dark override; without one the Stage follows the system. */
export function applySavedTheme(): void {
  try {
    const saved = resolvePersistentStorage().getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark')
      document.documentElement.dataset.theme = saved
  }
  catch {
    // Storage unavailable: follow the system theme.
  }
}

export function toggleTheme(): void {
  const html = document.documentElement
  const current = html.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const next = current === 'dark' ? 'light' : 'dark'
  html.dataset.theme = next
  try {
    resolvePersistentStorage().setItem(THEME_KEY, next)
  }
  catch {
    // Keep the in-memory choice for this session.
  }
}
