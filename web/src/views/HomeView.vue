<script setup>
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Film, Search, Setting, StarFilled, Refresh } from '@element-plus/icons-vue'
import { useLibraryStore } from '../stores/library'
import { formatSize } from '../utils'
import MovieCard from '../components/MovieCard.vue'
import MovieDetail from '../components/MovieDetail.vue'
import SettingsDialog from '../components/SettingsDialog.vue'

const store = useLibraryStore()
const { movies, total, page, pageSize, loading, meta, filters, scanPaths, scanning } = storeToRefs(store)

const searchText = ref('')
const sortValue = ref(`${filters.value.sort}:${filters.value.order}`)
const detailVisible = ref(false)
const detailMovie = ref(null)
const settingsVisible = ref(false)

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
  { label: '我的评分', value: 'my_rating:desc' }
]

function onSortChange(v) {
  const [sort, order] = v.split(':')
  store.setFilters({ sort, order })
}

const categoryModel = ref(filters.value.category)
watch(categoryModel, v => store.setFilters({ category: v || '' }))

const tagsModel = ref([...filters.value.tags])
watch(tagsModel, v => store.setFilters({ tags: v || [] }))

const yearModel = ref(filters.value.year)
watch(yearModel, v => store.setFilters({ year: v ?? null }))

const watchedModel = ref(filters.value.watched)
watch(watchedModel, v => store.setFilters({ watched: v || '' }))

const myRatingModel = ref(filters.value.myRating)
watch(myRatingModel, v => store.setFilters({ myRating: v || '' }))

function openDetail(movie) {
  detailMovie.value = movie
  detailVisible.value = true
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
})
</script>

<template>
  <div class="home">
    <header class="topbar">
      <div class="brand">
        <el-icon :size="22" color="#4d8ff0"><Film /></el-icon>
        <span>电影中心</span>
      </div>
      <el-input
        v-model="searchText"
        class="search"
        placeholder="搜索标题 / 导演 / 演员 / 简介…"
        clearable
        :prefix-icon="Search"
      />
      <el-select v-model="sortValue" class="sort" @change="onSortChange">
        <el-option v-for="o in sortOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
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
      <el-tooltip content="扫描目录 / 设置" placement="bottom">
        <el-button circle @click="settingsVisible = true">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
    </header>

    <div class="filterbar">
      <el-select v-model="categoryModel" filterable clearable placeholder="全部分类" class="filter-item">
        <el-option v-for="c in meta.categories" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select
        v-model="tagsModel"
        multiple
        filterable
        clearable
        collapse-tags
        collapse-tags-tooltip
        placeholder="标签"
        class="filter-item filter-tags"
      >
        <el-option v-for="t in meta.tags" :key="t.id" :label="t.name" :value="t.name" />
      </el-select>
      <el-select v-model="yearModel" filterable clearable placeholder="全部年份" class="filter-item">
        <el-option v-for="y in meta.years" :key="y" :label="y" :value="y" />
      </el-select>
      <el-select v-model="watchedModel" placeholder="观看状态" class="filter-item">
        <el-option label="全部状态" value="" />
        <el-option label="已看" value="watched" />
        <el-option label="未看" value="unwatched" />
      </el-select>
      <el-select v-model="myRatingModel" placeholder="我的评分" class="filter-item filter-rating">
        <el-option label="全部评分" value="" />
        <el-option label="9 ~ 10 分" value="9-10" />
        <el-option label="8 ~ 8.9 分" value="8-8.9" />
        <el-option label="7 ~ 7.9 分" value="7-7.9" />
        <el-option label="6 ~ 6.9 分" value="6-6.9" />
        <el-option label="6 分以下" value="0-5.9" />
        <el-option label="未评分" value="none" />
      </el-select>
      <div v-if="meta.stats.total" class="stats">
        共 {{ meta.stats.total }} 部 · 已看 {{ meta.stats.watched }} · {{ formatSize(meta.stats.total_size) }}
        <span v-if="meta.stats.missing" class="missing"> · {{ meta.stats.missing }} 部缺失</span>
      </div>
    </div>

    <main v-loading="loading" class="content">
      <div v-if="movies.length" class="wall">
        <MovieCard v-for="m in movies" :key="m.id" :movie="m" @open="openDetail" />
      </div>
      <div v-else-if="!loading && !scanPaths.length" class="empty-hero">
        <el-icon :size="60" color="#4d8ff0"><Film /></el-icon>
        <h2>欢迎使用电影中心</h2>
        <p>各硬盘根目录下的「电影」文件夹（如 D:\电影）会在启动时自动识别入库<br />也可以手动添加目录，支持本地硬盘与 NAS</p>
        <div class="hero-actions">
          <el-button size="large" @click="settingsVisible = true">添加电影目录</el-button>
          <el-button type="primary" size="large" :loading="scanning" @click="store.triggerAndAwaitScan()">立即扫描</el-button>
        </div>
      </div>
      <el-empty v-else-if="!loading" description="没有符合条件的结果" />
    </main>

    <footer v-if="total > pageSize" class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="p => store.setPage(p)"
      />
    </footer>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" />
    <SettingsDialog v-model="settingsVisible" />
  </div>
</template>

<style scoped>
.home {
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
  background: rgba(11, 14, 20, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #1c2432;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
  white-space: nowrap;
}

.search {
  max-width: 460px;
  margin-left: auto;
}

.filterbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px 28px 4px;
}

.filter-item {
  width: 150px;
}

.filter-tags {
  width: 220px;
}

.filter-rating {
  width: 130px;
}

.stats {
  margin-left: auto;
  font-size: 13px;
  color: #8b93a5;
}

.missing {
  color: #e6a23c;
}

.content {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 28px 28px;
  box-sizing: border-box;
  min-height: 300px;
}

.wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 22px 16px;
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
  color: #8b93a5;
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
