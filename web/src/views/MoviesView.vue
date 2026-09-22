<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Film, Search, Setting, StarFilled, Refresh, Close, DataAnalysis, HomeFilled, MagicStick, Present, Notebook } from '@element-plus/icons-vue'
import { useLibraryStore } from '../stores/library'
import { api } from '../api'
import { formatSize } from '../utils'
import Logo from '../components/Logo.vue'
import MovieCard from '../components/MovieCard.vue'
import MovieDetail from '../components/MovieDetail.vue'
import SettingsDialog from '../components/SettingsDialog.vue'

const store = useLibraryStore()
const router = useRouter()
const { movies, total, page, pageSize, loading, meta, filters, scanPaths, scanning } = storeToRefs(store)

const searchText = ref('')
const sortValue = ref(`${filters.value.sort}:${filters.value.order}`)
const detailVisible = ref(false)
const detailMovie = ref(null)
const settingsVisible = ref(false)
const top250Count = ref(0)
const picking = ref(false)

let searchTimer = null
watch(searchText, v => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setFilters({ q: v.trim() }), 350)
})

const sortOptions = [
  { label: '最近添加', value: 'created_at:desc' },
  { label: '标题', value: 'title:asc' },
  { label: '年份', value: 'year:desc' },
  { label: 'TMDB 评分', value: 'rating:desc' },
  { label: '我的评分', value: 'my_rating:desc' },
  { label: '豆瓣 Top 250', value: 'douban_rank:asc' }
]

function onSortChange(v) {
  const [sort, order] = v.split(':')
  store.setFilters({ sort, order })
}

const categoryModel = ref(filters.value.category)
watch(categoryModel, v => store.setFilters({ category: v || '' }))

const countryModel = ref(filters.value.country)
watch(countryModel, v => store.setFilters({ country: v || '' }))

const qualityModel = ref(filters.value.quality)
watch(qualityModel, v => store.setFilters({ quality: v || '' }))

const tagsModel = ref([...filters.value.tags])
watch(tagsModel, v => store.setFilters({ tags: v || [] }))

const yearModel = ref(filters.value.year)
watch(yearModel, v => store.setFilters({ year: v ?? null }))

const watchedModel = ref(filters.value.watched)
watch(watchedModel, v => store.setFilters({ watched: v || '' }))

const myRatingModel = ref(filters.value.myRating)
watch(myRatingModel, v => store.setFilters({ myRating: v || '' }))

const view = ref('movies')
const browseFrom = ref(null)
const directorSearch = ref('')
const actorSearch = ref('')
const directorLoading = ref(false)
const actorLoading = ref(false)

// 人物列表分页：每页固定 4 行（行数 × 实际列数），翻页/搜索时只拉当前页数据与照片
const PERSON_ROWS = 4
const personCols = ref(5)

// 网格 minmax(230px,1fr) auto-fill 的列数 = floor((宽+gap) / (230+gap))
let activeGridEl = null
let personResizeObserver = null
function measureCols() {
  const el = activeGridEl
  if (!el) return
  const w = el.clientWidth
  if (w > 0) personCols.value = Math.max(2, Math.floor((w + 20) / 250))
}

const personPageSize = computed(() => personCols.value * PERSON_ROWS)

// 当前活动的人物网格容器（导演/演员两个视图切换共用）
function setPersonGridRef(el) {
  if (activeGridEl === el) return
  if (personResizeObserver && activeGridEl) personResizeObserver.unobserve(activeGridEl)
  activeGridEl = el
  if (el) {
    measureCols()
    if (personResizeObserver) personResizeObserver.observe(el)
  }
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    personResizeObserver = new ResizeObserver(() => {
      const old = personPageSize.value
      measureCols()
      if (old !== personPageSize.value) {
        directorPage.value = 1
        actorPage.value = 1
        if (view.value === 'directors') loadDirectors()
        else if (view.value === 'actors') loadActors()
      }
    })
    if (activeGridEl) personResizeObserver.observe(activeGridEl)
  }
})
onBeforeUnmount(() => {
  if (personResizeObserver) personResizeObserver.disconnect()
})

const directorPage = ref(1)
const actorPage = ref(1)
let directorSearchTimer = null
let actorSearchTimer = null

async function loadDirectors() {
  directorLoading.value = true
  try {
    await store.fetchDirectors({
      page: directorPage.value,
      page_size: personPageSize.value,
      q: directorSearch.value.trim() || undefined
    })
  } finally {
    directorLoading.value = false
  }
  store.ensureDirectorPhotos()
}

async function loadActors() {
  actorLoading.value = true
  try {
    await store.fetchActors({
      page: actorPage.value,
      page_size: personPageSize.value,
      q: actorSearch.value.trim() || undefined
    })
  } finally {
    actorLoading.value = false
  }
  store.ensureActorPhotos()
}

// 搜索防抖：300ms 后请求服务端（同时重置回第 1 页）
watch(directorSearch, () => {
  if (view.value !== 'directors') return
  clearTimeout(directorSearchTimer)
  directorSearchTimer = setTimeout(() => {
    directorPage.value = 1
    loadDirectors()
  }, 300)
})

watch(actorSearch, () => {
  if (view.value !== 'actors') return
  clearTimeout(actorSearchTimer)
  actorSearchTimer = setTimeout(() => {
    actorPage.value = 1
    loadActors()
  }, 300)
})

function changeDirectorPage(p) {
  directorPage.value = p
  loadDirectors()
}

function changeActorPage(p) {
  actorPage.value = p
  loadActors()
}

function toggleDirectors() {
  if (view.value === 'directors') view.value = 'movies'
  else {
    view.value = 'directors'
    directorPage.value = 1
    directorSearch.value = ''
    loadDirectors()
  }
}

function toggleActors() {
  if (view.value === 'actors') view.value = 'movies'
  else {
    view.value = 'actors'
    actorPage.value = 1
    actorSearch.value = ''
    loadActors()
  }
}

function backToMovies() {
  const had = filters.value.director || filters.value.actor
  view.value = 'movies'
  browseFrom.value = null
  if (had) store.setFilters({ director: '', actor: '' })
}

function selectDirector(name) {
  store.setFilters({ director: name, actor: '' })
  view.value = 'movies'
  browseFrom.value = 'directors'
}

function selectActor(name) {
  store.setFilters({ actor: name, director: '' })
  view.value = 'movies'
  browseFrom.value = 'actors'
}

function clearDirector() {
  store.setFilters({ director: '' })
  browseFrom.value = null
}

function clearActor() {
  store.setFilters({ actor: '' })
  browseFrom.value = null
}

function backToBrowseList() {
  view.value = browseFrom.value === 'actors' ? 'actors' : 'directors'
}

function goPerson(name) {
  detailVisible.value = false
  router.push({ path: '/person', query: { name } })
}

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

async function pickTonight() {
  picking.value = true
  try {
    const movie = await store.pickTonight()
    ElMessage({ message: `今晚就看这部！${movie.title}`, type: 'success' })
    openDetail(movie)
  } catch (e) {
    ElMessage.info(e.message)
  } finally {
    picking.value = false
  }
}

function onUpdated(movie) {
  detailMovie.value = movie
  const i = store.movies.findIndex(m => m.id === movie.id)
  if (i >= 0) store.movies[i] = movie
  store.fetchMeta()
}

onMounted(() => {
  store.fetchMovies()
  store.fetchMeta()
  store.fetchScanPaths()
  api.doubanTop250()
    .then(r => {
      top250Count.value = r.matched || 0
      if (r.matched && !store.movies.some(m => m.douban_rank != null)) store.fetchMovies()
    })
    .catch(() => {})
})
</script>

<template>
  <div class="movies-page">
    <header class="topbar">
      <div class="brand" @click="$router.push('/')">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-tooltip content="返回首页" placement="bottom">
        <el-button circle @click="$router.push('/')">
          <el-icon><HomeFilled /></el-icon>
        </el-button>
      </el-tooltip>
      <el-input
        v-model="searchText"
        class="search"
        placeholder="搜索标题 / 导演 / 演员 / 简介 / 拼音…"
        clearable
        :prefix-icon="Search"
      />
      <el-select v-model="sortValue" class="sort" @change="onSortChange">
        <el-option v-for="o in sortOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button class="pick-btn" round :loading="picking" @click="pickTonight">
        <el-icon v-if="!picking"><MagicStick /></el-icon>&nbsp;今晚看什么
      </el-button>
      <el-tooltip content="盲盒放映" placement="bottom">
        <el-button circle @click="$router.push('/blindbox')">
          <el-icon><Present /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="仅看收藏" placement="bottom">
        <el-button
          circle
          :type="filters.favorite ? 'warning' : 'default'"
          @click="store.setFilters({ favorite: !filters.favorite })"
        >
          <el-icon><StarFilled /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="立即扫描" placement="bottom">
        <el-button circle :loading="scanning" @click="store.triggerAndAwaitScan()">
          <el-icon v-if="!scanning"><Refresh /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="统计面板" placement="bottom">
        <el-button circle @click="$router.push('/stats')">
          <el-icon><DataAnalysis /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="观影日记" placement="bottom">
        <el-button circle @click="$router.push('/diary')">
          <el-icon><Notebook /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="想看清单" placement="bottom">
        <el-button circle @click="$router.push('/wishlist')">
          <el-icon><StarFilled /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="扫描目录 / 设置" placement="bottom">
        <el-button circle @click="settingsVisible = true">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
    </header>

    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-title">筛选</div>
        <el-select v-model="categoryModel" filterable clearable placeholder="全部分类" class="sidebar-item" size="large">
          <el-option v-for="c in meta.categories" :key="c" :label="c" :value="c" />
        </el-select>
      <el-select v-model="countryModel" filterable clearable placeholder="全部国家" class="sidebar-item" size="large">
        <el-option v-for="c in meta.countries" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-if="meta.qualities?.length" v-model="qualityModel" clearable placeholder="全部画质" class="sidebar-item" size="large">
        <el-option v-for="q in meta.qualities" :key="q" :label="q" :value="q" />
      </el-select>
      <el-select
        v-model="tagsModel"
        multiple
        filterable
        clearable
        collapse-tags
        collapse-tags-tooltip
        placeholder="标签"
        class="sidebar-item"
        size="large"
      >
        <el-option v-for="t in meta.tags" :key="t.id" :label="t.name" :value="t.name" />
      </el-select>
      <el-select v-model="yearModel" filterable clearable placeholder="全部年份" class="sidebar-item" size="large">
        <el-option v-for="y in meta.years" :key="y" :label="y" :value="y" />
      </el-select>
      <el-select v-model="watchedModel" placeholder="观看状态" class="sidebar-item" size="large">
        <el-option label="全部状态" value="" />
        <el-option label="已看" value="watched" />
        <el-option label="未看" value="unwatched" />
      </el-select>
      <el-select v-model="myRatingModel" placeholder="我的评分" class="sidebar-item" size="large">
        <el-option label="全部评分" value="" />
        <el-option label="9 ~ 10 分" value="9-10" />
        <el-option label="8 ~ 8.9 分" value="8-8.9" />
        <el-option label="7 ~ 7.9 分" value="7-7.9" />
        <el-option label="6 ~ 6.9 分" value="6-6.9" />
        <el-option label="6 分以下" value="0-5.9" />
        <el-option label="未评分" value="none" />
      </el-select>

      <el-button
        class="sidebar-btn"
        size="large"
        :type="filters.top250 ? 'primary' : 'default'"
        @click="store.setFilters({ top250: !filters.top250 })"
      >
        <span class="btn-label">豆瓣 Top 250{{ top250Count ? `（${top250Count}）` : '' }}</span>
      </el-button>

      <el-button
        class="sidebar-btn"
        size="large"
        :type="view === 'directors' || filters.director ? 'primary' : 'default'"
        @click="toggleDirectors"
      >
        <span class="btn-label">{{ filters.director ? `导演：${filters.director}` : '导演' }}</span>
        <el-icon v-if="filters.director" class="clear-icon" @click.stop="clearDirector"><Close /></el-icon>
      </el-button>

      <el-button
        class="sidebar-btn"
        size="large"
        :type="view === 'actors' || filters.actor ? 'primary' : 'default'"
        @click="toggleActors"
      >
        <span class="btn-label">{{ filters.actor ? `演员：${filters.actor}` : '演员' }}</span>
        <el-icon v-if="filters.actor" class="clear-icon" @click.stop="clearActor"><Close /></el-icon>
      </el-button>
        <div v-if="meta.stats.total" class="stats">
          共 {{ meta.stats.total }} 部<br />已看 {{ meta.stats.watched }} · {{ formatSize(meta.stats.total_size) }}
          <span v-if="meta.stats.missing" class="missing"><br />{{ meta.stats.missing }} 部缺失</span>
        </div>
      </aside>

    <main v-loading="loading" class="content">
      <!-- 导演列表视图 -->
      <div v-if="view === 'directors'" class="person-page">
        <div class="person-page-header">
          <el-button link @click="backToMovies"><el-icon><ArrowLeft /></el-icon> 返回电影列表</el-button>
          <span class="person-page-title">导演 <span class="person-total">（{{ store.directorsTotal }} 人）</span></span>
          <el-input v-model="directorSearch" placeholder="搜索导演" clearable size="small" class="person-search" />
        </div>
        <div v-loading="directorLoading" class="person-grid" :ref="el => setPersonGridRef(el)">
          <div v-if="!directorLoading && !store.directors.length" class="person-empty">暂无导演</div>
          <div
            v-for="d in store.directors"
            :key="d.name"
            class="person-card"
            :class="{ active: d.name === filters.director }"
            @click="selectDirector(d.name)"
          >
            <img v-if="store.directorPhotos[d.name]" class="person-avatar" :src="store.directorPhotos[d.name]" :alt="d.name" loading="lazy" />
            <div v-else class="person-avatar fallback">{{ d.name[0] }}</div>
            <div class="person-name">{{ d.name }}</div>
            <div class="person-count">{{ d.count }} 部</div>
            <div class="person-more" @click.stop="goPerson(d.name)">影史资料</div>
          </div>
        </div>
        <div class="person-pager">
          <el-pagination
            layout="prev, pager, next"
            :total="store.directorsTotal"
            :page-size="personPageSize"
            :current-page="directorPage"
            @current-change="changeDirectorPage"
          />
        </div>
      </div>

      <!-- 演员列表视图 -->
      <div v-else-if="view === 'actors'" class="person-page">
        <div class="person-page-header">
          <el-button link @click="backToMovies"><el-icon><ArrowLeft /></el-icon> 返回电影列表</el-button>
          <span class="person-page-title">演员 <span class="person-total">（{{ store.actorsTotal }} 人）</span></span>
          <el-input v-model="actorSearch" placeholder="搜索演员" clearable size="small" class="person-search" />
        </div>
        <div v-loading="actorLoading" class="person-grid" :ref="el => setPersonGridRef(el)">
          <div v-if="!actorLoading && !store.actors.length" class="person-empty">暂无演员</div>
          <div
            v-for="a in store.actors"
            :key="a.name"
            class="person-card"
            :class="{ active: a.name === filters.actor }"
            @click="selectActor(a.name)"
          >
            <img v-if="store.actorPhotos[a.name]" class="person-avatar" :src="store.actorPhotos[a.name]" :alt="a.name" loading="lazy" />
            <div v-else class="person-avatar fallback">{{ a.name[0] }}</div>
            <div class="person-name">{{ a.name }}</div>
            <div class="person-count">{{ a.count }} 部</div>
            <div class="person-more" @click.stop="goPerson(a.name)">影史资料</div>
          </div>
        </div>
        <div class="person-pager">
          <el-pagination
            layout="prev, pager, next"
            :total="store.actorsTotal"
            :page-size="personPageSize"
            :current-page="actorPage"
            @current-change="changeActorPage"
          />
        </div>
      </div>

      <!-- 电影墙视图 -->
      <template v-else>
        <div v-if="browseFrom" class="browse-back">
          <el-button link @click="backToBrowseList">
            <el-icon><ArrowLeft /></el-icon> 返回{{ browseFrom === 'directors' ? '导演' : '演员' }}列表
          </el-button>
          <span v-if="filters.director" class="browse-current">导演：{{ filters.director }}</span>
          <span v-else-if="filters.actor" class="browse-current">演员：{{ filters.actor }}</span>
        </div>
        <div v-if="movies.length" class="wall">
          <MovieCard v-for="m in movies" :key="m.id" :movie="m" @open="openDetail" @play="playMovie" />
        </div>
        <div v-else-if="!loading && !scanPaths.length" class="empty-hero">
          <el-icon :size="60" color="#e0a458"><Film /></el-icon>
          <h2>欢迎使用电影中心</h2>
          <p>各硬盘根目录下的「电影」文件夹（如 D:\电影）会在启动时自动识别入库<br />也可以手动添加目录，支持本地硬盘与 NAS</p>
          <div class="hero-actions">
            <el-button size="large" @click="settingsVisible = true">添加电影目录</el-button>
            <el-button type="primary" size="large" :loading="scanning" @click="store.triggerAndAwaitScan()">立即扫描</el-button>
          </div>
        </div>
        <el-empty v-else-if="!loading" description="没有符合条件的结果" />
      </template>
      </main>
    </div>

    <footer v-if="view === 'movies' && total > pageSize" class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="p => store.setPage(p)"
      />
    </footer>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" @open-movie="onOpenMovie" @open-person="goPerson" />
    <SettingsDialog v-model="settingsVisible" />
  </div>
</template>

<style scoped>
.movies-page {
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

.logo {
  width: 26px;
  height: 26px;
  color: #e0a458;
}

.pick-btn {
  white-space: nowrap;
  font-weight: 600;
}

.search {
  max-width: 460px;
  margin-left: auto;
}

.layout {
  flex: 1;
  display: flex;
  align-items: stretch;
  min-height: 0;
}

.sidebar {
  flex: 0 0 clamp(190px, 19vw, 300px);
  padding: 20px 18px 24px 30px;
  border-right: 1px solid #241d16;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 62px;
  align-self: flex-start;
  max-height: calc(100vh - 62px);
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

.sidebar-title {
  font-size: 15px;
  color: #9a8b74;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.sidebar-item {
  width: 100%;
}

.sidebar-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
}

.sidebar-btn > :deep(span) {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sidebar-btn + .sidebar-btn {
  margin-left: 0;
}

.btn-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-icon {
  cursor: pointer;
  font-size: 13px;
}

.person-page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.browse-back {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.browse-current {
  font-size: 14px;
  color: #9a8b74;
}

.person-page-title {
  font-size: 17px;
  font-weight: 700;
}

.person-total {
  font-size: 13px;
  color: #9a8b74;
  font-weight: 400;
}

.person-search {
  margin-left: auto;
  width: 240px;
}

.person-pager {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

.person-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 24px 20px;
}

.person-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 12px 34px;
  border-radius: 12px;
  cursor: pointer;
  text-align: center;
  transition: background 0.2s, transform 0.2s;
}

.person-card:hover {
  background: rgba(224, 164, 88, 0.07);
  transform: translateY(-2px);
}

.person-card.active {
  background: rgba(224, 164, 88, 0.12);
}

.person-avatar {
  width: 128px;
  height: 128px;
  border-radius: 50%;
  object-fit: cover;
  background: #1a2130;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.person-avatar.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  color: #9a8b74;
}

.person-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  word-break: break-all;
}

.person-count {
  font-size: 13px;
  color: #7d7160;
}

.person-more {
  position: absolute;
  bottom: 9px;
  left: 0;
  right: 0;
  font-size: 12px;
  color: #e0a458;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.2s, transform 0.2s;
}

.person-card:hover .person-more {
  opacity: 1;
  transform: translateY(0);
}

.person-empty {
  grid-column: 1 / -1;
  color: #9a8b74;
  font-size: 13px;
  text-align: center;
  padding: 48px 0;
}

.stats {
  margin-top: 4px;
  font-size: 13px;
  color: #9a8b74;
  line-height: 1.9;
  word-break: break-word;
}

.missing {
  color: #e6a23c;
}

.content {
  flex: 1;
  min-width: 0;
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 28px 28px;
  box-sizing: border-box;
  min-height: 300px;
}

@media (max-width: 900px) {
  .sidebar {
    padding-left: 16px;
  }
}

@media (max-width: 640px) {
  .layout {
    flex-direction: column;
  }

  .sidebar {
    flex: none;
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
    border-right: none;
    border-bottom: 1px solid #241d16;
    max-height: none;
  }

  .sidebar-item,
  .sidebar-btn {
    flex: 1 1 40%;
    width: auto;
  }

  .sidebar-title {
    display: none;
  }
}

.wall {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 22px 16px;
}

@media (max-width: 1100px) {
  .wall {
    grid-template-columns: repeat(5, 1fr);
  }
}

@media (max-width: 900px) {
  .wall {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 620px) {
  .wall {
    grid-template-columns: repeat(3, 1fr);
  }
}

.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 120px 20px 0;
  text-align: center;
}

.empty-hero h2 {
  margin: 0;
  font-size: 22px;
}

.empty-hero p {
  margin: 0;
  color: #9a8b74;
  max-width: 480px;
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.pager {
  display: flex;
  justify-content: center;
  padding: 8px 0 28px;
}
</style>
