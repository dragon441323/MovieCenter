import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { api } from '../api'

export const useLibraryStore = defineStore('library', {
  state: () => ({
    movies: [],
    total: 0,
    page: 1,
    pageSize: 18,
    loading: false,
    meta: { categories: [], years: [], tags: [], stats: { total: 0, missing: 0, watched: 0, total_size: 0 } },
    directors: [],
    actors: [],
    directorPhotos: {},
    actorPhotos: {},
    scanPaths: [],
    scanning: false,
    scanState: null,
    filters: { q: '', category: '', tags: [], year: null, favorite: false, watched: '', myRating: '', director: '', actor: '', top250: false, sort: 'rating', order: 'desc' }
  }),
  actions: {
    async fetchMovies() {
      this.loading = true
      try {
        const f = this.filters
        const params = { page: this.page, page_size: this.pageSize, sort: f.sort, order: f.order }
        if (f.q) params.q = f.q
        if (f.category) params.category = f.category
        if (f.tags.length) params.tags = f.tags.join(',')
        if (f.year != null) params.year = f.year
        if (f.favorite) params.favorite = true
        if (f.watched === 'watched') params.watched = true
        else if (f.watched === 'unwatched') params.watched = false
        if (f.myRating === 'none') params.unrated = true
        else if (f.myRating) {
          const dash = f.myRating.indexOf('-')
          params.my_min = f.myRating.slice(0, dash)
          const max = f.myRating.slice(dash + 1)
          if (max) params.my_max = max
        }
        if (f.director) params.director = f.director
        if (f.actor) params.actor = f.actor
        if (f.top250) params.top250 = true
        const data = await api.movies(params)
        this.movies = data.items
        this.total = data.total
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.loading = false
      }
    },
    async fetchMeta() {
      try {
        this.meta = await api.meta()
      } catch {}
    },
    async fetchDirectors() {
      try {
        this.directors = (await api.directors()).items
      } catch {}
    },
    async fetchActors() {
      try {
        this.actors = (await api.actors()).items
      } catch {}
    },
    async ensurePersonPhotos(mapKey, list) {
      const map = this[mapKey]
      const missing = list.filter(x => !map[x.name])
      if (!missing.length) return
      const names = missing.map(x => x.name)
      for (let i = 0; i < names.length; i += 80) {
        try {
          const r = await api.personPhotos(names.slice(i, i + 80))
          for (const item of r.items) {
            if (item.photo_url) map[item.name] = item.photo_url
          }
        } catch {}
      }
    },
    ensureDirectorPhotos() {
      return this.ensurePersonPhotos('directorPhotos', this.directors)
    },
    ensureActorPhotos() {
      return this.ensurePersonPhotos('actorPhotos', this.actors)
    },
    async fetchScanPaths() {
      try {
        this.scanPaths = await api.scanPaths()
      } catch {}
    },
    async setFilters(patch) {
      Object.assign(this.filters, patch)
      this.page = 1
      await this.fetchMovies()
    },
    async setPage(p) {
      this.page = p
      await this.fetchMovies()
    },
    async triggerAndAwaitScan() {
      if (this.scanning) return
      this.scanning = true
      try {
        try {
          await api.triggerScan()
        } catch (e) {
          if (!e.message.includes('进行中')) throw e
        }
        while (true) {
          await new Promise(r => setTimeout(r, 1200))
          const st = await api.scanStatus()
          this.scanState = st
          if (!st.scanning && st.lastResult) break
        }
        await Promise.all([this.fetchMovies(), this.fetchMeta()])
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.scanning = false
      }
    }
  }
})
