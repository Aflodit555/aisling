import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'stage', component: () => import('./pages/index.vue') },
    { path: '/devtools', name: 'devtools', component: () => import('./pages/devtools.vue') },
    {
      path: '/settings',
      component: () => import('./layouts/settings.vue'),
      children: [
        { path: '', name: 'settings', component: () => import('./pages/settings/index.vue') },
        { path: 'consciousness', name: 'settings-consciousness', component: () => import('./pages/settings/consciousness.vue') },
        { path: 'speech', name: 'settings-speech', component: () => import('./pages/settings/speech.vue') },
        { path: 'hearing', name: 'settings-hearing', component: () => import('./pages/settings/hearing.vue') },
        { path: 'vision', name: 'settings-vision', component: () => import('./pages/settings/vision.vue') },
        { path: 'web-search', name: 'settings-web-search', component: () => import('./pages/settings/web-search.vue') },
        { path: 'desktop-awareness', name: 'settings-desktop-awareness', component: () => import('./pages/settings/desktop-awareness.vue') },
      ],
    },
  ],
})
