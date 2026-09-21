import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/movies', name: 'movies', component: () => import('../views/MoviesView.vue') },
    { path: '/person', name: 'person', component: () => import('../views/PersonDetailView.vue') },
    { path: '/blindbox', name: 'blindbox', component: () => import('../views/BlindBoxView.vue') },
    { path: '/stats', name: 'stats', component: () => import('../views/StatsView.vue') }
  ],
  scrollBehavior(to, from, saved) {
    return saved || { top: 0 }
  }
})

export default router
