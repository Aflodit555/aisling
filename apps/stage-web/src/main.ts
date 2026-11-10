import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import { loadLegacyMemory } from './stores/stage'
import { applySavedTheme } from './theme'
import './styles/main.css'

applySavedTheme()

async function mount() {
  const desktop = window.aislingDesktop
  if (!desktop?.noteFormation && !desktop?.noteRecall && (desktop?.reflectionStorage || desktop?.memoryOrganization)) await loadLegacyMemory()
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

void mount().catch(error => {
  console.error('Stage startup failed', error)
  const root = document.querySelector('#app')
  if (root) root.textContent = 'Aisling could not start. Please restart the app.'
})
