import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import { applySavedTheme } from './theme'
import './styles/main.css'

applySavedTheme()

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
