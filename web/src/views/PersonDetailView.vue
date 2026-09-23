<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { ArrowLeft, HomeFilled, Grid, DataAnalysis, MagicStick } from '@element-plus/icons-vue'
import { api } from '../api'
import { useLibraryStore } from '../stores/library'
import Logo from '../components/Logo.vue'
import MovieCard from '../components/MovieCard.vue'
import MovieDetail from '../components/MovieDetail.vue'

const route = useRoute()
const router = useRouter()
const store = useLibraryStore()
const { filters } = storeToRefs(store)

const loading = ref(false)
const data = ref(null)
const bioExpanded = ref(false)
const creditTab = ref('all')
const creditSort = ref('date')
const detailVisible = ref(false)
const detailMovie = ref(null)

const name = computed(() => String(route.query.name || '').trim())

async function load() {
  if (!name.value) return
  loading.value = true
  bioExpanded.value = false
  creditTab.value = 'all'
  try {
    data.value = await api.personDetail(name.value)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

watch(name, () => { if (name.value) load() }, { immediate: true })

const person = computed(() => data.value?.person || {})
const library = computed(() => data.value?.library || { directed: [], acted: [], count: 0 })
const credits = computed(() => data.value?.credits || [])

const libraryMovies = computed(() => {
  const seen = new Set()
  return [...library.value.directed, ...library.value.acted].filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
})

const bioClamped = computed(() => (person.value.biography || '').length > 260)

const filteredCredits = computed(() => {
  let list = [...credits.value]
  if (creditTab.value === 'crew') list = list.filter(c => c.type === 'crew')
  else if (creditTab.value === 'cast') list = list.filter(c => c.type === 'cast')
  else if (creditTab.value === 'director') {
    list = list.filter(c => c.type === 'crew' && c.roles.includes('导演'))
  }
  if (creditSort.value === 'pop') list.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
  return list
})

// 有执导作品时才显示「导演」页签
const hasDirectorCredits = computed(() =>
  credits.value.some(c => c.type === 'crew' && c.roles.includes('导演'))
)

const personMetaLine = computed(() => {
  const parts = []
  if (person.value.known_for) parts.push(person.value.known_for)
  if (person.value.birthday) parts.push(person.value.birthday)
  if (person.value.place_of_birth) parts.push(person.value.place_of_birth)
  return parts.join(' · ')
})

function openDetail(movie) {
  detailMovie.value = movie
  detailVisible.value = true
}

async function onOpenMovie(id) {
  try {
    detailMovie.value = await api.movie(id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function playMovie(movie) {
  try {
    await api.playMovie(movie.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function goPerson(n) {
  detailVisible.value = false
  router.push({ path: '/person', query: { name: n } })
}

function filterInLibrary(role) {
  if (role === 'director') store.setFilters({ director: name.value, actor: '' })
  else store.setFilters({ actor: name.value, director: '' })
  router.push('/movies')
}

function onUpdated(movie) {
  detailMovie.value = movie
  load()
}
</script>

<template>
  <div class="person-page">
    <header class="topbar">
      <div class="brand" @click="router.push('/')">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-tooltip content="返回上一页" placement="bottom">
        <el-button circle @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="首页" placement="bottom">
        <el-button circle @click="router.push('/')">
          <el-icon><HomeFilled /></el-icon>
        </el-button>
      </el-tooltip>
      <div class="topbar-spacer"></div>
      <el-tooltip content="电影库" placement="bottom">
        <el-button circle @click="router.push('/movies')">
          <el-icon><Grid /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="统计面板" placement="bottom">
        <el-button circle @click="router.push('/stats')">
          <el-icon><DataAnalysis /></el-icon>
        </el-button>
      </el-tooltip>
    </header>

    <main v-loading="loading" class="person-main">
      <template v-if="data">
        <!-- 人物头部 -->
        <div class="hero">
          <img v-if="person.photo_url" class="avatar" :src="person.photo_url" :alt="person.name" />
          <div v-else class="avatar fallback">{{ (person.name || '?')[0] }}</div>
          <div class="hero-info">
            <h1 class="p-name">{{ person.name }}</h1>
            <div v-if="personMetaLine" class="p-meta">{{ personMetaLine }}</div>
            <div class="p-count">
              你的放映厅里共有
              <b class="font-display num">{{ library.count }}</b>
              部{{ library.directed.length && library.acted.length ? '相关' : '' }}作品
              <template v-if="library.directed.length">
                （执导 <b class="font-display num">{{ library.directed.length }}</b>
              </template>
              <template v-if="library.acted.length">
                {{ library.directed.length ? ' / ' : '（' }}出演 <b class="font-display num">{{ library.acted.length }}</b>）
              </template>
            </div>
            <p
              v-if="person.biography"
              class="p-bio"
              :class="{ expanded: bioExpanded }"
              @click="bioClamped ? (bioExpanded = !bioExpanded) : null"
            >{{ person.biography }}</p>
            <el-button v-if="bioClamped" link type="primary" size="small" class="bio-toggle" @click="bioExpanded = !bioExpanded">
              {{ bioExpanded ? '收起' : '展开全部' }}
            </el-button>
            <div v-if="!person.has_tmdb && !loading" class="no-tmdb">未能获取 TMDB 资料，仅展示放映厅内的作品</div>
          </div>
        </div>

        <!-- 放映厅藏品 -->
        <section v-if="libraryMovies.length" class="lib-section">
          <div class="sec-head">
            <h3 class="sec-title">放映厅里的作品</h3>
            <el-button
              v-if="library.directed.length"
              link
              type="primary"
              @click="filterInLibrary('director')"
            >在影库中筛选执导影片</el-button>
            <el-button
              v-else-if="library.acted.length"
              link
              type="primary"
              @click="filterInLibrary('actor')"
            >在影库中筛选出演影片</el-button>
          </div>
          <div class="lib-grid">
            <MovieCard v-for="m in libraryMovies" :key="m.id" :movie="m" @open="openDetail" @play="playMovie" />
          </div>
        </section>

        <!-- 影史作品 -->
        <section v-if="credits.length" class="credits-section">
          <div class="sec-head">
            <h3 class="sec-title">影史作品<span class="sec-sub">（{{ credits.length }} 部，金框为已入库）</span></h3>
            <div class="credits-ctrl">
              <el-radio-group v-model="creditTab" size="small">
                <el-radio-button value="all">全部</el-radio-button>
                <el-radio-button v-if="hasDirectorCredits" value="director">导演</el-radio-button>
                <el-radio-button value="crew">幕后</el-radio-button>
                <el-radio-button value="cast">出演</el-radio-button>
              </el-radio-group>
              <el-radio-group v-model="creditSort" size="small">
                <el-radio-button value="date">按年代</el-radio-button>
                <el-radio-button value="pop">按热度</el-radio-button>
              </el-radio-group>
            </div>
          </div>
          <div class="credit-wall">
            <div
              v-for="c in filteredCredits"
              :key="c.tmdb_id + (c.roles[0] || '')"
              class="credit-card"
              :class="{ owned: c.in_library }"
              @click="c.in_library && onOpenMovie(c.movie_id)"
            >
              <div class="credit-poster">
                <img v-if="c.poster" :src="c.poster" :alt="c.title" loading="lazy" />
                <div v-else class="credit-noimg font-display">{{ c.year || '?' }}</div>
                <span v-if="c.in_library" class="owned-dot" title="已在放映厅"></span>
              </div>
              <div class="credit-title" :title="c.title">{{ c.title }}</div>
              <div class="credit-sub">
                <span class="font-display yr">{{ c.year || '—' }}</span>
                <span v-if="c.roles.length" class="role">{{ c.roles.join(' / ') }}</span>
              </div>
            </div>
          </div>
        </section>

        <el-empty v-if="!loading && !libraryMovies.length && !credits.length" description="放映厅里没有这位人物的作品" />
      </template>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" @open-movie="onOpenMovie" @open-person="goPerson" />
  </div>
</template>

<style scoped>
.person-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 28px;
  background: rgba(16, 14, 12, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #241d16;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  white-space: nowrap;
  cursor: pointer;
  color: #ece3d2;
}

.topbar-spacer { flex: 1; }

.logo {
  width: 26px;
  height: 26px;
  color: #e0a458;
}

.person-main {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 30px 28px 48px;
  box-sizing: border-box;
  min-height: 300px;
}

/* ---------- 人物头部 ---------- */
.hero {
  display: flex;
  gap: 34px;
  margin-bottom: 38px;
}

.avatar {
  width: 168px;
  height: 168px;
  border-radius: 50%;
  object-fit: cover;
  background: #221b14;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px #2c231b;
  flex-shrink: 0;
}

.avatar.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: #9a8b74;
}

.hero-info {
  min-width: 0;
  flex: 1;
}

.p-name {
  margin: 8px 0 4px;
  font-size: 34px;
  line-height: 1.25;
  color: #ece3d2;
}

.p-meta {
  font-size: 14px;
  color: #9a8b74;
}

.p-count {
  margin-top: 10px;
  font-size: 14px;
  color: #cfc2ac;
}

.p-count .num {
  font-size: 20px;
  color: #e0a458;
  margin: 0 2px;
}

.p-bio {
  margin: 14px 0 0;
  font-size: 13.5px;
  line-height: 1.9;
  color: #cfc2ac;
  max-width: 760px;
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  cursor: default;
}

.p-bio.expanded {
  display: block;
  -webkit-line-clamp: unset;
  max-height: 420px;
  overflow-y: auto;
}

.bio-toggle {
  margin-top: 4px;
}

.no-tmdb {
  margin-top: 12px;
  font-size: 12px;
  color: #7d7160;
}

/* ---------- 区块 ---------- */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 16px;
  border-bottom: 1px solid #241d16;
  padding-bottom: 10px;
  flex-wrap: wrap;
}

.sec-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #ece3d2;
}

.sec-sub {
  font-size: 13px;
  font-weight: 400;
  color: #9a8b74;
}

.sec-head :deep(.el-button + .el-button) {
  margin-left: 0;
}

.sec-head :deep(.el-button) {
  margin-left: auto;
}

.credits-ctrl {
  margin-left: auto;
  display: flex;
  gap: 10px;
}

/* ---------- 放映厅藏品 ---------- */
.lib-section {
  margin-bottom: 40px;
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 20px 14px;
}

@media (max-width: 1100px) { .lib-grid { grid-template-columns: repeat(6, 1fr); } }
@media (max-width: 760px) { .lib-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 520px) { .lib-grid { grid-template-columns: repeat(3, 1fr); } }

/* ---------- 影史作品 ---------- */
.credit-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 18px 14px;
}

.credit-card {
  cursor: default;
}

.credit-card.owned {
  cursor: pointer;
}

.credit-poster {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 7px;
  overflow: hidden;
  background: #221b14;
  outline: 1px solid rgba(44, 35, 27, 0.7);
  outline-offset: -1px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.credit-card:hover .credit-poster {
  transform: translateY(-3px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
}

.credit-card.owned .credit-poster {
  outline: 1px solid rgba(224, 164, 88, 0.55);
}

.credit-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.credit-noimg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  color: #4e4438;
}

.owned-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #e0a458;
  box-shadow: 0 0 8px rgba(224, 164, 88, 0.8);
}

.credit-title {
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: #ece3d2;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.8em;
}

.credit-sub {
  font-size: 11.5px;
  color: #7d7160;
  display: flex;
  gap: 6px;
  align-items: baseline;
  white-space: nowrap;
  overflow: hidden;
}

.credit-sub .yr {
  font-size: 13px;
  color: #cfc2ac;
}

.credit-sub .role {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 760px) {
  .hero {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .p-count,
  .p-meta {
    justify-content: center;
  }

  .credits-ctrl {
    margin-left: 0;
    width: 100%;
  }
}

/* ---------- 移动端顶栏 ---------- */
@media (max-width: 700px) {
  .topbar {
    flex-wrap: wrap;
    padding: 10px 12px;
    gap: 8px;
  }
  .topbar .search,
  .topbar .sort,
  .topbar .pick-btn {
    width: auto;
    flex: 1 1 auto;
  }
  .topbar .search { min-width: 140px; order: 10; flex-basis: 100%; }
  .gsearch { width: 100% !important; order: 10; flex-basis: 100%; }
  .spacer, .topbar-spacer { flex: 1 1 auto; }
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .hero { flex-direction: column; align-items: center; text-align: center; gap: 18px; }
  .avatar { width: 120px; height: 120px; }
  .hero-info { display: flex; flex-direction: column; align-items: center; }
  .p-bio { text-align: left; }
  .credits-ctrl { margin-left: 0; flex-wrap: wrap; }
}
</style>
